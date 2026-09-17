import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import {
  KLINE_CACHE_DATE_FORMAT,
  KLINE_CACHE_PERIODS,
  KLINE_CACHE_SOURCE,
} from '../constants/kline-cache.constants';
import type { KlineCacheMeta, KlineCacheOptions } from '../types/kline-cache.types';
import { calcKlineTailDatalen } from '../utils/calc-kline-tail-datalen';
import { mergeKlineBars } from '../utils/merge-kline-bars';
import { shouldFetchKlineTail } from '../utils/should-fetch-kline-tail';
import {
  clearKlineCache,
  getKlineCacheMeta,
  isKlineCacheAvailable,
  listCachedKlineBars,
  upsertKlineBars,
  upsertKlineCacheMeta,
} from './kline-db.api';
import { fetchSinaKline, type SinaKlinePeriod } from './sina-kline.api';

/**
 * K 线取数的本地缓存编排层
 *
 * 策略（对应「历史行情不变」这一前提）：
 * - **首次**请求某票某周期 ⇒ 按周期配置取满（日 K ≈ 7.5 年）并落库；
 * - **之后**请求 ⇒ 先读本地历史，只向新浪补「库中最新日期 → 现在」的缺口；
 * - 缓存仍新鲜（当日已终值 / 盘中 TTL 内 / 中间无工作日）⇒ **零网络请求**直接返回；
 * - 落库一律**按票按需**：只有详情页、侧栏、Agent 单票查询这类「用户真的在看这只票」
 *   的路径才写入；批量扫描传 `write: false`，因此不会因为点一次扫描就把整池（极端情况
 *   全市场）的日 K 灌进本地库。
 *
 * 不做静默降级：补数失败时向上抛错（调用方保留上一次成功数据），
 * 不会拿一份过期缓存冒充最新行情。
 */

/**
 * 判断周期是否参与本地缓存
 * @param period K 线周期
 * @returns 是否可缓存（见 KLINE_CACHE_PERIODS 的取舍说明）
 */
const isCacheablePeriod = (period: SinaKlinePeriod): boolean =>
  KLINE_CACHE_PERIODS.includes(period);

/**
 * 拉取 K 线（优先本地库，必要时只补缺口）
 * @param symbol 完整符号（`sh600519` 形态）
 * @param period K 线周期
 * @param options 缓存策略（写入与否 / 首次请求根数上限）
 * @returns klinecharts KLineData 序列（时间升序）
 * @throws 需要回源且上游请求失败、或响应为空时抛错
 */
export const fetchKlineCached = async (
  symbol: string,
  period: SinaKlinePeriod,
  options?: KlineCacheOptions,
): Promise<KLineData[]> => {
  const write = options?.write ?? true;
  // 未纳入缓存的周期，或浏览器端无 SQLite ⇒ 退回纯网络取数
  if (!isCacheablePeriod(period) || !isKlineCacheAvailable()) {
    return fetchSinaKline(symbol, period, { barLimit: options?.barLimit });
  }

  const now = Date.now();
  let meta = await getKlineCacheMeta(symbol, period);
  // 口径不一致（换数据源 / 换复权方式）⇒ 整票作废，否则新旧价格会混进同一条序列
  if (meta !== null && meta.source !== KLINE_CACHE_SOURCE) {
    console.warn(`[kline-cache] ${symbol} 缓存口径已变更，作废重取`);
    await clearKlineCache(symbol, period);
    meta = null;
  }

  const cachedBars = meta === null ? [] : await listCachedKlineBars(symbol, period);
  const hasCache = meta !== null && cachedBars.length > 0;

  // 缓存仍新鲜：库里已有完整历史且无需补尾部 ⇒ 零网络请求
  if (meta !== null && hasCache && !shouldFetchKlineTail(meta, now)) {
    return cachedBars;
  }

  // 已有缓存 ⇒ 只取缺口根数；首次填充且要落库 ⇒ 取满（保证库里的历史自始完整，
  // 否则水位会把「半截历史」记成完整，之后只补尾部就永远填不回前面那段）；
  // 首次填充且只读 ⇒ 允许调用方收窄，不回写也就不会留下不完整的水位。
  let barLimit: number | undefined;
  if (meta !== null && hasCache) {
    barLimit = calcKlineTailDatalen(meta.lastDate, now);
  } else if (!write) {
    barLimit = options?.barLimit;
  }

  const fetched = await fetchSinaKline(symbol, period, { barLimit });
  if (fetched.length === 0) {
    return cachedBars;
  }
  const merged = mergeKlineBars(cachedBars, fetched);

  if (write) {
    await upsertKlineBars(symbol, period, fetched);
    const nextMeta: KlineCacheMeta = {
      symbol,
      period,
      source: KLINE_CACHE_SOURCE,
      firstDate: dayjs(merged[0].timestamp).format(KLINE_CACHE_DATE_FORMAT),
      lastDate: dayjs(merged[merged.length - 1].timestamp).format(KLINE_CACHE_DATE_FORMAT),
      barCount: merged.length,
      fetchedAt: now,
    };
    await upsertKlineCacheMeta(nextMeta);
  }

  return merged;
};

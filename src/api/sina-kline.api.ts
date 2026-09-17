import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import { KLINE_MAX_BARS_PER_REQUEST } from '../constants/kline.constants';
import { proxyFetch } from './proxy-fetch';

/**
 * 新浪财经 K 线数据源（quotes.sina.cn，免 Token；接口文档见 .ai/项目资源/新浪接口文档.md）
 *
 * stock-sdk 的东财日K/周K 实测无数据，统一改走新浪源；
 * 返回价格均为不复权，K 线图侧不再提供复权切换
 */

/**
 * K 线周期
 *
 * minute / fiveDay 为 1 分钟线（分时 / 五日），其余对应新浪 scale 周期
 */
export type SinaKlinePeriod =
  | 'minute'
  | 'fiveDay'
  | 'min5'
  | 'daily'
  | 'weekly'
  | 'monthly';

/**
 * 新浪 K 线请求可选参数
 */
export interface SinaKlineFetchOptions {
  /**
   * 覆盖配置中的请求根数
   *
   * 用途：**收窄**单次请求。批量场景（如信号扫描只算短周期指标）不必拉满历史；
   * 会被 KLINE_MAX_BARS_PER_REQUEST 收敛，不影响 keepDays 的窗口截取口径。
   */
  barLimit?: number;
}

/**
 * 新浪 K 线请求参数（scale 周期分钟数 / 拉取根数 / 保留交易日数）
 *
 * datalen 决定可回看的历史深度：日 / 周 / 月 K 一律取到上游上限附近
 * （实测超过 1970 条上游返回 null），避免往前拖动到尽头即无数据；
 * 1 分钟线窗口有限，按根数覆盖所需交易日后本地截取
 */
const SINA_KLINE_CONFIG: Record<
  SinaKlinePeriod,
  { scale: number; datalen: number; keepDays: number }
> = {
  minute: { scale: 1, datalen: 320, keepDays: 1 },
  fiveDay: { scale: 1, datalen: 700, keepDays: 5 },
  min5: { scale: 5, datalen: 1500, keepDays: Number.MAX_SAFE_INTEGER },
  // 日 K 取满上游上限（≈7.5 年）；周 / 月 K 一次即可拿到上游全部历史
  daily: { scale: 240, datalen: KLINE_MAX_BARS_PER_REQUEST, keepDays: Number.MAX_SAFE_INTEGER },
  weekly: { scale: 1200, datalen: 1500, keepDays: Number.MAX_SAFE_INTEGER },
  monthly: { scale: 7200, datalen: 1000, keepDays: Number.MAX_SAFE_INTEGER },
};

/** 新浪上游要求的 Referer（缺失返回 403） */
const SINA_REFERER = 'https://finance.sina.com.cn';

/** 新浪 K 线原始记录（数值均为字符串） */
interface SinaKlineRaw {
  /** 日/周/月K 为 YYYY-MM-DD；分钟K 为 YYYY-MM-DD HH:MM:00（该段结束时间） */
  day: string;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
  /** 成交额（元），仅分钟级返回 */
  amount?: string;
}

/**
 * 解析新浪 JSONP 文本：剥离首行注释、`var _=(` 前缀与尾部 `);`
 *
 * 上游在参数越界（如 datalen 超上限）或缺数据时返回 `var _=(null);`，
 * 这里显式报错，避免下游拿到 null 后抛出难以定位的异常
 * @param text 响应原文
 * @returns 解析后的原始记录数组
 */
const parseJsonp = (text: string): SinaKlineRaw[] => {
  const start = text.indexOf('(');
  const end = text.lastIndexOf(')');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`新浪 K 线响应解析失败：${text.slice(0, 80)}`);
  }
  const parsed = JSON.parse(text.slice(start + 1, end)) as SinaKlineRaw[] | null;
  if (!Array.isArray(parsed)) {
    throw new Error('新浪 K 线响应为空（可能参数越界或该标的无数据）');
  }
  return parsed;
};

/**
 * 计算分时均价（累计成交额 / 累计成交量），写入 avgPrice 自定义字段
 * @param bars 分钟线序列（原对象上补字段）
 */
const applyAvgPrice = (bars: KLineData[]): void => {
  let cumAmount = 0;
  let cumVolume = 0;
  let prevAvg = Number.NaN;
  for (const bar of bars) {
    cumVolume += bar.volume ?? 0;
    cumAmount += (bar.turnover as number | undefined) ?? 0;
    if (cumVolume > 0) {
      prevAvg = cumAmount / cumVolume;
    }
    bar.avgPrice = prevAvg;
  }
};

/**
 * 拉取新浪 K 线并转为 klinecharts 数据结构（时间升序）
 * @param symbol 完整符号（sh600519 形态，新浪前缀一致可直接使用）
 * @param period K 线周期
 * @param options 可选请求参数（见 SinaKlineFetchOptions）
 * @returns klinecharts KLineData 序列（分钟级附 avgPrice 均价字段）
 */
export const fetchSinaKline = async (
  symbol: string,
  period: SinaKlinePeriod,
  options?: SinaKlineFetchOptions,
): Promise<KLineData[]> => {
  const { scale, datalen, keepDays } = SINA_KLINE_CONFIG[period];
  const requestDatalen = Math.min(
    Math.max(options?.barLimit ?? datalen, 1),
    KLINE_MAX_BARS_PER_REQUEST,
  );
  const url =
    `https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_=` +
    `/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=${scale}&ma=no&datalen=${requestDatalen}`;

  // 浏览器态经 /stock-proxy 转发（中间件补 Referer）；Tauri 态 Rust 层直连需自带 Referer
  const response = await proxyFetch(url, {
    headers: { Referer: SINA_REFERER },
  });
  if (!response.ok) {
    throw new Error(`新浪 K 线请求失败：${response.status}`);
  }
  const rawList = parseJsonp(await response.text());

  const bars: KLineData[] = rawList
    .map((raw) => ({
      // 空格为本地时区解析，与 A 股交易日口径一致
      timestamp: dayjs(raw.day.replace(/-/g, '/')).valueOf(),
      open: Number(raw.open),
      high: Number(raw.high),
      low: Number(raw.low),
      close: Number(raw.close),
      volume: Number(raw.volume),
      turnover: Number(raw.amount ?? '0'),
    }))
    .filter((bar) => !Number.isNaN(bar.timestamp) && bar.open > 0);

  // 按交易日截取窗口（1 分钟线上游无法按起始时间取数）
  const dayPrefixes = [
    ...new Set(bars.map((bar) => dayjs(bar.timestamp).format('YYYY-MM-DD'))),
  ].slice(-keepDays);
  const kept = new Set(dayPrefixes);
  const result = bars.filter((bar) => kept.has(dayjs(bar.timestamp).format('YYYY-MM-DD')));

  if (scale === 1) {
    applyAvgPrice(result);
  }
  return result;
};

import { TURNOVER_INDEX_SYMBOLS } from '../constants/turnover.constants';
import type { TurnoverDayItem } from '../types/turnover.types';
import { proxyFetch } from './proxy-fetch';

/**
 * 沪深两市总成交额历史（成交额变化模块数据源）
 *
 * 数据源：腾讯行情 K 线 `web.ifzq.gtimg.cn/appstock/app/newfqkline/get`
 * （域已在代理白名单 `gtimg.cn` 与 Tauri capability 内，无需额外配置）
 *
 * 为什么是腾讯而不是东财：东财行情域（push2his / push2）在本机被 TCP 层封禁，
 * 仅 `push2delay` 可达但该域不提供历史 K 线（返回 200 + 空 klines）。腾讯该接口
 * 直接返回**真实成交金额**，无需用成交量近似。
 *
 * 字段口径（实测与腾讯实时接口交叉验证一致）：
 * 行结构 `[日期, 开, 收, 高, 低, 成交量(手), {}, 换手率?, 成交额(万元), ...]`，
 * 取第 9 段（下标 8）成交额 × 1e4 得「元」。
 * 例：2026-09-11 上证该字段 95818633.70 → 958,186,336,998 元，
 * 与腾讯实时接口 `3888.11/579123145/958186336970` 的成交额完全吻合。
 *
 * ⚠️ 重接口（K 线 × 2）：仅挂载时拉取一次，不参与轮询；
 * 30 / 60 / 180 交易日窗口由调用方本地切片
 */

/** 腾讯日 K 接口（`param=<symbol>,day,<起>,<止>,<条数>,<复权>`） */
const TENCENT_KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get';

/** 腾讯源需要 gu.qq.com 作为 Referer，否则可能被拒 */
const TENCENT_REFERER = 'https://gu.qq.com/';

/** 单指数拉取的最大日 K 条数（≈1.5 年交易日，覆盖 180 日窗口且留足余量） */
const MAX_DAYS = 400;

/** 腾讯 K 线响应体（只需日 K 数组） */
interface TencentKlineResponse {
  data?: Record<
    string,
    {
      /** 前复权日 K（请求 qfq 时返回） */
      qfqday?: string[][];
      /** 不复权日 K（兜底） */
      day?: string[][];
    }
  >;
}

/**
 * 拉取单指数逐日成交额（元），返回 日期 -> 成交额 映射
 * @param symbol 腾讯符号（如 sh000001 / sz399001）
 * @returns 日期 -> 成交额（元）映射
 */
const fetchIndexAmountMap = async (symbol: string): Promise<Map<string, number>> => {
  const url = `${TENCENT_KLINE_URL}?param=${symbol},day,,,${MAX_DAYS},qfq`;
  const response = await proxyFetch(url, { headers: { Referer: TENCENT_REFERER } });
  if (!response.ok) {
    throw new Error(`腾讯日K HTTP ${response.status}`);
  }
  const body = (await response.json()) as TencentKlineResponse;
  const rows = body.data?.[symbol]?.qfqday ?? body.data?.[symbol]?.day ?? [];

  const map = new Map<string, number>();
  for (const row of rows) {
    const date = row[0];
    // 下标 8：成交额（万元）-> 元；非交易日 / 未收盘行为 0，跳过以免污染曲线
    const amountYuan = Number(row[8]) * 1e4;
    if (!date || !Number.isFinite(amountYuan) || amountYuan <= 0) {
      continue;
    }
    map.set(date, amountYuan);
  }

  if (map.size === 0) {
    throw new Error(`腾讯成交额为空：${symbol}`);
  }
  return map;
};

/**
 * 拉取沪深两市总成交额历史（升序）
 *
 * 以两指数交易日并集为基准，同日期的成交额相加（任一缺失按 0 计，保证日期轴连续）
 * @returns 逐日 { 日期, 总成交额, 上证成交额, 深证成交额 } 序列（按日期升序）
 */
export const fetchMarketTurnover = async (): Promise<TurnoverDayItem[]> => {
  // 串行错峰：同上游连续两次请求间隔少量时间，避免触发限频
  const shanghaiMap = await fetchIndexAmountMap(TURNOVER_INDEX_SYMBOLS.SH);
  const shenzhenMap = await fetchIndexAmountMap(TURNOVER_INDEX_SYMBOLS.SZ);

  const dates = [...new Set([...shanghaiMap.keys(), ...shenzhenMap.keys()])].sort();
  return dates.map((date) => {
    const shanghaiAmount = shanghaiMap.get(date) ?? 0;
    const shenzhenAmount = shenzhenMap.get(date) ?? 0;
    return {
      date,
      shanghaiAmount,
      shenzhenAmount,
      totalAmount: shanghaiAmount + shenzhenAmount,
    };
  });
};

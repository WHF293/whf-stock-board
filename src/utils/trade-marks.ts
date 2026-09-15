import type { AccountTradeRecord } from '../types/account.types';

/**
 * 成交记录 → K 线图 BS/T 标注点的纯函数集合
 *
 * - 分时 / 五日：每笔成交一个点（同一分钟既有买又有卖合并为 T）；
 * - 日K：按成交日聚合——当日仅买 B / 仅卖 S / 买卖都有 T（做T）。
 */

/** 标注类型：B 买入 / S 卖出 / T 同一粒度内既有买又有卖（做T） */
export type TradeMarkType = 'B' | 'S' | 'T';

/** K 线图上的成交标注点 */
export interface TradeMark {
  /** 毫秒时间戳（分钟级 = 成交时刻所在分钟；日级 = 成交日 15:00） */
  timestamp: number;
  /** 标注类型 */
  type: TradeMarkType;
  /** 成交均价（该粒度内各笔成交价格的算术平均；用于「成交价 vs 开盘价」判定向上下延伸） */
  price: number;
}

/**
 * 解析「YYYY-MM-DD」+「HH:mm:ss」为本地时区毫秒时间戳
 * @param date 成交日期（YYYY-MM-DD）
 * @param time 成交时间（HH:mm[:ss]；只取到分钟）
 * @returns 毫秒时间戳（解析失败返回 0）
 */
const parseTradeTimestamp = (date: string, time: string): number => {
  const parsed = new Date(`${date}T${time.slice(0, 5)}`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
};

/**
 * 分时 / 五日标注点：按「成交分钟」聚合
 * @param records 成交记录
 * @returns 标注点（时间升序）
 */
export const buildIntradayTradeMarks = (records: AccountTradeRecord[]): TradeMark[] => {
  const byMinute = new Map<number, { types: Set<'B' | 'S'>; prices: number[] }>();
  for (const record of records) {
    const ts = parseTradeTimestamp(record.tradeDate, record.tradeTime);
    if (!ts) continue;
    const bucket = byMinute.get(ts) ?? { types: new Set<'B' | 'S'>(), prices: [] };
    bucket.types.add(record.quantity >= 0 ? 'B' : 'S');
    bucket.prices.push(record.price);
    byMinute.set(ts, bucket);
  }
  return [...byMinute.entries()]
    .map(([timestamp, { types, prices }]) => ({
      timestamp,
      type: types.size > 1 ? 'T' : ([...types][0] as TradeMarkType),
      price: prices.reduce((sum, p) => sum + p, 0) / prices.length,
    }))
    .sort((a, b) => a.timestamp - b.timestamp);
};

/**
 * 日K标注点：按「成交日」聚合（当日买卖都有 → T）
 * @param records 成交记录
 * @returns 标注点（时间升序）
 */
export const buildDailyTradeMarks = (records: AccountTradeRecord[]): TradeMark[] => {
  const byDate = new Map<string, { types: Set<'B' | 'S'>; prices: number[] }>();
  for (const record of records) {
    const bucket = byDate.get(record.tradeDate) ?? { types: new Set<'B' | 'S'>(), prices: [] };
    bucket.types.add(record.quantity >= 0 ? 'B' : 'S');
    bucket.prices.push(record.price);
    byDate.set(record.tradeDate, bucket);
  }
  return [...byDate.entries()]
    .map(([date, { types, prices }]) => ({
      timestamp: parseTradeTimestamp(date, '15:00'),
      type: types.size > 1 ? 'T' : ([...types][0] as TradeMarkType),
      price: prices.reduce((sum, p) => sum + p, 0) / prices.length,
    }))
    .filter((mark) => mark.timestamp > 0)
    .sort((a, b) => a.timestamp - b.timestamp);
};

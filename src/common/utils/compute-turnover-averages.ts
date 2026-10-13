import type { ThsTurnoverDay } from '../types/ths-market.types.ts';

/** 5 日均窗口（近 5 个交易日，含今日；同花顺口径，实测核对时如偏差再调） */
export const TURNOVER_AVERAGE_WINDOW = 5;

/**
 * 计算成交额 5 日均（turnover_day 近 5 条本地平均；60 日均后端直出无需自算）
 *
 * 有效值不足窗口大小时按「实有有效条数」平均，全部缺失返回 null
 * @param points 日 K 点列（升序；取末尾窗口切片）
 * @returns 5 日均（元）；无有效数据为 null
 */
export const computeTurnoverAverage5 = (
  points: ThsTurnoverDay['points'],
): number | null => {
  const window = points
    .slice(-TURNOVER_AVERAGE_WINDOW)
    .map((point) => point.turnover)
    .filter((value): value is number => value !== null);
  if (window.length === 0) return null;
  return window.reduce((acc, value) => acc + value, 0) / window.length;
};

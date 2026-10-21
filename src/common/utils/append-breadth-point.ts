/**
 * 市场宽度分时序列追加（同分钟去重，纯函数）
 *
 * 30s 轮询每轮产生一点，同一分钟重复采样取最后一次（末次快照最新）；
 * 结果按时间升序返回，不改入参数组
 */
import type { BreadthPoint } from '../types/market-breadth.types.ts';

/** 毫秒 → 分钟取整除数 */
const MINUTE_MS = 60_000;

/**
 * 追加一个分钟点（同分钟覆盖）
 * @param series 既有分时序列（升序）
 * @param point 新点（time 将向下取整到分钟）
 * @returns 新序列（升序，同分钟仅保留最后一次采样）
 */
export const appendBreadthPoint = (
  series: readonly BreadthPoint[],
  point: BreadthPoint,
): BreadthPoint[] => {
  const minute = Math.floor(point.time / MINUTE_MS) * MINUTE_MS;
  const next = series.filter((item) => Math.floor(item.time / MINUTE_MS) * MINUTE_MS !== minute);
  next.push({ ...point, time: minute });
  return next.sort((a, b) => a.time - b.time);
};

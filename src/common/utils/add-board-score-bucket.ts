import { BOARD_SCORE_BUCKET_THRESHOLD } from '../constants/board-calendar.constants.ts';
import type { BoardScoreBuckets } from '../types/board-calendar.types.ts';

/**
 * 往分桶累加一只个股（互斥：涨停 / 跌停走涨跌停池口径优先，其余按涨跌幅落桶）
 *
 * 边界归属：> 5% 与 < -5% 为严格开区间，(0, 5%] 与 [-5%, 0) 含整点；
 * 涨跌幅恰为 0（平盘）不计权重，不落任何桶。
 * @param buckets 目标分桶（就地累加，调用方负责初始化为零桶）
 * @param change 当日涨跌幅（%）
 * @param isLimitUp 是否涨停（涨跌停池口径）
 * @param isLimitDown 是否跌停（涨跌停池口径）
 */
export const addBoardScoreBucket = (
  buckets: BoardScoreBuckets,
  change: number,
  isLimitUp: boolean,
  isLimitDown: boolean,
): void => {
  if (isLimitUp) {
    buckets.limitUp += 1;
    return;
  }
  if (isLimitDown) {
    buckets.limitDown += 1;
    return;
  }
  if (change > BOARD_SCORE_BUCKET_THRESHOLD) {
    buckets.gt5 += 1;
    return;
  }
  if (change > 0) {
    buckets.up05 += 1;
    return;
  }
  if (change < -BOARD_SCORE_BUCKET_THRESHOLD) {
    buckets.lt5 += 1;
    return;
  }
  if (change < 0) {
    buckets.down05 += 1;
  }
};

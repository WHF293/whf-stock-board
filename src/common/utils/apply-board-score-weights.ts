import { calcBoardScoreFromBuckets } from '../constants/board-calendar.constants.ts';
import type { BoardDailyRow, BoardScoreWeights } from '../types/board-calendar.types.ts';

/**
 * 按权重重算板块日聚合的得分与得分率（纯函数，不改动入参）
 *
 * 规则：
 * - 行带分桶（buckets 非 null）→ score / scoreRate 按权重重算（含默认权重：
 *   默认强桶 ±7 与净额落库口径不恒等，王总 2026-10-22 定稿，必须现算）；
 * - 行无分桶（旧版本行 / 回补日 / 盘中未覆盖板块）→ 保持落库净额口径得分（回退）。
 *
 * 接线位：BoardCalendarView 的行读取边界——板块日历矩阵、赚钱效应气泡图、
 * 板块Top 主线矩阵、题材轮动四路消费同一份加权行，口径自动同步。
 * @param rows 板块日聚合行（库内原值）
 * @param weights 用户权重（已归一化）
 * @returns 加权后的行数组
 */
export const applyBoardScoreWeights = (
  rows: readonly BoardDailyRow[],
  weights: BoardScoreWeights,
): BoardDailyRow[] =>
  rows.map((row) => {
    const buckets = row.buckets;
    if (!buckets || row.consCount <= 0) {
      return row;
    }
    const score = calcBoardScoreFromBuckets(buckets, weights);
    return { ...row, score, scoreRate: score / row.consCount };
  });

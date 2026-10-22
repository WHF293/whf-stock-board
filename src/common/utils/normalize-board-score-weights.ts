import {
  BOARD_SCORE_WEIGHT_RANGE,
  BOARD_SCORE_WEIGHTS_DEFAULT,
} from '../constants/board-calendar.constants.ts';
import type { BoardScoreWeights } from '../types/board-calendar.types.ts';

/**
 * 归一化板块得分权重（持久化值 → 合法权重）
 *
 * 缺键回落默认值；非数值忽略；越界值收敛到 [-10, 10]。
 * 用于 settings store 水合兜底与权重管理器保存入口。
 * @param raw 任意来源的原始权重（可能是旧版本 / 坏数据 / 缺键对象）
 * @returns 合法权重（六键齐全，均在取值边界内）
 */
export const normalizeBoardScoreWeights = (raw: unknown): BoardScoreWeights => {
  const source =
    typeof raw === 'object' && raw !== null
      ? (raw as Partial<Record<keyof BoardScoreWeights, unknown>>)
      : {};
  const result: BoardScoreWeights = { ...BOARD_SCORE_WEIGHTS_DEFAULT };
  for (const key of Object.keys(BOARD_SCORE_WEIGHTS_DEFAULT) as (keyof BoardScoreWeights)[]) {
    const value = Number(source[key]);
    if (Number.isFinite(value)) {
      result[key] = Math.min(BOARD_SCORE_WEIGHT_RANGE.MAX, Math.max(BOARD_SCORE_WEIGHT_RANGE.MIN, value));
    }
  }
  return result;
};

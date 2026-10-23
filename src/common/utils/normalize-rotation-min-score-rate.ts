import {
  ROTATION_MIN_SCORE_RATE_DEFAULT,
  ROTATION_MIN_SCORE_RATE_RANGE,
} from '../constants/board-rotation.constants.ts';

/**
 * 归一化题材轮动 · 上榜最低得分率
 *
 * 非数值回落默认值，其余四舍五入取整后钳位到 [-10, 10]。
 * settings store 的写入 action 与 afterHydrate 坏数据兜底共用同一份逻辑，
 * 保证弹窗保存与旧存档水合得到的值形态一致。
 *
 * @param value 用户输入或持久化恢复的原始值
 * @returns 合法的上榜最低得分率（整数，[-10, 10]）
 */
export const normalizeRotationMinScoreRate = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return ROTATION_MIN_SCORE_RATE_DEFAULT;
  }
  return Math.min(
    ROTATION_MIN_SCORE_RATE_RANGE.MAX,
    Math.max(ROTATION_MIN_SCORE_RATE_RANGE.MIN, Math.round(parsed)),
  );
};

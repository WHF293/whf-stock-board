import {
  ROTATION_MIN_SCORE_RATE_DEFAULT,
  ROTATION_MIN_SCORE_RATE_RANGE,
} from '../constants/board-rotation.constants.ts';

/**
 * 归一化题材轮动 · 上榜得分率门槛（涌入最低门槛 / 逃离最高门槛共用）
 *
 * 非数值回落默认值，其余四舍五入取整后钳位到 [-10, 10]。
 * settings store 的写入 action 与 afterHydrate 坏数据兜底共用同一份逻辑，
 * 保证弹窗保存与旧存档水合得到的值形态一致。
 *
 * @param value 用户输入或持久化恢复的原始值
 * @param fallback 非数值时的回落默认值（省略 = 涌入上榜最低得分率默认值）
 * @returns 合法的上榜得分率门槛（整数，[-10, 10]）
 */
export const normalizeRotationMinScoreRate = (
  value: unknown,
  fallback: number = ROTATION_MIN_SCORE_RATE_DEFAULT,
): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(
    ROTATION_MIN_SCORE_RATE_RANGE.MAX,
    Math.max(ROTATION_MIN_SCORE_RATE_RANGE.MIN, Math.round(parsed)),
  );
};

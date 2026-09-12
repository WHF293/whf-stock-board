/**
 * 数值夹取：把 value 限制在 [min, max] 区间内
 * @param value 原始数值
 * @param min 下限
 * @param max 上限
 * @returns 夹取后的数值
 */
export const clampNumber = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(value, max));

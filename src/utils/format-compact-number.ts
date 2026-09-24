/**
 * 数值紧凑格式化（token 数、万位级计数等展示场景）
 *
 * 口径：千位以下原样；千 / 百万 / 十亿位分别落 k / M / B，保留 1 位小数
 * 但不追加 `.0`（`1530` → `1.5k`、`2000` → `2k`、`3_240_000` → `3.2M`）。
 */

/**
 * 单位换算后去尾零（`1.0` → `1`，`1.50` → `1.5`）
 * @param value 换算后的数值
 * @returns 无尾零的一位小数字符串
 */
const trimUnit = (value: number): string => value.toFixed(1).replace(/\.0$/, '');

/**
 * 数值 → 紧凑展示文案
 * @param value 任意整数（负数按绝对值定单位、保留符号）
 * @returns 形如 `986` / `1.5k` / `3.2M` / `1.1B` 的文案；非有限值返回 `0`
 */
export function formatCompactNumber(value: number): string {
  if (!Number.isFinite(value)) return '0';
  const abs = Math.abs(value);
  const sign = value < 0 ? '-' : '';
  if (abs >= 1_000_000_000) return `${sign}${trimUnit(abs / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `${sign}${trimUnit(abs / 1_000_000)}M`;
  if (abs >= 1_000) return `${sign}${trimUnit(abs / 1_000)}k`;
  return String(Math.round(value));
}

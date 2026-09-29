/**
 * 毫秒时长 → 中文短文案（使用统计的「最长聊天时长」卡）
 *
 * 口径：整分进位（`61s` → `1分1秒`）；小时以上不带秒（`1小时2分`），
 * 没有分钟的小时也保留分钟位省略（`1小时`）。
 */

/**
 * 毫秒 → 时长文案
 * @param ms 时长毫秒数（非有限值或 ≤ 0 返回 `0秒`）
 * @returns 形如 `45秒` / `3分20秒` / `1小时2分` 的文案
 */
export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0秒';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分` : `${hours}小时`;
  if (minutes > 0) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}

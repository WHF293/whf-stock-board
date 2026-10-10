/**
 * 时间戳归一分钟桶（同分钟去重判定用）
 *
 * 定时任务心跳的「同一分钟只触发一次」判据：两次时间戳落在同一个
 * 60s 桶即视为同一分钟。用整数除法而不是拼接 `YYYY-MM-DD HH:mm`
 * 字符串，避开时区/格式化开销与跨月边界的心智负担。
 */

/** 一分钟的毫秒数 */
const MINUTE_MS = 60_000;

/**
 * 时间戳 → 分钟桶序号
 * @param ts 毫秒时间戳
 * @returns 从 epoch 起算的分钟序号
 */
export function minuteBucket(ts: number): number {
  return Math.floor(ts / MINUTE_MS);
}

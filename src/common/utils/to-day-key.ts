/**
 * 本地日键（毫秒时间戳 → 本地时区 `YYYY-MM-DD`）
 *
 * 使用统计按「本地日」聚合（热力格 / 趋势线 / 连续天数），与用户在日历上
 * 看到的日期一致；不要用 toISOString()，那是 UTC 日，会在中国时区的
 * 0:00-8:00 之间把记录算到前一天。
 */
import dayjs from 'dayjs';

/** 本地日键格式 */
export const DAY_KEY_FORMAT = 'YYYY-MM-DD';

/**
 * 时间戳 → 本地日键
 * @param ts 毫秒时间戳
 * @returns 形如 `2026-09-24` 的本地日期字符串
 */
export const toDayKey = (ts: number): string => dayjs(ts).format(DAY_KEY_FORMAT);

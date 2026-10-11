import dayjs from 'dayjs';

/** 完整日期时间展示格式（日志 / 台账类场景） */
export const DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';

/**
 * 格式化时间戳为 `YYYY-MM-DD HH:mm:ss`
 * @param timestamp UTC 毫秒时间戳
 * @returns 形如 `2026-09-15 10:37:56` 的文案；时间戳无效时返回空串
 */
export const formatDateTime = (timestamp: number | null | undefined): string => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '';
  }
  return dayjs(timestamp).format(DATETIME_FORMAT);
};

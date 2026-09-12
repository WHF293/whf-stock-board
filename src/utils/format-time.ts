import dayjs from 'dayjs';
import { NUMBER_PLACEHOLDER } from '../constants/format.constants';

/** 行情时间展示格式 */
export const TIME_FORMAT = 'HH:mm:ss';

/**
 * 格式化时间戳为时分秒
 * @param timestamp UTC 毫秒时间戳
 * @returns 形如 `14:30:05` 的文案；无法格式化时为 `--`
 */
export const formatTime = (timestamp: number | null | undefined): string => {
  if (!timestamp) {
    return NUMBER_PLACEHOLDER;
  }
  return dayjs(timestamp).format(TIME_FORMAT);
};

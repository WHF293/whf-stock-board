import dayjs from 'dayjs';
import { MINUTE_AXIS_RANGES } from '../constants/kline.constants';

/**
 * 生成某个交易日的分时固定时间轴（升序毫秒时间戳，共 238 格）
 *
 * 与上游 1 分钟线口径一致：09:31~11:30 + 13:01~14:57 + 15:00
 * @param dayTimestamp 该交易日内任一毫秒时间戳（只取日期部分，忽略时分）
 * @returns 该交易日的固定分钟时间戳数组（升序）
 */
export const buildMinuteAxis = (dayTimestamp: number): number[] => {
  const day = dayjs(dayTimestamp).startOf('day');
  const axis: number[] = [];
  for (const { start, count } of MINUTE_AXIS_RANGES) {
    const [hour, minute] = start.split(':').map(Number);
    const first = day.hour(hour).minute(minute);
    for (let i = 0; i < count; i += 1) {
      axis.push(first.add(i, 'minute').valueOf());
    }
  }
  return axis;
};

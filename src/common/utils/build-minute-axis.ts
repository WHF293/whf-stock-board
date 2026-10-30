import dayjs from 'dayjs';
import { MINUTE_AXIS_RANGES } from '../constants/kline.constants.ts';
import type { MinuteAxisRange } from '../types/kline.types.ts';

/**
 * 生成某个交易日的分时固定时间轴（升序毫秒时间戳，A 股 238 格 / 港股 330 格）
 *
 * 与上游 1 分钟线口径一致：A 股 09:31~11:30 + 13:01~14:57 + 15:00；
 * 港股 09:31~12:00 + 13:01~16:00（ranges 参数传入港股配置即可）
 * @param dayTimestamp 该交易日内任一毫秒时间戳（只取日期部分，忽略时分）
 * @param ranges 时间轴分段配置（缺省 A 股 MINUTE_AXIS_RANGES）
 * @returns 该交易日的固定分钟时间戳数组（升序）
 */
export const buildMinuteAxis = (
  dayTimestamp: number,
  ranges: readonly MinuteAxisRange[] = MINUTE_AXIS_RANGES,
): number[] => {
  const day = dayjs(dayTimestamp).startOf('day');
  const axis: number[] = [];
  for (const { start, count } of ranges) {
    const [hour, minute] = start.split(':').map(Number);
    const first = day.hour(hour).minute(minute);
    for (let i = 0; i < count; i += 1) {
      axis.push(first.add(i, 'minute').valueOf());
    }
  }
  return axis;
};

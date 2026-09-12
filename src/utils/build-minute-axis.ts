import dayjs from 'dayjs';
import {
  MINUTE_AM_COUNT,
  MINUTE_PM_COUNT,
  MINUTE_SESSION,
} from '../constants/kline.constants';

/**
 * 生成 A 股分时固定时间轴（09:30~11:30 + 13:00~15:00 逐分钟，共 242 点）
 *
 * 图表数据按 'HH:mm' 对齐到该轴，未发生的分钟为 null，避免盘中 x 轴拉伸
 * @returns 形如 ['09:30', '09:31', ..., '11:30', '13:00', ..., '15:00'] 的数组
 */
export const buildMinuteAxis = (): string[] => {
  const axis: string[] = [];
  const pushRange = (start: string, count: number): void => {
    let cursor = dayjs(`2026-01-01 ${start}`, 'YYYY-MM-DD HH:mm');
    for (let i = 0; i < count; i += 1) {
      axis.push(cursor.format('HH:mm'));
      cursor = cursor.add(1, 'minute');
    }
  };
  pushRange(MINUTE_SESSION.AM_START, MINUTE_AM_COUNT);
  pushRange(MINUTE_SESSION.PM_START, MINUTE_PM_COUNT);
  return axis;
};

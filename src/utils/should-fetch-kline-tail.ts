import dayjs from 'dayjs';
import {
  KLINE_CACHE_DATE_FORMAT,
  KLINE_DAILY_FINAL_HOUR,
  KLINE_DAILY_FINAL_MINUTE,
  KLINE_TAIL_TTL_MS,
  KLINE_TRADING_WEEKDAYS,
} from '../constants/kline-cache.constants';
import type { KlineCacheMeta } from '../types/kline-cache.types';

/**
 * 参照时刻所属自然日的「日 K 终值时刻」时间戳
 * @param now 参照时间戳（毫秒）
 * @returns 该日 KLINE_DAILY_FINAL_HOUR:KLINE_DAILY_FINAL_MINUTE 的时间戳（毫秒）
 */
const dailyFinalAt = (now: number): number => {
  const startOfDay = dayjs(now).startOf('day');
  return startOfDay
    .hour(KLINE_DAILY_FINAL_HOUR)
    .minute(KLINE_DAILY_FINAL_MINUTE)
    .valueOf();
};

/**
 * 判断 `(from, to]` 区间内是否存在可能的交易日
 *
 * 不用真实交易日历：本函数只用于**决定要不要回源**，宁可多问一次也不漏。
 * 工作日（周一至周五）只是「可能有交易日」的宽松条件：
 * 周五收盘后到周六、周日之间不含工作日 ⇒ 判定无需回源，
 * 于是周末打开应用不会再打一次上游。
 * @param from 起始交易日（不含）
 * @param to 结束日（含）
 * @returns 是否存在工作日
 */
const hasWeekdayBetween = (from: string, to: string): boolean => {
  const end = dayjs(to).startOf('day');
  let cursor = dayjs(from).startOf('day').add(1, 'day');
  while (!cursor.isAfter(end)) {
    if (KLINE_TRADING_WEEKDAYS.includes(cursor.day())) {
      return true;
    }
    cursor = cursor.add(1, 'day');
  }
  return false;
};

/**
 * 判断是否需要回源补「最新尾部」
 *
 * 判据分三种情形（`lastDate` 为库内最新 bar 的交易日）：
 *
 * 1. **无水位**（从未取过 / 口径已作废）⇒ 需要，走首次全量；
 * 2. **库内已有今日 bar** ⇒ 当日 bar 会随盘中成交变化：
 *    - 已过 15:05 且上次取数也在 15:05 之后 ⇒ 已终值，**不再回源**；
 *    - 已过 15:05 但上次取数在 15:05 之前 ⇒ 那次拿到的是盘中半成品，需再取一次；
 *    - 盘中 ⇒ 按 KLINE_TAIL_TTL_MS 节流（来回切周期 / 切票不会重复打上游）；
 * 3. **库内最新 bar 早于今日** ⇒ 只有中间存在工作日才可能产生新 bar，
 *    否则（例如周五收盘后到周日）判定无需回源。
 * @param meta 缓存水位；从未取过传 null
 * @param now 当前时间戳（毫秒）
 * @returns 是否需要回源补尾部
 */
export const shouldFetchKlineTail = (meta: KlineCacheMeta | null, now: number): boolean => {
  if (meta === null) {
    return true;
  }
  const today = dayjs(now).format(KLINE_CACHE_DATE_FORMAT);
  if (meta.lastDate >= today) {
    const finalAt = dailyFinalAt(now);
    if (now >= finalAt) {
      return meta.fetchedAt < finalAt;
    }
    return now - meta.fetchedAt >= KLINE_TAIL_TTL_MS;
  }
  return hasWeekdayBetween(meta.lastDate, today);
};

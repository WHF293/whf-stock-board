import type { KlineAdjust, KlinePeriod } from '../types/kline.types';

/**
 * K 线周期常量（代替魔法串）
 */
export const KLINE_PERIOD = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
} as const satisfies Record<string, KlinePeriod>;

/** K 线周期切换选项（value 必须为 KLINE_PERIOD 成员） */
export const KLINE_PERIOD_OPTIONS: readonly { label: string; value: KlinePeriod }[] = [
  { label: '日K', value: KLINE_PERIOD.DAILY },
  { label: '周K', value: KLINE_PERIOD.WEEKLY },
];

/**
 * K 线复权方式常量（代替魔法串；'' 为不复权）
 */
export const KLINE_ADJUST = {
  NONE: '',
  QFQ: 'qfq',
  HFQ: 'hfq',
} as const satisfies Record<string, KlineAdjust>;

/** 复权方式切换选项（value 必须为 KLINE_ADJUST 成员） */
export const KLINE_ADJUST_OPTIONS: readonly { label: string; value: KlineAdjust }[] = [
  { label: '前复权', value: KLINE_ADJUST.QFQ },
  { label: '后复权', value: KLINE_ADJUST.HFQ },
  { label: '不复权', value: KLINE_ADJUST.NONE },
];

/** K 线默认拉取窗口：近一年（自然日） */
export const KLINE_RANGE_DAYS = 365;

/** K 线图默认可见 bar 数（dataZoom 初始窗口，约半年交易日） */
export const KLINE_VISIBLE_BARS = 120;

/** MA 快 / 慢线周期（与信号识别口径一致） */
export const MA_FAST_PERIOD = 5;
export const MA_SLOW_PERIOD = 20;

/**
 * A 股分时时段常量（生成固定 09:30~15:00 时间轴，避免盘中拉伸）
 */
export const MINUTE_SESSION = {
  AM_START: '09:30',
  AM_END: '11:30',
  PM_START: '13:00',
  PM_END: '15:00',
} as const;

/** 分时轴上午分钟数（含 09:30 与 11:30） */
export const MINUTE_AM_COUNT = 121;

/** 分时轴下午分钟数（含 13:00 与 15:00） */
export const MINUTE_PM_COUNT = 121;

/** 分时轴总点数 */
export const MINUTE_AXIS_TOTAL = MINUTE_AM_COUNT + MINUTE_PM_COUNT;

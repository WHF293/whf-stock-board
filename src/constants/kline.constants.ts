import type {
  KlineAdjust,
  KlinePeriod,
  MinuteAxisRange,
  MinuteAxisTick,
} from '../types/kline.types';

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
 * A 股分时固定时间轴分段（与上游 1 分钟线口径一致）
 *
 * 上午 09:31~11:30、下午 13:01~14:57 为连续竞价逐分钟；14:58 / 14:59 属收盘集合竞价
 * （无逐分钟成交），收盘价单独占 15:00 一格 —— 合计 238 格。
 * 盘中接口只下发已发生的分钟，补齐到该时间轴后 X 轴才恒定横跨全天
 */
export const MINUTE_AXIS_RANGES: readonly MinuteAxisRange[] = [
  { start: '09:31', count: 120 },
  { start: '13:01', count: 117 },
  { start: '15:00', count: 1 },
];

/** 分时固定时间轴总格数（238） */
export const MINUTE_AXIS_TOTAL = MINUTE_AXIS_RANGES.reduce(
  (total, range) => total + range.count,
  0,
);

/**
 * 分时 X 轴固定刻度（time 为轴上的分钟时刻，label 为展示文案）
 *
 * 09:31 是当日首根分钟线，按分时图惯例左端标注开盘时刻 09:30
 */
export const MINUTE_AXIS_TICKS: readonly MinuteAxisTick[] = [
  { time: '09:31', label: '09:30' },
  { time: '10:30', label: '10:30' },
  { time: '11:30', label: '11:30' },
  { time: '14:00', label: '14:00' },
  { time: '15:00', label: '15:00' },
];

/** MACD 参数（快线 / 慢线 / 信号线，与图表库内置口径一致） */
export const MACD_PARAMS = [12, 26, 9] as const;

/**
 * 分时涨跌幅轴的上下留白系数（相对可视区最大绝对涨跌幅）
 *
 * 分时 / 五日的 Y 轴以 0% 为中心上下对称：边界 = max(|min|, |max|) × 本系数。
 * 库内轴 gap 已归零（非对称 gap 会破坏对称性），留白由本系数统一提供
 */
export const TIMELINE_PCT_AXIS_HEADROOM = 1.1;

/**
 * 新浪单次请求的最大根数
 *
 * 实测上游上限约 1970 条，超过即返回 `var _=(null);`（见 parseJsonp 的显式报错）。
 * 请求配置与「补尾部缺口估算」共用本值，避免两处各自写一个上限而漂移。
 */
export const KLINE_MAX_BARS_PER_REQUEST = 1900;

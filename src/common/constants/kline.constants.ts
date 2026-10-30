import type { MinuteAxisRange, MinuteAxisTick } from '../types/kline.types.ts';

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

/**
 * 港股分时固定时间轴分段（与港股连续竞价时段逐分钟对齐）
 *
 * 上午 09:31~12:00、下午 13:01~16:00，合计 330 格。
 * 港股无 A 股式尾盘集合竞价，16:00 即最后一格
 */
export const HK_MINUTE_AXIS_RANGES: readonly MinuteAxisRange[] = [
  { start: '09:31', count: 150 },
  { start: '13:01', count: 180 },
];

/** 港股分时固定时间轴总格数（330） */
export const HK_MINUTE_AXIS_TOTAL = HK_MINUTE_AXIS_RANGES.reduce(
  (total, range) => total + range.count,
  0,
);

/**
 * 港股分时 X 轴固定刻度（7 个）
 *
 * 左端标注开盘时刻 09:30，午休分界标注 13:00（13:01 为午后首根）
 */
export const HK_MINUTE_AXIS_TICKS: readonly MinuteAxisTick[] = [
  { time: '09:31', label: '09:30' },
  { time: '10:30', label: '10:30' },
  { time: '11:30', label: '11:30' },
  { time: '13:01', label: '13:00' },
  { time: '14:00', label: '14:00' },
  { time: '15:00', label: '15:00' },
  { time: '16:00', label: '16:00' },
];

/**
 * 分时固定时间轴配置按市场（`cn` A 股缺省 / `hk` 港股）
 *
 * KlineChart 的 market prop 与 padMinuteBars / buildMinuteAxis 的 ranges 参数
 * 都从本表取值；A 股为缺省市场，既有调用方零改动
 */
export const MINUTE_AXIS_CONFIG = {
  cn: {
    ranges: MINUTE_AXIS_RANGES,
    total: MINUTE_AXIS_TOTAL,
    ticks: MINUTE_AXIS_TICKS,
  },
  hk: {
    ranges: HK_MINUTE_AXIS_RANGES,
    total: HK_MINUTE_AXIS_TOTAL,
    ticks: HK_MINUTE_AXIS_TICKS,
  },
} as const;

/** 分时轴市场（`cn` A 股 / `hk` 港股） */
export type MinuteAxisMarket = keyof typeof MINUTE_AXIS_CONFIG;

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

/**
 * 新浪 K 线成交量 → 行情报价（手）的换算除数（股/手）
 *
 * 实测新浪 K 线 volume 单位为股，与行情快照的「手」差 100 倍
 * （如湘佳股份 2026-10-23 一字板 volume=3404120 股 = 3.40 万手）；
 * K 线悬停数据联动到行情头时按本值换算
 */
export const KLINE_VOLUME_SHARES_PER_LOT = 100;

/**
 * 新浪 K 线成交额 → 行情报价（万）的换算除数（元/万）
 *
 * 新浪 K 线 amount 单位为元，且仅分钟级周期返回（日 / 周 / 月 K 无此字段，
 * bar.turnover 恒为 0）；K 线悬停数据联动到行情头时按本值换算
 */
export const KLINE_TURNOVER_YUAN_PER_WAN = 10_000;

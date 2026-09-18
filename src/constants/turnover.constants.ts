import type { TurnoverDayItem } from '../types/turnover.types';

/**
 * 成交量变化模块常量（市场总览页）
 */

/** 参与合计的指数符号（腾讯行情形态，newfqkline 接口直接消费） */
export const TURNOVER_INDEX_SYMBOLS = {
  /** 上证指数 */
  SH: 'sh000001',
  /** 深证成指 */
  SZ: 'sz399001',
} as const;

/** 可选交易日窗口 */
export const TURNOVER_RANGE = {
  /** 近 30 个交易日 */
  D30: 30,
  /** 近 60 个交易日 */
  D60: 60,
  /** 近 180 个交易日 */
  D180: 180,
} as const;

/** 交易日窗口类型 */
export type TurnoverRange = (typeof TURNOVER_RANGE)[keyof typeof TURNOVER_RANGE];

/** 交易日窗口切换选项（BaseTabs 要求字符串 value，展示时经 v-model 适配层转换） */
export const TURNOVER_RANGE_TAB_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '近30日', value: String(TURNOVER_RANGE.D30) },
  { label: '近60日', value: String(TURNOVER_RANGE.D60) },
  { label: '近180日', value: String(TURNOVER_RANGE.D180) },
];

/** 默认交易日窗口（近 30 日） */
export const TURNOVER_RANGE_DEFAULT: TurnoverRange = TURNOVER_RANGE.D30;

/** 成交额图表的量纲口径（仅图表视图可切） */
export const TURNOVER_CHART_METRIC = {
  /** 成交量：各市场当日成交额（亿元） */
  AMOUNT: 'amount',
  /** 相对成交量：当日成交额 − 上一交易日成交额（差额，放量正 / 缩量负） */
  RELATIVE: 'relative',
} as const;

/** 量纲口径类型 */
export type TurnoverChartMetric =
  (typeof TURNOVER_CHART_METRIC)[keyof typeof TURNOVER_CHART_METRIC];

/** 量纲口径切换选项（BaseTabs；图表视图下展示） */
export const TURNOVER_CHART_METRIC_OPTIONS: readonly {
  label: string;
  value: TurnoverChartMetric;
}[] = [
  { label: '成交量', value: TURNOVER_CHART_METRIC.AMOUNT },
  { label: '相对成交量', value: TURNOVER_CHART_METRIC.RELATIVE },
];

/** 量纲口径默认值（成交量） */
export const TURNOVER_CHART_METRIC_DEFAULT: TurnoverChartMetric = TURNOVER_CHART_METRIC.AMOUNT;

/** 成交额表格行（派生展示字段；供 BaseTable 渲染） */
export interface TurnoverTableRow extends TurnoverDayItem {
  /** 总成交额（亿元，保留 2 位） */
  totalAmountYi: string;
  /** 上证成交额（亿元，保留 2 位） */
  shanghaiAmountYi: string;
  /** 深证成交额（亿元，保留 2 位） */
  shenzhenAmountYi: string;
  /** 总成交额较上一交易日变化率（%）；首日 / 无前值为 null */
  changePct: number | null;
  /**
   * 「较上日」展示文案（放量 / 缩量 / 持平 + 变化额 + 变化率）
   * 形如 `放量 1234.56亿（14.10%）` / `缩量 567.89亿（-1.10%）`；首日 / 无前值为 null
   */
  changeText: string | null;
}

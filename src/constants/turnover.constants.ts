import type { TurnoverDayItem } from '../types/turnover.types';

/**
 * 成交量变化模块常量（市场总览页）
 */

/** 参与合计的指数 secid（东方财富 push2 kline 形态，上证 1.000001 / 深证 0.399001） */
export const TURNOVER_INDEX_SECIDS = {
  /** 上证指数 */
  SH: '1.000001',
  /** 深证成指 */
  SZ: '0.399001',
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
}

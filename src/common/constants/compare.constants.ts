/**
 * 自选多票叠加对比常量
 *
 * 区间预设克制（不做自定义日期）；系列色板与热力图分类色无关，
 * 取一组高区分度的顺序色，叠加 ≤ 6 条时肉眼可分
 */

import type { CompareStatsItem } from '../types/compare.types';

/** 区间预设（交易日数） */
export const COMPARE_RANGE_OPTIONS = [
  { label: '近 30 日', value: 30 },
  { label: '近 60 日', value: 60 },
  { label: '近 120 日', value: 120 },
  { label: '近 250 日', value: 250 },
] as const;

/** 区间预设值类型 */
export type CompareRangeDays = (typeof COMPARE_RANGE_OPTIONS)[number]['value'];

/** 默认区间（交易日） */
export const COMPARE_RANGE_DEFAULT: CompareRangeDays = 60;

/** 最多同时对比的票数（超过时勾选被拒并提示） */
export const COMPARE_MAX_STOCKS = 6;

/** 叠加曲线系列色板（按勾选顺序取用） */
export const COMPARE_SERIES_COLORS = [
  '#5b8ff9',
  '#f6903d',
  '#61bf9a',
  '#b37feb',
  '#e8684a',
  '#2cb3c9',
] as const;

/** 共同交易日占比低于该阈值视为「上市时间差异过大」（提示但不阻断） */
export const COMPARE_COMMON_RATIO_MIN = 0.5;

/** 统计表列（表头文案集中于此，组件不再散落字面量） */
export const COMPARE_STATS_COLUMNS = [
  { key: 'name', label: '名称' },
  { key: 'changePct', label: '区间涨跌幅' },
  { key: 'maxDrawdownPct', label: '最大回撤' },
  { key: 'annualVolPct', label: '年化波动率' },
] as const satisfies readonly { key: keyof CompareStatsItem; label: string }[];

/**
 * 使用统计看板常量（UsageStatsView）
 */

/** 热力格覆盖周数（列数，含当前周；列内 7 行 = 周一..周日） */
export const USAGE_HEATMAP_WEEKS = 16;

/** 热力格数据档数（另有 0 档 = 无活动的空格；按当日 tokens 相对峰值归一化取档） */
export const USAGE_HEATMAP_LEVELS = 4;

/** 热力格色阶 alpha（8 位 hex 的透明段，与数据档 1..4 一一对应，从淡到浓） */
export const USAGE_HEATMAP_ALPHAS: readonly string[] = ['26', '59', '99', 'd9'];

/** 主题色 CSS 变量非 hex 值时热力格的兜底色（避免拼接出非法 color） */
export const USAGE_HEATMAP_FALLBACK_COLOR = '#4f83cc';

/** 每日 Token 趋势图可选窗口（天） */
export const USAGE_TREND_DAYS = [7, 30] as const;

/** 趋势窗口类型 */
export type UsageTrendDays = (typeof USAGE_TREND_DAYS)[number];

/** 趋势窗口默认值（天） */
export const USAGE_TREND_DAYS_DEFAULT: UsageTrendDays = 30;

/** 趋势图最大系列数（模型再多只画用量最高的前 N 条） */
export const USAGE_TREND_MAX_SERIES = 6;

/** 趋势图系列固定配色（首条线用主题色，后续按序取这里；避免与常用主题色撞色把蓝放最后） */
export const USAGE_TREND_PALETTE: readonly string[] = [
  '#f97316',
  '#22d3ee',
  '#e886a8',
  '#9061f9',
  '#c8920b',
  '#4f83cc',
];

/** 趋势图高度（像素，与热力格区块高度合看节奏协调） */
export const USAGE_TREND_CHART_HEIGHT = 220;

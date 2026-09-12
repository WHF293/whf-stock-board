/**
 * 市场总览页展示的指数代码（腾讯符号形态，sdk.quotes.cn 可直接消费）
 *
 * 顺序即卡片展示顺序：上证指数 / 深证成指 / 创业板指 / 科创 50
 */
export const INDEX_SYMBOLS = ['sh000001', 'sz399001', 'sz399006', 'sh000688'] as const;

/**
 * 板块热力图 Top N 可选数量
 */
export const HEATMAP_TOP_OPTIONS = [10, 20, 30, 50] as const;

/** 板块热力图默认展示数量（按总市值加权取 Top N） */
export const HEATMAP_TOP_DEFAULT = 20;

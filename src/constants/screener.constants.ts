/**
 * 选股器 / 回测常量
 */

/** 筛选结果默认条数 */
export const SCREENER_TOP_N = 20;

/** 筛选结果条数选项 */
export const SCREENER_TOP_N_OPTIONS = [10, 20, 50] as const;

/** 回测初始资金（元，SDK 默认口径） */
export const BACKTEST_INITIAL_CAPITAL = 100_000;

/**
 * 回测费率（A 股口径：佣金双边 + 卖出印花税）
 */
export const BACKTEST_FEE = {
  buy: 0.0003,
  sell: 0.0013,
} as const;

/** 回测默认区间（自然日），与 K 线页一致取近一年 */
export const BACKTEST_RANGE_DAYS = 365;

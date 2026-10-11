/**
 * 沪深两市成交额相关类型（成交额变化模块）
 */

/** 沪深两市逐日成交额条目（数据源：东方财富 push2 指数日 K 的成交额字段 f57，单位元） */
export interface TurnoverDayItem {
  /** 交易日（YYYY-MM-DD） */
  date: string;
  /** 两市总成交额（元；上证指数 + 深证成指当日成交额相加） */
  totalAmount: number;
  /** 上证指数当日成交额（元） */
  shanghaiAmount: number;
  /** 深证成指当日成交额（元） */
  shenzhenAmount: number;
}

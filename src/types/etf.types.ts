/**
 * ETF 持仓股类型（天天基金 f10 季度报告披露口径）
 */

/** ETF 持仓股单条（报告期静态数据，非实时行情） */
export interface EtfHoldingItem {
  /** 股票代码（6 位数字） */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 最新价（元；报告披露时点的价格，可能为 null） */
  price: number | null;
  /** 涨跌幅（%；披露时点，可能为 null） */
  changePercent: number | null;
  /** 占净值比例（%；可能为 null） */
  netValueRatio: number | null;
  /** 持股数（万股；可能为 null） */
  holdShares: number | null;
  /** 持仓市值（万元；可能为 null） */
  holdMarketValue: number | null;
}

/** 一只 ETF 的完整持仓记录（本地缓存与网络返回共用） */
export interface EtfHoldingsRecord {
  /** ETF 代码（6 位数字） */
  code: string;
  /** 报告截止日（`YYYY-MM-DD`，季度披露；取不到时为空串） */
  reportDate: string;
  /** 本地抓取时间戳（毫秒） */
  fetchedAt: number;
  /** 持仓股列表（按占净值比例降序，即上游披露顺序） */
  holdings: EtfHoldingItem[];
}

/** 本地持仓缓存整包（localStorage 命名空间的值结构） */
export type EtfHoldingsCache = Record<string, EtfHoldingsRecord>;

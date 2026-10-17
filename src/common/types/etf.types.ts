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

/** ETF 基金概况记录（天天基金 f10「基金概况」页披露口径，字段均为原始文本，缺失为 null） */
export interface EtfProfileRecord {
  /** ETF 代码（6 位数字） */
  code: string;
  /** 本地抓取时间戳（毫秒） */
  fetchedAt: number;
  /** 基金全称 */
  fullName: string | null;
  /** 基金类型（如 指数型-股票） */
  fundType: string | null;
  /** 发行日期 */
  issueDate: string | null;
  /** 成立日期/规模（原文，如 `2012年05月04日 / 329.686亿份`） */
  setupInfo: string | null;
  /** 净资产规模（原文，含截止日期） */
  netAssetScale: string | null;
  /** 份额规模（原文，含截止日期） */
  shareScale: string | null;
  /** 基金管理人 */
  manager: string | null;
  /** 基金托管人 */
  custodian: string | null;
  /** 基金经理人 */
  fundManager: string | null;
  /** 成立来分红（原文，如 `每份累计0.88元（14次）`） */
  dividend: string | null;
  /** 管理费率 */
  mgmtFeeRate: string | null;
  /** 托管费率 */
  custodyFeeRate: string | null;
  /** 销售服务费率 */
  salesServiceFeeRate: string | null;
  /** 最高认购费率 */
  maxSubscribeFeeRate: string | null;
  /** 最高申购费率 */
  maxPurchaseFeeRate: string | null;
  /** 最高赎回费率 */
  maxRedeemFeeRate: string | null;
  /** 业绩比较基准 */
  benchmark: string | null;
  /** 跟踪标的（主动型基金无此字段） */
  trackingTarget: string | null;
  /** 投资目标（长文本，缺失为 null） */
  objective: string | null;
}

/** 本地概况缓存整包（localStorage 命名空间的值结构） */
export type EtfProfileCache = Record<string, EtfProfileRecord>;

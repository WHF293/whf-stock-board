/**
 * 财务数据类型（东财 datacenter 报表裁剪字段，供 Agent 财务工具消费）
 *
 * 上游原始字段为拼音缩写（YSTZ / SJLTZ / XSMLL…），这里统一映射为可读英文名；
 * 金额单位一律为元，比率单位一律为 %（与上游一致，不再换算）。
 */

/** 报表公共字段（每张报表行都带） */
interface ReportRowBase {
  /** 6 位证券代码（如 600519） */
  code: string;
  /** 证券简称 */
  name: string;
  /** 报告期（YYYY-MM-DD） */
  reportDate: string;
  /** 公告日期（YYYY-MM-DD；未披露为 null） */
  noticeDate: string | null;
}

/** 财务摘要行（RPT_LICO_FN_CPD） */
export interface FinancialSummaryRow extends ReportRowBase {
  /** 报告类型描述（如「2026年 半年报」） */
  dataType: string;
  /** 营业总收入（元） */
  totalOperateIncome: number | null;
  /** 归母净利润（元） */
  parentNetprofit: number | null;
  /** 营收同比增长（%） */
  revenueYoY: number | null;
  /** 归母净利同比增长（%） */
  profitYoY: number | null;
  /** 营收环比增长（%） */
  revenueQoQ: number | null;
  /** 归母净利环比增长（%） */
  profitQoQ: number | null;
  /** 基本每股收益（元） */
  basicEps: number | null;
  /** 扣非每股收益（元） */
  deductBasicEps: number | null;
  /** 每股净资产（元） */
  bps: number | null;
  /** 加权平均 ROE（%） */
  weightedAvgRoe: number | null;
  /** 销售毛利率（%） */
  grossMargin: number | null;
  /** 每股经营现金流（元） */
  operatingCashFlowPerShare: number | null;
  /** 分配预案描述（如「不分配不转增」） */
  dividendPlan: string | null;
  /** 所属行业（东财板块名） */
  industry: string | null;
}

/** 资产负债表行（RPT_DMSK_FN_BALANCE，关键科目） */
export interface BalanceSheetRow extends ReportRowBase {
  /** 总资产（元） */
  totalAssets: number | null;
  /** 总负债（元） */
  totalLiabilities: number | null;
  /** 股东权益合计（元） */
  totalEquity: number | null;
  /** 资产负债率（%） */
  debtAssetRatio: number | null;
  /** 流动比率 */
  currentRatio: number | null;
  /** 货币资金（元） */
  monetaryFunds: number | null;
  /** 应收账款（元） */
  accountsReceivable: number | null;
  /** 存货（元） */
  inventory: number | null;
  /** 应付账款（元） */
  accountsPayable: number | null;
  /** 固定资产（元） */
  fixedAssets: number | null;
}

/** 现金流量表行（RPT_DMSK_FN_CASHFLOW，关键科目） */
export interface CashFlowRow extends ReportRowBase {
  /** 经营活动现金流净额（元） */
  operatingNetCash: number | null;
  /** 销售商品、提供劳务收到的现金（元） */
  cashFromSales: number | null;
  /** 投资活动现金流净额（元） */
  investingNetCash: number | null;
  /** 购建固定资产等资本开支（元） */
  capitalExpenditure: number | null;
  /** 筹资活动现金流净额（元） */
  financingNetCash: number | null;
  /** 现金及现金等价物净增加额（元） */
  netCashIncrease: number | null;
}

/** 业绩预告行（RPT_PUBLIC_OP_NEWPREDICT，仅已披露公司有行） */
export interface ProfitForecastRow extends ReportRowBase {
  /** 预告指标名（如「净利润」「营业收入」） */
  metricName: string;
  /** 预告金额下限（元） */
  amountLower: number | null;
  /** 预告金额上限（元） */
  amountUpper: number | null;
  /** 预告同比增幅下限（%） */
  growthLower: number | null;
  /** 预告同比增幅上限（%） */
  growthUpper: number | null;
  /** 预告类型（略增 / 预增 / 扭亏 / 预减…） */
  predictType: string | null;
  /** 预告内容原文 */
  content: string | null;
  /** 上年同期值（元） */
  priorYearSamePeriod: number | null;
}

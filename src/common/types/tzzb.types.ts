/**
 * 投资账本（tzzb）MCP 数据类型
 *
 * 前端展示口径的精简类型：原始 MCP 响应字段（字符串数字 / 科学计数法 /
 * columns+rows 矩阵等）统一在 api/tzzb.api.ts 的映射层转成本文件类型，
 * UI 组件只消费这里。字段口径与内测采样（2026-10-23）对齐，
 * 正式版 schema 调整时只改映射层。
 */

/** 账户类型：stock 普通股票 / rzrq 融资融券 / manual 手工记账 / fund 基金 */
export type TzzbAccountKind = 'stock' | 'rzrq' | 'manual' | 'fund';

/** 投资账本账户（promptAccountSelection 分组映射） */
export interface TzzbAccount {
  /** 账户 id（fund_key / rzrq_fund_key / manual_id / fund_id 分组原样 id） */
  id: string;
  /** 账户名称 */
  name: string;
  /** 账户类型（决定选择器分组） */
  kind: TzzbAccountKind;
}

/** 资产趋势点（queryPnlSummary.netValueTrend，日期 yyyyMMdd） */
export interface TzzbAssetPoint {
  date: string;
  /** 总资产 */
  totalAsset: number;
  /** 当日盈亏 */
  dailyProfit: number;
  /** 净值指数（基点 1000） */
  navIndex: number;
  /** 仓位比例 0~1 */
  positionRatio: number;
}

/** 指数趋势点（queryPnlSummary.shIndexTrend，点位原值，绘图时按基点归一化） */
export interface TzzbIndexPoint {
  date: string;
  /** 上证指数点位 */
  sh: number;
  /** 沪深300 点位 */
  hs300: number;
}

/** 资产曲线汇总（queryPnlSummary） */
export interface TzzbPnlSummary {
  /** 区间总盈亏 */
  totalProfit: number;
  /** 区间收益率（小数口径） */
  totalRate: number;
  assetTrend: TzzbAssetPoint[];
  indexTrend: TzzbIndexPoint[];
}

/** 持仓汇总（queryStockPosition 顶层字段） */
export interface TzzbPositionSummary {
  totalAsset: number;
  marketValue: number;
  /** 可用资金（可能为负：含未确认交收） */
  availableFunds: number;
  /** 仓位比例 0~1 */
  positionRatio: number;
}

/** 区间资金变动单侧（queryAssetChangeSummary 的 stock / fund 子对象） */
export interface TzzbAssetChangeSide {
  startAsset: number;
  transferIn: number;
  transferOut: number;
  dividend: number;
  profit: number;
  endAsset: number;
}

/** 区间资金变动（queryAssetChangeSummary；无数据侧为 null） */
export interface TzzbAssetChange {
  stock: TzzbAssetChangeSide | null;
  fund: TzzbAssetChangeSide | null;
}

/** 盈亏日历单日点（日期 yyyyMMdd） */
export interface TzzbCalendarDay {
  date: string;
  /** 当日盈亏 */
  profit: number;
  /** 当日收益率（小数口径） */
  rate: number;
}

/** 指数区间涨跌 */
export interface TzzbIndexChange {
  name: string;
  /** 区间涨跌幅（小数口径） */
  rate: number;
}

/** 当月盈亏汇总（queryDayCalendarSummary.profit_map） */
export interface TzzbCalendarMonthSummary {
  stockProfit: number;
  fundProfit: number;
  total: number;
  rate: number;
}

/** 盈亏日历（月视图，queryDayCalendarSummary） */
export interface TzzbDayCalendar {
  /** 月份 yyyyMM */
  month: string;
  days: TzzbCalendarDay[];
  summary: TzzbCalendarMonthSummary;
  indexes: TzzbIndexChange[];
}

/** 盈亏日历单月点（queryMonthCalendarSummary，月份 yyyyMM） */
export interface TzzbMonthPoint {
  month: string;
  profit: number;
  rate: number;
}

/** 盈亏日历（年视图：12 个月点，queryMonthCalendarSummary） */
export interface TzzbMonthCalendar {
  /** 年份 yyyy */
  year: string;
  months: TzzbMonthPoint[];
}

/** 年度聚合点（年历格；由 queryMonthCalendarSummary 逐年拉取后前端聚合） */
export interface TzzbYearPoint {
  year: string;
  profit: number;
  rate: number;
}

/** 建清仓记录（queryClearedPosition，完整买卖回合） */
export interface TzzbClearedPosition {
  code: string;
  name: string;
  /** 开仓日期 yyyy-MM-dd */
  openDate: string;
  /** 清仓日期 yyyy-MM-dd；null = 持有中 */
  closeDate: string | null;
  /** 持有天数 */
  holdDays: number;
  /** 买卖回合数 */
  rounds: number;
  avgBuy: number;
  /** 清仓均价；持有中为 null */
  avgSell: number | null;
  fee: number;
  profit: number;
  /** 收益率（小数口径；个别为倍数口径，解析层二次校验） */
  rate: number;
}

/** 个基累计收益（queryFundHoldingReturns.allProfit / allRate） */
export interface TzzbHoldingReturn {
  code: string;
  name: string;
  profit: number;
  rate: number;
}

/** 股票逐笔流水（queryMoneyHistory，无成交时间字段——见方案 12.1） */
export interface TzzbStockTrade {
  /** 成交日期 yyyy-MM-dd */
  date: string;
  code: string;
  name: string;
  /** 操作名称（买入 / 卖出） */
  action: string;
  price: number;
  /** 成交数量（股 / 份，原文无符号，方向看 action） */
  quantity: number;
  amount: number;
  commission: number;
  transferFee: number;
  feeTotal: number;
}

/** 股票流水分页（page >= maxPage 终止） */
export interface TzzbStockTradePage {
  page: number;
  maxPage: number;
  list: TzzbStockTrade[];
}

/** 基金申赎流水（queryFundSummaryHistory，六元组重复行已去重） */
export interface TzzbFundTrade {
  /** 确认日期 yyyy-MM-dd */
  date: string;
  accountName: string;
  code: string;
  name: string;
  /** 操作名称（申购 / 赎回 / 定投） */
  action: string;
  amount: number;
  shares: number;
}

/** 同步状态（mock 阶段取采样元信息，真实阶段取 tzzb_sync_state 水位） */
export interface TzzbSyncMeta {
  /** 上次同步时间（展示文案） */
  lastSyncLabel: string;
  /** 数据截止日 yyyy-MM-dd */
  dataDate: string;
  /** 授权到期文案 */
  authExpireLabel: string;
}

/** 指数代码 → 展示名（total_index 的 key，口径按指数通代码表） */
export const TZZB_INDEX_NAME: Record<string, string> = {
  '1B0016': '上证50',
  '1B0300': '沪深300',
  '1A0001': '上证指数',
  '399001': '深证成指',
  '399006': '创业板指',
  '1B0905': '中证500',
  '399101': '中小综指',
  HSI: '恒生指数',
};

/** 投资账本官网地址（系统浏览器打开入口用；正式域名，王总 2026-10-23 提供） */
export const TZZB_OFFICIAL_SITE_URL = 'https://tzzb.10jqka.com.cn/pc/index.html';

/** 资产曲线区间选项（value 与 queryPnlSummary 的区间参数口径对齐；custom = 自定义起止日） */
export const TZZB_RANGE_OPTIONS = [
  { label: '本月', value: 'm1' },
  { label: '近三月', value: 'm3' },
  { label: '近六月', value: 'm6' },
  { label: '近一年', value: 'y1' },
  { label: '今年', value: 'ytd' },
  { label: '全部', value: 'all' },
  { label: '自定义区间', value: 'custom' },
] as const;

/** 区间 value → 展示名 */
export const TZZB_RANGE_LABEL: Record<string, string> = Object.fromEntries(
  TZZB_RANGE_OPTIONS.map((o) => [o.value, o.label]),
);

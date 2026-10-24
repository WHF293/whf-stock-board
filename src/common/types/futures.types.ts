/**
 * 期货·机构行为（中金所 CCPM）类型定义
 *
 * 原始行 = 三榜（成交量 / 持买单量 / 持卖单量）按【合约 + 会员】并集归并后的行；
 * 未上榜的指标记 null（不记 0，避免污染占比与合并计算）。
 */

/** 三榜并集归并后的原始行（未计算指标） */
export interface CcpmMemberRow {
  /** 完整合约代码（如 IF2611） */
  instrumentId: string;
  /** 会员简称（代客口径） */
  memberName: string;
  /** 成交量（手），未上榜为 null */
  volume: number | null;
  /** 成交量较上一交易日增减，未上榜为 null */
  volumeChg: number | null;
  /** 持买单量（手），未上榜为 null */
  buyPos: number | null;
  /** 多单较上一交易日增减，未上榜为 null */
  buyChg: number | null;
  /** 持卖单量（手），未上榜为 null */
  sellPos: number | null;
  /** 空单较上一交易日增减，未上榜为 null */
  sellChg: number | null;
}

/** 行为标签（算法自动识别，仅供分析） */
export type CcpmBehaviorTag = 'hedge' | 'long' | 'short';

/** 合约整体合计（该合约全部上榜会员求和） */
export interface CcpmInstrumentTotals {
  /** 合约代码 */
  instrumentId: string;
  /** 上榜总成交量（手） */
  volume: number;
  /** 上榜总多单（手） */
  buy: number;
  /** 上榜总空单（手） */
  sell: number;
}

/** 单合约维度：原始行 + 计算指标 */
export interface CcpmMemberStats extends CcpmMemberRow {
  /** 净持仓 = buyPos − sellPos（两侧都未上榜时为 null） */
  netPos: number | null;
  /** 净增减 = buyChg − sellChg（两侧都未上榜时为 null） */
  netChg: number | null;
  /** 多头占比（%）：buyPos ÷ 该合约上榜总多单 × 100，未上榜为 null */
  buyRatio: number | null;
  /** 空头占比（%）：sellPos ÷ 该合约上榜总空单 × 100，未上榜为 null */
  sellRatio: number | null;
  /** 行为标签；数据不足以判定（任一侧未上榜 / 全平）时为 null */
  tag: CcpmBehaviorTag | null;
  /** 标签判定依据（hover tooltip 展示）；无标签时说明原因 */
  tagReason: string | null;
}

/** 品种单日数据（一个品种一个披露文件解析 + 归并后的完整结果） */
export interface CcpmProductDayData {
  /** 交易日（yyyyMMdd，取自 CSV 数据行） */
  tradingDay: string;
  /** 品种代码（IF / IH / …） */
  product: string;
  /** 当日挂牌且披露的合约列表（按 CSV 出现顺序） */
  instruments: string[];
  /** 三榜并集归并后的原始行（全部合约） */
  rows: CcpmMemberRow[];
  /** 合约 → 整体合计 */
  totals: Record<string, CcpmInstrumentTotals>;
}

/** 跨合约 / 跨品种聚合行（一行一个会员） */
export interface CcpmAggregateRow {
  /** 会员简称 */
  memberName: string;
  /** 合并多单（上榜合约求和，null 侧记 0） */
  totalBuy: number;
  /** 合并空单 */
  totalSell: number;
  /** 合并净持仓 = totalBuy − totalSell */
  totalNet: number;
  /** 合并多头增减 */
  totalBuyChg: number;
  /** 合并空头增减 */
  totalSellChg: number;
  /** 合并净增减 = totalBuyChg − totalSellChg */
  totalNetChg: number;
  /** 合并成交量（仅同品种口径参与，跨品种口径不合并成交量） */
  totalVolume: number;
  /** 上榜合约数（该会员有数据的合约数） */
  coveredCount: number;
  /** 该口径下的合约总数（品种合约数 / 全股指合约数之和） */
  totalCount: number;
  /** coveredCount < totalCount：合并结果为部分头寸，页面必须红字提示 */
  isPartial: boolean;
  /** 行为标签（与单合约同一套规则，作用于合并后的多空总量与增减；无法判定时 null） */
  tag: CcpmBehaviorTag | null;
  /** 标签判定依据（hover tooltip 展示）；无标签时说明原因 */
  tagReason: string | null;
}

/** 聚合口径 */
export type CcpmScopeMode = 'contract' | 'product' | 'all';

/** 席位单日聚合点（时序图 / 跨品种明细用） */
export interface CcpmMemberDayPoint {
  /** 交易日 yyyyMMdd */
  tradingDay: string;
  /** 合并多单 */
  totalBuy: number;
  /** 合并空单 */
  totalSell: number;
  /** 合并净持仓 */
  totalNet: number;
  /** 合并净增减 */
  totalNetChg: number;
  /** 上榜合约数 / 口径合约总数（完整性） */
  coveredCount: number;
  totalCount: number;
}

/** 时序图数据：某席位近 N 个披露日的合并净持仓走势 */
export interface CcpmMemberSeries {
  /** 席位名 */
  memberName: string;
  /** 品种范围（同品种 or 全股指） */
  products: readonly string[];
  /** 按交易日升序的点列 */
  points: CcpmMemberDayPoint[];
}

/** 表格排序字段（白名单，服务端无排序，前端本地排） */
export type CcpmSortKey =
  | 'volume'
  | 'buyPos'
  | 'sellPos'
  | 'netPos'
  | 'netChg'
  | 'buyChg'
  | 'sellChg'
  | 'totalBuy'
  | 'totalSell'
  | 'totalNet'
  | 'totalNetChg';

/** 排序方向 */
export type CcpmSortOrder = 'asc' | 'desc';

/* ==================== 期货总览（同花顺期货通 futgwapi） ==================== */

/** 主力流况状况（主力合约涨跌家数统计） */
export interface FuturesMainContractOverview {
  /** 涨停家数 */
  riseLimit: number;
  /** 上涨家数 */
  rise: number;
  /** 跌停家数 */
  fallLimit: number;
  /** 下跌家数 */
  fall: number;
  /** 平盘家数 */
  flat: number;
}

/** 品种资金流向条目（capital 单位：元，当日主力合约资金净流入） */
export interface FuturesCapitalFlowItem {
  /** 品种名（原油 / 沪金…） */
  name: string;
  /** 品种代码（sc / au…） */
  code: string;
  /** 市场 id（65=上期所系 / 67=郑商所系…，仅透传） */
  marketId: string;
  /** 资金净流向（元，正 = 流入） */
  capital: number;
}

/** 资金流向预览排名（首页四强四弱） */
export interface FuturesCapitalFlowsRank {
  /** 流入前四 */
  topFour: FuturesCapitalFlowItem[];
  /** 流出前四 */
  lastFour: FuturesCapitalFlowItem[];
}

/** 主力持仓多空比条目（longRate = 前20会员多单占比 %，主力合约口径） */
export interface FuturesPositionRateItem {
  /** 品种名 */
  name: string;
  /** 主力合约代码（au2612…） */
  code: string;
  /** 市场 id */
  marketId: string;
  /** 多单占比（%，空单占比 = 100 − longRate） */
  longRate: number;
  /** 交易所席位编码（透传） */
  placeCode: string;
}

/** 多空比预览排名（首页三强三弱） */
export interface FuturesPositionRateRank {
  /** 多占比最高前三 */
  topThree: FuturesPositionRateItem[];
  /** 多占比最低前三 */
  lastThree: FuturesPositionRateItem[];
}

/** 品种主力合约映射条目（getMainContractDetailList result 行，仅保留渲染所需字段） */
export interface FuturesVarietyContract {
  /** 品种代码（大写，如 AU / RB / SC） */
  variety: string;
  /** 品种名（沪金 / 螺纹钢…，上游 varietyName 原文） */
  varietyName: string;
  /** 主力合约代码（au2612 / rb2701…，产业链 F10 页面的 code 参数） */
  contractCode: string;
}

/** 期货市场总览（futgwapi v2/home 一次拉齐三个模块） */
export interface FuturesOverviewHome {
  mainContractOverview: FuturesMainContractOverview;
  capitalFlowsRank: FuturesCapitalFlowsRank;
  positionRateRank: FuturesPositionRateRank;
}

/** 主力合约榜单类型（同花顺 recommend_futures 的 quote_type） */
export type FuturesRankQuoteType = 'rise_percent' | 'fall_percent' | 'turnover' | 'increase_position';

/** 榜单合约条目（同花顺 recommend_futures 行） */
export interface FuturesRankContract {
  /** 同花顺市场码（透传，仅溯源用；行情不走它） */
  market: string;
  /** 合约代码（如 `au2612` / `IM2612`） */
  contractCode: string;
  /** 合约名（如 `沪金2612`） */
  contractName: string;
  /** 到期日（yyyymmdd） */
  expiredDate?: number;
}

/** 榜单行 = 榜单合约 + 行情快照（东财 ulist）合并结果 */
export interface FuturesRankRow {
  /** 合约 */
  contract: FuturesRankContract;
  /** 最新价 */
  lastPrice: number | null;
  /** 涨跌幅（%） */
  changePercent: number | null;
  /** 成交额（元） */
  turnover: number | null;
  /** 日增仓（手，正 = 增仓） */
  oiChange: number | null;
}

/** 四张主力合约榜单（涨幅 / 跌幅 / 成交额 / 日增仓，各取前列） */
export type FuturesRankBoards = Record<FuturesRankQuoteType, FuturesRankRow[]>;

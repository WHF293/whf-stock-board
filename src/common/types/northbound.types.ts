/**
 * 沪深港通（北向/南向）资金模块类型统一出口：re-export stock-sdk + 业务扩展
 */
import type { NorthboundHistoryItem } from 'stock-sdk';

export type {
  NorthboundDirection,
  NorthboundFlowSummary,
  NorthboundHistoryItem,
  NorthboundIndividualItem,
  NorthboundMinuteItem,
  NorthboundMarket,
} from 'stock-sdk';

/** 历史卡时间范围（30/60/120 自然日） */
export type NorthboundHistoryRange = '30d' | '60d' | '120d';

/**
 * 资金历史行：在 stock-sdk 历史项上补充「当日成交额」
 *
 * 北向净买额自 2024-08 停止披露，成交额为北向档唯一持续披露的金额序列
 * （数据取自上游 DEAL_AMT 字段）；南向为港股通沪/深两通道加总
 */
export type NorthboundHistoryRow = NorthboundHistoryItem & {
  /** 当日成交额（元；买入 + 卖出口径） */
  dealAmount: number | null;
};

/** 排行卡市场筛选 */
export type NorthboundRankMarket = 'all' | 'shanghai' | 'shenzhen';

/**
 * 北向季度净流入估算点（港交所 CCASS 持股差分法，本地逐季累积）
 *
 * 口径：北向净买额自 2024-08 停止披露且无公开替代来源（2026-10-30 二次实测），
 * 唯一可验证的方向性估算 = 港交所披露易 CCASS 沪深股通持股纪录（全市场逐日披露，
 * 2026-11-06 实测东财停采后仍存活）相邻两期快照的持股数差分 × 收盘价。
 * 持股数变动与价格无关，只反映买卖与送转；送转除权为噪声源。
 * 季度点在季末过后的首次拉取时落定（收盘价以当时现价近似，approxPriced 标记）
 */
export interface NorthboundQuarterEstimate {
  /** 本期快照日（YYYY-MM-DD，季度末） */
  date: string;
  /** 上期快照日（YYYY-MM-DD，基线日） */
  prevDate: string;
  /** 估算净流入（元；正 = 净流入，负 = 净流出） */
  estimatedNetInflow: number;
  /** 参与差分的股票数（两期覆盖并集） */
  stockCount: number;
  /** 收盘价是否为落定时刻的现价近似（true = 未用真实季末收盘价） */
  approxPriced: boolean;
}

/** 估算榜单行（当前季度增持 / 减持 Top，差分 × 现价） */
export interface NorthboundEstimateMover {
  /** 股票代码（6 位纯代码） */
  code: string;
  /** 股票名称（来自全市场快照） */
  name: string;
  /** 持股数变动（股；正增负减） */
  sharesDelta: number;
  /** 估算金额变动（元；sharesDelta × 现价，缺价跳过为 null） */
  amount: number | null;
}

/**
 * 北向估算本地滚存库（localStorage 整包结构，version 不符整体弃置）
 *
 * 存两样：CCASS 快照（键 = YYYY-MM-DD）与已落定的季度估算点。
 * 快照是差分的原料（上游只保留 12 个月，且单份约 1MB HTML，本地缓存避免重拉）；
 * 季度点只在季末滚过时追加一次（之后不再变）
 */
export interface NorthboundEstimateStore {
  /** 存储结构版本（升级不兼容结构时递增，旧包弃置重建） */
  version: number;
  /** CCASS 快照（键 YYYY-MM-DD → 代码 → 持股数；含历史季末与近期交易日） */
  snapshots: Record<string, Record<string, number>>;
  /** 已落定的季度估算点（旧 → 新） */
  estimates: NorthboundQuarterEstimate[];
}

/** 北向估算拉取结果（当前季度进行中估算 + 本地累积的季度序列） */
export interface NorthboundEstimateState {
  /** 基线快照日（最近一个已过季末，YYYY-MM-DD） */
  baselineDate: string;
  /** 最新 CCASS 纪录日（YYYY-MM-DD，通常为 T-1） */
  latestDate: string;
  /** 当前季度进行中估算净流入（元；基线 → 最新差分 × 现价） */
  quarterNetInflow: number;
  /** 参与差分的股票数（两期覆盖并集） */
  stockCount: number;
  /** 最新快照覆盖股数 */
  snapshotCount: number;
  /** 当前季度增持 Top（金额降序） */
  topBuys: NorthboundEstimateMover[];
  /** 当前季度减持 Top（金额升序） */
  topSells: NorthboundEstimateMover[];
  /** 已落定的季度估算序列（旧 → 新） */
  estimates: NorthboundQuarterEstimate[];
}

/**
 * 北向持股排行行（季度快照口径）
 *
 * 上游现表 `RPT_MUTUAL_HOLDSTOCKNORTH_STA` 不再提供区间增持估计字段
 * （addShares / addMarketValue 等），与 stock-sdk 的 NorthboundHoldingRankItem
 * 不同，排行卡与 MCP 工具按本类型消费
 */
export interface NorthboundRankRow {
  /** 数据期（YYYY-MM-DD，季度末） */
  date: string;
  /** 股票代码（6 位纯代码） */
  code: string;
  /** 股票名称 */
  name: string;
  /** 期末收盘价（元） */
  close: number | null;
  /** 当日涨跌幅（%） */
  changePercent: number | null;
  /** 持股数量（股） */
  holdShares: number | null;
  /** 持股市值（元） */
  holdMarketValue: number | null;
  /** 持股占流通股比（%） */
  holdRatioFloat: number | null;
  /** 持股占总股本比（%） */
  holdRatioTotal: number | null;
}

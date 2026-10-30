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

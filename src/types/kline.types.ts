/**
 * K 线 / 分时 / 筹码 / 个股资金流相关类型统一出口
 */
export type {
  HistoryKline,
  KlineWithIndicators,
  MinuteTimeline,
  MinuteKline,
  TodayTimeline,
  TodayTimelineResponse,
  ChipDistributionItem,
  ChipHistogram,
  StockFundFlowDaily,
  FundFlow,
  SignalType,
} from 'stock-sdk';

import type { SignalType } from 'stock-sdk';

/** K 线周期（本项目仅用日 / 周） */
export type KlinePeriod = 'daily' | 'weekly' | 'monthly';

/** K 线复权方式（'' 为不复权） */
export type KlineAdjust = '' | 'qfq' | 'hfq';

/**
 * 技术信号（SDK kline.signals 的返回结构）
 *
 * SDK 主入口未导出 KlineSignal 类型，此处按其声明等价定义（结构化兼容）
 */
export interface KlineSignal {
  /** 信号类型（MA/MACD/KDJ 金叉死叉等 14 种） */
  type: SignalType;
  /** 信号发生 K 线的日期（YYYY-MM-DD） */
  date: string;
  /** 信号发生 K 线的时间戳（毫秒） */
  timestamp: number;
  /** 信号发生 K 线的收盘价 */
  close: number | null;
  /** 附加信息（如金叉的快慢周期、指标值） */
  detail?: Record<string, number>;
}

/**
 * 分时 / 个股资金流相关类型统一出口
 *
 * ⚠️ 2026-09-29 stock-sdk 淘汰第一轮：K 线 / 筹码 / 技术信号相关类型已随死代码
 * `api/kline.api.ts` 一并移除（SDK kline 域在宿主已无消费方）；保留的
 * `StockFundFlowDaily` 为 flow.api 消费。
 */
export type { StockFundFlowDaily } from 'stock-sdk';

/**
 * 分时固定时间轴的连续段
 */
export interface MinuteAxisRange {
  /** 该段首分钟的 HH:mm */
  start: string;
  /** 该段首分钟的连续分钟数（含首分钟） */
  count: number;
}

/**
 * 分时 X 轴固定刻度
 */
export interface MinuteAxisTick {
  /** 轴上的分钟时刻（HH:mm） */
  time: string;
  /** 刻度展示文案 */
  label: string;
}

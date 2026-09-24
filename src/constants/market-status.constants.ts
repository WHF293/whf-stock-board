import type { MarketStatus, SupportedMarket } from '../types/market-status.types';

/**
 * 支持市场常量（代替魔法串；供 calendar.api 消费）
 */
export const SUPPORTED_MARKET = {
  A: 'A',
  HK: 'HK',
  US: 'US',
} as const satisfies Record<string, SupportedMarket>;

/**
 * 市场状态常量（代替 enum；取值必须为 stock-sdk 的 MarketStatus 联合成员）
 */
export const MARKET_STATUS = {
  PRE_MARKET: 'pre_market',
  OPEN: 'open',
  LUNCH_BREAK: 'lunch_break',
  AFTER_HOURS: 'after_hours',
  CLOSED: 'closed',
} as const satisfies Record<string, MarketStatus>;

/** 市场状态 -> 中文标签 */
export const MARKET_STATUS_LABEL: Record<MarketStatus, string> = {
  [MARKET_STATUS.PRE_MARKET]: '盘前',
  [MARKET_STATUS.OPEN]: '交易中',
  [MARKET_STATUS.LUNCH_BREAK]: '午间休市',
  [MARKET_STATUS.AFTER_HOURS]: '已收盘',
  [MARKET_STATUS.CLOSED]: '休市',
};

/** A 股盘中显示窗口 · 开始（本地时间分钟数）：09:30（集合竞价 09:15-09:30 按「盘前」处理，不在此窗口） */
export const A_SHARE_SESSION_START = 9 * 60 + 30;

/**
 * A 股盘中显示窗口 · 结束（本地时间分钟数，不含）：15:00
 * 单段连续窗口、含午休（11:30-13:00 保持显示），避免午休消失 / 复现造成迷你条跳动
 */
export const A_SHARE_SESSION_END = 15 * 60;

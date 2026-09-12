/**
 * 轮询间隔配置（毫秒）
 *
 * 上游为公共行情接口，所有间隔取「够用且克制」的值
 */
export const POLLING_INTERVAL = {
  /** 盘中：指数 / 自选行情（作为用户设置间隔的下限兜底） */
  QUOTES_INTRADAY: 4_000,
  /** 盘中：详情页分时 */
  DETAIL_MINUTE: 15_000,
  /** 盘中：市场宽度类重数据（全市场快照 / 板块列表 / 资金流），同时作为该类轮询的间隔下限 */
  MARKET_BREADTH: 120_000,
  /** 美股行情轮询（行情全景-美股全景）的间隔下限 */
  US_BOARDS: 60_000,
  /** 失败退避基数 */
  BACKOFF_BASE: 2_000,
  /** 失败退避上限 */
  BACKOFF_MAX: 60_000,
} as const;

/**
 * 用户可设置的行情刷新间隔选项（毫秒；展示标签为秒/分钟文案）
 */
export const REFRESH_INTERVAL_OPTIONS = [
  { label: '5s', value: 5_000 },
  { label: '10s', value: 10_000 },
  { label: '20s', value: 20_000 },
  { label: '30s', value: 30_000 },
  { label: '1min', value: 60_000 },
  { label: '5min', value: 300_000 },
  { label: '10min', value: 600_000 },
] as const;

/** 默认行情刷新间隔（毫秒）：5s */
export const REFRESH_INTERVAL_DEFAULT = 5_000;

/** 交易时段刷新间隔（毫秒）：MainLayout 每 10 分钟同步一次市场状态供全部轮询消费 */
export const MARKET_STATUS_REFRESH_INTERVAL_MS = 10 * 60_000;

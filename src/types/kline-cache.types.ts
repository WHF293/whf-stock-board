import type { SinaKlinePeriod } from '../api/sina-kline.api';

/**
 * K 线本地缓存口径类型（消费方见 api/kline-cache.api.ts 与 api/kline-db.api.ts）
 */

/**
 * 本地库 kline_bar 行（网络结果 → 落库前的中间形态）
 *
 * 不直接落 klinecharts 的 KLineData：后者的 `timestamp` 是毫秒时间戳，
 * 而交易日以 `YYYY-MM-DD` 落库才能天然去重并保持字典序 = 时间序。
 */
export interface KlineBarRecord {
  /** 交易日（`YYYY-MM-DD`） */
  tradeDate: string;
  /** 开盘价 */
  open: number;
  /** 最高价 */
  high: number;
  /** 最低价 */
  low: number;
  /** 收盘价 */
  close: number;
  /** 成交量（日 K 上游为股） */
  volume: number;
  /** 成交额（元）；日 K 上游不返回，恒为 0 */
  turnover: number;
}

/**
 * 本地库 kline_cache_meta 行：单票单周期的缓存水位
 *
 * 判定「是否要补尾部」只依赖本结构（见 utils/should-fetch-kline-tail.ts）
 */
export interface KlineCacheMeta {
  /** 完整符号（`sh600519` 形态） */
  symbol: string;
  /** K 线周期 */
  period: SinaKlinePeriod;
  /** 数据口径（来源 + 复权方式，见 KLINE_CACHE_SOURCE） */
  source: string;
  /** 库内最早 bar 的交易日（`YYYY-MM-DD`） */
  firstDate: string;
  /** 库内最新 bar 的交易日（`YYYY-MM-DD`） */
  lastDate: string;
  /** 库内 bar 根数 */
  barCount: number;
  /** 最近一次成功取数的时间戳（毫秒） */
  fetchedAt: number;
}

/**
 * 调取 K 线时的缓存策略
 */
export interface KlineCacheOptions {
  /**
   * 是否把本次网络结果回写本地库
   *
   * 批量场景（如信号扫描整池逐票）必须传 `false`：否则用户点一次扫描
   * 就会把整池（极端情况全市场）的日 K 写进本地库。
   */
  write?: boolean;
  /**
   * 覆盖单次网络请求根数
   *
   * 只影响**未命中缓存时的首次请求**；已命中缓存时一律只按缺口取数。
   * 批量场景用它收窄请求（信号扫描只需近 120 根，不必拉满 1900）。
   */
  barLimit?: number;
}

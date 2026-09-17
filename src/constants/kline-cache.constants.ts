import type { SinaKlinePeriod } from '../api/sina-kline.api';

/**
 * 日 K 本地缓存常量（落库出口见 api/kline-db.api.ts，编排见 api/kline-cache.api.ts）
 */

/** stock-board.db 连接串（与板块日历 / 自选股同库，迁移见 src-tauri/src/lib.rs V7） */
export const KLINE_CACHE_DB_URL = 'sqlite:stock-board.db';

/** 本地库表名 */
export const KLINE_CACHE_TABLE = {
  /** 日 K 明细 */
  BAR: 'kline_bar',
  /** 单票单周期缓存水位 */
  META: 'kline_cache_meta',
} as const;

/** 多值 INSERT 分块行数（控制单条 SQL 的占位符总数） */
export const KLINE_CACHE_INSERT_CHUNK_ROWS = 100;

/**
 * 参与本地缓存的周期白名单
 *
 * 只有日 K：日 K 的 bar 与交易日一一对应，`trade_date` 一旦落库就不再漂移。
 * 周 / 月 K 的当期 bar 日期会随周月推进变化（本周内是周三、周五收盘后变周五），
 * 需要额外的尾部失效逻辑，收益又小（上游一次就返回全部历史），故不入库；
 * 分时 / 五日 / 5 分为盘中滚动数据，本身不具「收盘即不变」性质。
 */
export const KLINE_CACHE_PERIODS: readonly SinaKlinePeriod[] = ['daily'];

/**
 * 缓存数据口径（数据源 + 复权方式）
 *
 * 与库中水位记录不一致时整票作废重取 —— 避免换源 / 换复权口径后，
 * 新旧价格混在同一条 K 线序列里（那种图看起来正常，但全是错的）。
 */
export const KLINE_CACHE_SOURCE = 'sina-none';

/** 日期展示 / 落库格式（本地时区，与 A 股交易日口径一致） */
export const KLINE_CACHE_DATE_FORMAT = 'YYYY-MM-DD';

/** A 股交易日的星期序（dayjs `.day()`：0 为周日，6 为周六） */
export const KLINE_TRADING_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5];

/** 补尾部时请求根数的下限（库中最新 bar 当日仍可能变化，至少要重取它本身） */
export const KLINE_TAIL_MIN_DATALEN = 5;

/** 补尾部时请求根数的安全余量（覆盖自然日→交易日的折算误差与节假日错算） */
export const KLINE_TAIL_MARGIN_BARS = 5;

/** 盘中「补尾部」的最小间隔（毫秒）：避免来回切周期 / 切票时重复打上游 */
export const KLINE_TAIL_TTL_MS = 30_000;

/** 当日日 K 视为终值的时刻（时）—— 见 KLINE_DAILY_FINAL_MINUTE */
export const KLINE_DAILY_FINAL_HOUR = 15;

/**
 * 当日日 K 视为终值的时刻（分）
 *
 * A 股连续竞价 15:00 结束，盘后固定价格交易 15:05 起；取 15:05 留余量，
 * 过该时刻后当日 bar 不再变化，缓存可直接长期复用而无需回源。
 */
export const KLINE_DAILY_FINAL_MINUTE = 5;

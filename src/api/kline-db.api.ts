import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import { KLINE_CACHE_DATE_FORMAT, KLINE_CACHE_DB_URL, KLINE_CACHE_INSERT_CHUNK_ROWS, KLINE_CACHE_TABLE } from '../constants/kline-cache.constants';
import type { KlineBarRecord, KlineCacheMeta } from '../types/kline-cache.types';
import { buildValuesClause } from '../utils/build-values-clause';
import { chunkArray } from '../utils/chunk-array';
import type { SinaKlinePeriod } from './sina-kline.api';

/**
 * 日 K 本地缓存的落库出口（stock-board.db / kline_bar + kline_cache_meta，V7 迁移）
 *
 * 职责：
 * - 持有连接单例（建表由 Rust 侧 migration 完成，见 src-tauri/src/lib.rs）；
 * - 蛇形行 ↔ klinecharts `KLineData` 的映射边界（上层不接触原始行）；
 * - 浏览器端无 SQLite：一律返回空 / no-op，由 api/kline-cache.api.ts 退回纯网络取数。
 *
 * 说明：@tauri-apps/plugin-sql 未暴露事务 API（连接来自内部连接池，
 * 手动 BEGIN/COMMIT 无法保证落在同一连接），故与既有 board-calendar-db.api.ts 一致，
 * 批量写入采用分块多值 INSERT 顺序执行。
 */

/** 连接单例（Database.load 自带插件 migration，建表在 Rust 侧） */
let dbPromise: Promise<Database> | null = null;

/** DB 原始行（蛇形列，类型宽松） */
type Row = Record<string, unknown>;

/**
 * 行取值兜底（字符串）
 * @param value DB 原始值
 * @returns 字符串值
 */
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * 行取值兜底（数值）
 * @param value DB 原始值
 * @returns 数值；不可解析时为 0
 */
const num = (value: unknown): number => (typeof value === 'number' ? value : Number(value ?? 0) || 0);

/**
 * 获取 stock-board.db 连接（懒加载单例）
 * @returns 连接实例；浏览器端（非 Tauri）为 null
 */
const getDb = async (): Promise<Database | null> => {
  if (!isTauri()) {
    return null;
  }
  if (dbPromise === null) {
    const created = Database.load(KLINE_CACHE_DB_URL);
    dbPromise = created;
    // 首次连接失败时清空单例，允许后续重试（否则全部调用都命中已 reject 的 Promise）
    created.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
};

/**
 * 当前环境是否支持 K 线本地缓存
 * @returns true 表示可用（桌面客户端）
 */
export const isKlineCacheAvailable = (): boolean => isTauri();

/**
 * 交易日 → 毫秒时间戳
 *
 * ⚠️ 必须与 api/sina-kline.api.ts 的解析口径一致：把 `-` 换成 `/` 后交给
 * dayjs 按**本地时区**解析（空格 / 短横线混用会得到 UTC 零点，跨时区偏移一整天的量级）。
 * @param tradeDate 交易日（`YYYY-MM-DD`）
 * @returns 毫秒时间戳
 */
const toTimestamp = (tradeDate: string): number =>
  dayjs(tradeDate.replace(/-/g, '/')).valueOf();

/**
 * kline_bar 行 → klinecharts KLineData
 * @param row DB 原始行
 * @returns K 线条目
 */
const toBar = (row: Row): KLineData => ({
  timestamp: toTimestamp(str(row.trade_date)),
  open: num(row.open),
  high: num(row.high),
  low: num(row.low),
  close: num(row.close),
  volume: num(row.volume),
  turnover: num(row.turnover),
});

/**
 * klinecharts KLineData → kline_bar 行
 * @param bar K 线条目
 * @returns 落库记录（`tradeDate` 取本地时区的自然日）
 */
const toRecord = (bar: KLineData): KlineBarRecord => ({
  tradeDate: dayjs(bar.timestamp).format(KLINE_CACHE_DATE_FORMAT),
  open: bar.open,
  high: bar.high,
  low: bar.low,
  close: bar.close,
  volume: bar.volume ?? 0,
  turnover: bar.turnover ?? 0,
});

/**
 * kline_cache_meta 行 → KlineCacheMeta
 * @param row DB 原始行
 * @returns 缓存水位
 */
const toMeta = (row: Row): KlineCacheMeta => ({
  symbol: str(row.symbol),
  period: str(row.period) as SinaKlinePeriod,
  source: str(row.source),
  firstDate: str(row.first_date),
  lastDate: str(row.last_date),
  barCount: num(row.bar_count),
  fetchedAt: num(row.fetched_at),
});

/**
 * 读取某票某周期的缓存水位
 * @param symbol 完整符号（`sh600519` 形态）
 * @param period K 线周期
 * @returns 缓存水位；无记录 / 非 Tauri 时为 null
 */
export const getKlineCacheMeta = async (
  symbol: string,
  period: SinaKlinePeriod,
): Promise<KlineCacheMeta | null> => {
  const db = await getDb();
  if (!db) {
    return null;
  }
  try {
    const rows = await db.select<Row[]>(
      `SELECT symbol, period, source, first_date, last_date, bar_count, fetched_at ` +
        `FROM ${KLINE_CACHE_TABLE.META} WHERE symbol = $1 AND period = $2`,
      [symbol, period],
    );
    return rows.length > 0 ? toMeta(rows[0]) : null;
  } catch (error) {
    console.error('[kline-db] 读取缓存水位失败', error);
    return null;
  }
};

/**
 * 读取某票某周期的全部本地 K 线（时间升序）
 * @param symbol 完整符号（`sh600519` 形态）
 * @param period K 线周期
 * @returns K 线条目；无记录 / 非 Tauri / 读取失败时为空数组
 */
export const listCachedKlineBars = async (
  symbol: string,
  period: SinaKlinePeriod,
): Promise<KLineData[]> => {
  const db = await getDb();
  if (!db) {
    return [];
  }
  try {
    const rows = await db.select<Row[]>(
      `SELECT trade_date, open, high, low, close, volume, turnover ` +
        `FROM ${KLINE_CACHE_TABLE.BAR} WHERE symbol = $1 AND period = $2 ORDER BY trade_date`,
      [symbol, period],
    );
    return rows.map(toBar);
  } catch (error) {
    console.error('[kline-db] 读取本地 K 线失败', error);
    return [];
  }
};

/**
 * upsert 一批 K 线（同票同周期同交易日覆盖）
 *
 * 只写「本次新取回」的条目即可：历史条目已在库里、且不复权行情不会被上游修订。
 * @param symbol 完整符号（`sh600519` 形态）
 * @param period K 线周期
 * @param bars 本次取回的条目（时间升序）
 */
export const upsertKlineBars = async (
  symbol: string,
  period: SinaKlinePeriod,
  bars: readonly KLineData[],
): Promise<void> => {
  const db = await getDb();
  if (!db || bars.length === 0) {
    return;
  }
  const updatedAt = Date.now();
  const records = bars.map(toRecord);
  try {
    for (const part of chunkArray(records, KLINE_CACHE_INSERT_CHUNK_ROWS)) {
      const sql =
        `INSERT INTO ${KLINE_CACHE_TABLE.BAR} (symbol, period, trade_date, open, high, low, ` +
        `close, volume, turnover, updated_at) VALUES ${buildValuesClause(part.length, 10)} ` +
        `ON CONFLICT(symbol, period, trade_date) DO UPDATE SET open = excluded.open, ` +
        `high = excluded.high, low = excluded.low, close = excluded.close, ` +
        `volume = excluded.volume, turnover = excluded.turnover, updated_at = excluded.updated_at`;
      await db.execute(
        sql,
        part.flatMap((record) => [
          symbol,
          period,
          record.tradeDate,
          record.open,
          record.high,
          record.low,
          record.close,
          record.volume,
          record.turnover,
          updatedAt,
        ]),
      );
    }
  } catch (error) {
    console.error('[kline-db] 写入本地 K 线失败', error);
  }
};

/**
 * upsert 缓存水位
 * @param meta 缓存水位（`firstDate` / `lastDate` / `barCount` 应反映合并后的全量视图）
 */
export const upsertKlineCacheMeta = async (meta: KlineCacheMeta): Promise<void> => {
  const db = await getDb();
  if (!db) {
    return;
  }
  try {
    await db.execute(
      `INSERT INTO ${KLINE_CACHE_TABLE.META} (symbol, period, source, first_date, last_date, ` +
        `bar_count, fetched_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ` +
        `ON CONFLICT(symbol, period) DO UPDATE SET source = excluded.source, ` +
        `first_date = excluded.first_date, last_date = excluded.last_date, ` +
        `bar_count = excluded.bar_count, fetched_at = excluded.fetched_at`,
      [
        meta.symbol,
        meta.period,
        meta.source,
        meta.firstDate,
        meta.lastDate,
        meta.barCount,
        meta.fetchedAt,
      ],
    );
  } catch (error) {
    console.error('[kline-db] 写入缓存水位失败', error);
  }
};

/**
 * 清除某票某周期的本地缓存（明细 + 水位）
 *
 * 用途：缓存口径（数据源 / 复权方式）与当前口径不一致时整票作废，
 * 避免新旧价格混在同一条序列里。
 * @param symbol 完整符号（`sh600519` 形态）
 * @param period K 线周期
 */
export const clearKlineCache = async (
  symbol: string,
  period: SinaKlinePeriod,
): Promise<void> => {
  const db = await getDb();
  if (!db) {
    return;
  }
  try {
    await db.execute(
      `DELETE FROM ${KLINE_CACHE_TABLE.BAR} WHERE symbol = $1 AND period = $2`,
      [symbol, period],
    );
    await db.execute(
      `DELETE FROM ${KLINE_CACHE_TABLE.META} WHERE symbol = $1 AND period = $2`,
      [symbol, period],
    );
  } catch (error) {
    console.error('[kline-db] 清除本地 K 线缓存失败', error);
  }
};

/**
 * 统计本地 K 线缓存规模（设置页展示 / 诊断用）
 * @returns `symbols` 已缓存票数、`bars` 总 bar 数；非 Tauri / 失败时为全 0
 */
export const countKlineCache = async (): Promise<{ symbols: number; bars: number }> => {
  const empty = { symbols: 0, bars: 0 };
  const db = await getDb();
  if (!db) {
    return empty;
  }
  try {
    const metaRows = await db.select<Row[]>(`SELECT COUNT(*) AS n FROM ${KLINE_CACHE_TABLE.META}`);
    const barRows = await db.select<Row[]>(`SELECT COUNT(*) AS n FROM ${KLINE_CACHE_TABLE.BAR}`);
    return { symbols: num(metaRows[0]?.n), bars: num(barRows[0]?.n) };
  } catch (error) {
    console.error('[kline-db] 统计本地 K 线缓存失败', error);
    return empty;
  }
};

/**
 * 清空全部本地 K 线缓存（明细表 + 水位表）
 *
 * 设置页的手动兜底：正常情况下口径变更由 KLINE_CACHE_SOURCE 自动作废，
 * 但用户换过数据源 / 想强制重取时需要一个不留死角的入口。
 */
export const clearAllKlineCache = async (): Promise<void> => {
  const db = await getDb();
  if (!db) {
    return;
  }
  try {
    await db.execute(`DELETE FROM ${KLINE_CACHE_TABLE.BAR}`);
    await db.execute(`DELETE FROM ${KLINE_CACHE_TABLE.META}`);
  } catch (error) {
    console.error('[kline-db] 清空本地 K 线缓存失败', error);
  }
};

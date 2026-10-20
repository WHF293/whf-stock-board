/**
 * 期货机构行为本地缓存库（stock-board.db / ccpm_day_cache 表，V9 迁移）
 *
 * 中金所 CCPM 披露数据收盘后定稿且历史文件不变，落库后应用重启 / 回看
 * 历史披露日不再回源拉 CSV。缓存语义（与 lib.rs V9 注释一致，勿改）：
 * - 正缓存（has_data=1）：披露日定稿数据，永久有效；
 * - 负缓存（has_data=0）：非披露日 / 尚未披露的探测落空，按 TTL 过期
 *   （当天盘后披露时点前后都会探测同一天，不能永久否定）。
 */
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { CCPM_CACHE_TTL_MS } from '../constants/futures.constants.ts';
import type { CcpmProductDayData } from '../types/futures.types.ts';

/** 库内一条品种单日缓存（data 为 null 时即负缓存） */
export interface CcpmDayCacheRecord {
  /** 品种代码 */
  product: string;
  /** 交易日 yyyyMMdd */
  tradingDay: string;
  /** 拉取结果（null = 已知无披露数据） */
  data: CcpmProductDayData | null;
  /** 写入时刻（毫秒时间戳） */
  fetchedAt: number;
}

let dbPromise: Promise<Database> | null = null;

/** 每会话是否已清理过过期负缓存（惰性执行一次，避免高频 DELETE） */
let prunedThisSession = false;

/**
 * 惰性打开 stock-board.db（非 Tauri 环境返回 null，调用方静默降级为纯网络）
 * @returns 数据库连接 Promise（非 Tauri 为 null）
 */
const getDb = (): Promise<Database> | null => {
  if (!isTauri()) return null;
  dbPromise ??= Database.load('sqlite:stock-board.db');
  return dbPromise;
};

/**
 * 读一条品种单日缓存
 * @param product 品种代码
 * @param day 交易日 yyyyMMdd
 * @returns 缓存记录；无记录或库不可用时返回 null（调用方回源）
 */
export const readCcpmDayCache = async (
  product: string,
  day: string,
): Promise<CcpmDayCacheRecord | null> => {
  const db = getDb();
  if (!db) return null;
  const conn = await db;
  const rows = await conn.select<Record<string, unknown>[]>(
    'SELECT has_data, data_json, fetched_at FROM ccpm_day_cache WHERE product = $1 AND trading_day = $2 LIMIT 1',
    [product, day],
  );
  const row = rows[0];
  if (!row) return null;
  let data: CcpmProductDayData | null = null;
  if (Number(row.has_data) === 1 && typeof row.data_json === 'string') {
    try {
      data = JSON.parse(row.data_json) as CcpmProductDayData;
    } catch {
      return null; // 损坏行按未缓存处理，回源重写
    }
  }
  return { product, tradingDay: day, data, fetchedAt: Number(row.fetched_at) };
};

/**
 * 写入（upsert）一条品种单日缓存；写正缓存时顺带清理过期负缓存（每会话一次）
 * @param record product + tradingDay + data（null = 负缓存）
 */
export const writeCcpmDayCache = async (record: CcpmDayCacheRecord): Promise<void> => {
  const db = getDb();
  if (!db) return;
  const conn = await db;
  await conn.execute(
    `INSERT INTO ccpm_day_cache (product, trading_day, has_data, data_json, fetched_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT(product, trading_day) DO UPDATE SET
       has_data = excluded.has_data,
       data_json = excluded.data_json,
       fetched_at = excluded.fetched_at`,
    [
      record.product,
      record.tradingDay,
      record.data === null ? 0 : 1,
      record.data === null ? null : JSON.stringify(record.data),
      record.fetchedAt,
    ],
  );
  if (!prunedThisSession) {
    prunedThisSession = true;
    try {
      await conn.execute('DELETE FROM ccpm_day_cache WHERE has_data = 0 AND fetched_at < $1', [
        Date.now() - CCPM_CACHE_TTL_MS,
      ]);
    } catch {
      // 清理失败不影响主流程（仅库体积问题）
    }
  }
};

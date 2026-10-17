import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { KLINE_CACHE_DB_URL } from '../constants/kline-cache.constants.ts';
import type { KlineDrawingBundle, KlineDrawingRecord } from '../types/kline-drawing.types.ts';

/**
 * K 线画线持久化出口（stock-board.db / kline_drawings，V8 迁移）
 *
 * 职责：
 * - 持有连接单例（建表由 Rust 侧 migration 完成，见 src-tauri/src/lib.rs）；
 * - 一行一票一周期（PRIMARY KEY (symbol, period)），写入为整行 upsert；
 * - 浏览器端无 SQLite：降级 localStorage（同一序列化格式，key 按票#周期分键）。
 */

/** 连接单例（与 kline-db.api.ts 同库同 URL，各自持有 Database.load 句柄） */
let dbPromise: Promise<Database> | null = null;

/** 浏览器降级的 localStorage 键前缀（进 appStorage 命名空间） */
const STORAGE_NS_DRAWINGS_PREFIX = 'pc.klineDrawings.';

/**
 * 获取 stock-board.db 连接（懒加载单例；浏览器端为 null）
 * @returns 连接实例或 null
 */
const getDb = async (): Promise<Database | null> => {
  if (!isTauri()) return null;
  if (dbPromise === null) {
    const created = Database.load(KLINE_CACHE_DB_URL);
    dbPromise = created;
    created.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
};

/**
 * 读取一票一周期的画线集合
 * @param symbol 完整符号
 * @param period K 线周期
 * @returns 形状快照数组（无记录时为空数组；data_json 损坏按空处理）
 */
export const loadKlineDrawings = async (
  symbol: string,
  period: string,
): Promise<KlineDrawingRecord[]> => {
  const db = await getDb();
  if (db === null) {
    try {
      const raw = localStorage.getItem(`${STORAGE_NS_DRAWINGS_PREFIX}${symbol}#${period}`);
      return raw === null ? [] : (JSON.parse(raw) as KlineDrawingRecord[]);
    } catch {
      return [];
    }
  }
  const rows = await db.select<{ data_json: string }[]>(
    'SELECT data_json FROM kline_drawings WHERE symbol = $1 AND period = $2',
    [symbol, period],
  );
  const json = rows[0]?.data_json;
  if (typeof json !== 'string' || json.length === 0) return [];
  try {
    return (JSON.parse(json) as KlineDrawingRecord[]) ?? [];
  } catch {
    console.warn('[kline-drawing] data_json 损坏，按空处理', symbol, period);
    return [];
  }
};

/**
 * 保存一票一周期的画线集合（整行 upsert）
 * @param symbol 完整符号
 * @param period K 线周期
 * @param shapes 全部形状快照（空数组 = 清空该票该周期，仍会写入空集合）
 */
export const saveKlineDrawings = async (
  symbol: string,
  period: string,
  shapes: KlineDrawingRecord[],
): Promise<void> => {
  const db = await getDb();
  if (db === null) {
    const key = `${STORAGE_NS_DRAWINGS_PREFIX}${symbol}#${period}`;
    if (shapes.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(shapes));
    }
    return;
  }
  await db.execute(
    'INSERT INTO kline_drawings (symbol, period, data_json, updated_at) VALUES ($1, $2, $3, $4) ' +
      'ON CONFLICT (symbol, period) DO UPDATE SET data_json = $3, updated_at = $4',
    [symbol, period, JSON.stringify(shapes), Date.now()],
  );
};

/**
 * 当前环境是否支持画线持久化（只用于 UI 判定，功能本身两态都能用）
 * @returns true = SQLite 持久化 / false = localStorage 降级
 */
export const isKlineDrawingDbBacked = (): boolean => isTauri();

/** 导出 bundle 类型（调用方拼装用，避免直接依赖内部形态） */
export type { KlineDrawingBundle };

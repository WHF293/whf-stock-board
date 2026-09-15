/**
 * 已保存新闻本地库（stock-board.db / news_saved 表，V5 迁移）
 *
 * 「保存新闻」的内部实现：热点新闻收藏与 Agent「保存新闻」MCP 工具共用；
 * url 唯一约束做幂等（重复保存返回 saved=false 而非报错）
 */
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

/** 已保存新闻记录 */
export interface SavedNewsRecord {
  id: number;
  /** 新闻源标识（新浪 / 东财 / 澎湃…） */
  source: string;
  title: string;
  url: string;
  /** 摘要（部分源列表无摘要字段，可为空） */
  summary: string | null;
  /** 发布时间（毫秒时间戳；缺失为 null） */
  publishedAt: number | null;
  /** 保存时间（毫秒时间戳） */
  savedAt: number;
}

let dbPromise: Promise<Database> | null = null;

/**
 * 惰性打开 stock-board.db（非 Tauri 环境返回 null，调用方降级）
 * @returns 数据库连接 Promise（非 Tauri 为 null）
 */
const getDb = (): Promise<Database> | null => {
  if (!isTauri()) return null;
  dbPromise ??= Database.load('sqlite:stock-board.db');
  return dbPromise;
};

/** 保存新闻入参 */
export interface SaveNewsInput {
  source: string;
  title: string;
  url: string;
  summary?: string | null;
  /** 毫秒时间戳（缺省 = 不记录发布时间） */
  publishedAt?: number | null;
}

/**
 * 保存新闻（按 url 幂等）
 * @param input 新闻内容
 * @returns saved=false 表示该 url 已存在（幂等命中）
 */
export const saveNews = async (input: SaveNewsInput): Promise<{ saved: boolean }> => {
  const db = getDb();
  if (!db) throw new Error('仅 Tauri 桌面端可保存新闻');
  const conn = await db;
  const existed = await conn.select<unknown[]>(
    'SELECT id FROM news_saved WHERE url = $1 LIMIT 1',
    [input.url],
  );
  if (existed.length > 0) return { saved: false };
  await conn.execute(
    `INSERT INTO news_saved (source, title, url, summary, published_at, saved_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      input.source,
      input.title,
      input.url,
      input.summary ?? null,
      input.publishedAt ?? null,
      Date.now(),
    ],
  );
  return { saved: true };
};

/**
 * 列出已保存新闻（按保存时间倒序）
 * @param limit 返回条数上限（默认 50，上限 200）
 * @returns 已保存新闻记录列表
 */
export const listSavedNews = async (limit = 50): Promise<SavedNewsRecord[]> => {
  const db = getDb();
  if (!db) throw new Error('仅 Tauri 桌面端可读取新闻库');
  const capped = Math.min(Math.max(1, Math.trunc(limit)), 200);
  const conn = await db;
  const rows = await conn.select<Record<string, unknown>[]>(
    'SELECT * FROM news_saved ORDER BY saved_at DESC LIMIT $1',
    [capped],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    source: String(r.source),
    title: String(r.title),
    url: String(r.url),
    summary: r.summary === null ? null : String(r.summary),
    publishedAt: r.published_at === null ? null : Number(r.published_at),
    savedAt: Number(r.saved_at),
  }));
};

/**
 * 删除已保存新闻
 * @param url 新闻链接（唯一键）
 * @returns 是否有记录被删除
 */
export const deleteSavedNews = async (url: string): Promise<{ deleted: boolean }> => {
  const db = getDb();
  if (!db) throw new Error('仅 Tauri 桌面端可操作新闻库');
  const conn = await db;
  const result = await conn.execute('DELETE FROM news_saved WHERE url = $1', [url]);
  return { deleted: (result.rowsAffected ?? 0) > 0 };
};

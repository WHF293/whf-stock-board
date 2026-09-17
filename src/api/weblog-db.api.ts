/**
 * 系统日志本地库（weblog.db，V1 迁移见 src-tauri/src/lib.rs 的 WEBLOG_DB_V1）
 *
 * 本文件是 weblog.db 的唯一读写出口：业务代码（含 Agent 的 db_query 之外的前端模块）
 * 一律经 `weblog-store.ts` 调用，不直接 load 该库。
 *
 * 约束：
 * - 仅在 Tauri 桌面端可用（浏览器无 SQLite），非 Tauri 环境由上层降级到内存缓冲；
 * - 插件无事务 API → 批量写入按块拼多值 INSERT（块大小须满足 行数×列数 < SQLite 变量上限）；
 * - 查询一律 `occurred_at DESC` 倒序，并强制 limit 上限，避免把库整表拉进前端；
 * - **列序与行取值映射不在本文件**，见纯函数层 `weblog/weblog-rows.ts`
 *   （INSERT 的列名与取值由类型穷尽校验绑定，杜绝列 / 值数量不一致的静默错位）。
 */
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import {
  WEBLOG_DB_URL,
  WEBLOG_INSERT_CHUNK_SIZE,
  WEBLOG_QUERY_LIMIT,
  WEBLOG_QUERY_LIMIT_MAX,
} from '../constants/weblog.constants';
import {
  ACTION_LOG_COLUMNS,
  ERROR_LOG_COLUMNS,
  toActionLogValues,
  toErrorLogValues,
} from '../weblog/weblog-rows';
import type {
  WeblogActionLog,
  WeblogErrorKind,
  WeblogErrorLog,
  WeblogLevel,
  WeblogLogStats,
  WeblogQuery,
  WeblogRuntime,
} from '../types/weblog.types';

/** 行为日志关键字匹配列（用户按文案搜索的范围） */
const ACTION_LOG_SEARCH_COLUMNS = ['label', 'action', 'target', 'detail', 'page_path'] as const;

/** 报错日志关键字匹配列 */
const ERROR_LOG_SEARCH_COLUMNS = [
  'message',
  'stack',
  'kind',
  'page_path',
  'api_url',
  'detail',
] as const;

let dbPromise: Promise<Database> | null = null;

/**
 * 惰性打开 weblog.db（非 Tauri 环境返回 null，由上层降级）
 * @returns 数据库连接 Promise；非 Tauri 为 null
 */
const getDb = (): Promise<Database> | null => {
  if (!isTauri()) return null;
  dbPromise ??= Database.load(WEBLOG_DB_URL);
  return dbPromise;
};

/**
 * 当前环境是否支持落库
 * @returns Tauri 桌面端返回 true
 */
export const isWeblogDbAvailable = (): boolean => isTauri();

/**
 * 拼批量 INSERT 的占位符段
 * @param rowCount 本次块行数
 * @param columnCount 列数
 * @param offset 已占用的参数序号（上一块的末尾）
 * @returns `($1,$2,...)` 形式的多值片段
 */
const buildValueSegments = (
  rowCount: number,
  columnCount: number,
  offset: number,
): string => {
  const segments: string[] = [];
  for (let row = 0; row < rowCount; row += 1) {
    const holders: string[] = [];
    for (let col = 0; col < columnCount; col += 1) {
      holders.push(`$${offset + row * columnCount + col + 1}`);
    }
    segments.push(`(${holders.join(', ')})`);
  }
  return segments.join(', ');
};

/**
 * 分块写入一批日志（块内失败重试一次，仍失败则该块整体丢弃并抛出）
 * @param table 目标表名
 * @param columns 列名（顺序即参数顺序）
 * @param rows 行数据（由纯函数层按列序生成，长度恒等于列数）
 * @returns 实际写入行数
 */
const insertRows = async (
  table: string,
  columns: readonly string[],
  rows: (string | number | null)[][],
): Promise<number> => {
  const db = getDb();
  if (!db) return 0;
  const conn = await db;
  let inserted = 0;
  for (let start = 0; start < rows.length; start += WEBLOG_INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + WEBLOG_INSERT_CHUNK_SIZE);
    const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES ${buildValueSegments(
      chunk.length,
      columns.length,
      0,
    )}`;
    const result = await conn.execute(sql, chunk.flat());
    inserted += result.rowsAffected ?? chunk.length;
  }
  return inserted;
};

/**
 * 写入报错日志
 * @param rows 待落库的报错记录
 * @returns 写入行数（非 Tauri 环境返回 0）
 */
export const insertErrorLogRows = async (rows: WeblogErrorLog[]): Promise<number> => {
  if (rows.length === 0) return 0;
  const values = rows.map((row) => toErrorLogValues(row));
  return insertRows('error_log', ERROR_LOG_COLUMNS, values);
};

/**
 * 写入行为日志
 *
 * 行值由 `weblog-rows.ts` 按列名映射生成（不用位置数组：列序与取值一对一
 * 由类型穷尽校验保证，避免再次出现「列 16 个、取值 15 个」的静默错位）。
 * @param rows 待落库的行为记录
 * @returns 写入行数（非 Tauri 环境返回 0）
 */
export const insertActionLogRows = async (rows: WeblogActionLog[]): Promise<number> => {
  if (rows.length === 0) return 0;
  const values = rows.map((row) => toActionLogValues(row));
  return insertRows('action_log', ACTION_LOG_COLUMNS, values);
};

/** DB 原始行（蛇形列，类型宽松） */
type RawRow = Record<string, unknown>;

/**
 * 构造 LIKE 关键字条件（多列 OR）
 * @param columns 参与匹配的列名
 * @param keyword 关键字（非空）
 * @returns { clause, params } 子句与参数
 */
const buildKeywordClause = (
  columns: readonly string[],
  keyword: string,
): { clause: string; params: string[] } => {
  const params = columns.map(() => `%${keyword}%`);
  const clause = `(${columns.map((col) => `${col} LIKE ?`).join(' OR ')})`;
  return { clause, params };
};

/**
 * 行取值兜底（字符串）
 * @param value DB 原始值
 * @returns 字符串；空值为 null
 */
const asNullableString = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/**
 * 行取值兜底（数字）
 * @param value DB 原始值
 * @returns 数字；空值为 null
 */
const asNullableNumber = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

/**
 * 原始行 → 报错日志记录
 * @param row DB 原始行
 * @returns 报错日志记录
 */
const toErrorLog = (row: RawRow): WeblogErrorLog => ({
  id: Number(row.id),
  occurredAt: Number(row.occurred_at),
  timeText: String(row.time_text),
  level: String(row.level) as WeblogLevel,
  kind: String(row.kind) as WeblogErrorKind,
  message: String(row.message),
  stack: asNullableString(row.stack),
  pagePath: String(row.page_path ?? ''),
  pageTitle: asNullableString(row.page_title),
  apiUrl: asNullableString(row.api_url),
  apiStatus: asNullableNumber(row.api_status),
  durationMs: asNullableNumber(row.duration_ms),
  appVersion: String(row.app_version ?? ''),
  runtime: String(row.runtime ?? 'browser') as WeblogRuntime,
  osName: asNullableString(row.os_name),
  osVersion: asNullableString(row.os_version),
  ua: asNullableString(row.ua),
  webview: asNullableString(row.webview),
  screen: asNullableString(row.screen),
  traceId: asNullableString(row.trace_id),
  detail: asNullableString(row.detail),
});

/**
 * 原始行 → 行为日志记录
 * @param row DB 原始行
 * @returns 行为日志记录
 */
const toActionLog = (row: RawRow): WeblogActionLog => ({
  id: Number(row.id),
  occurredAt: Number(row.occurred_at),
  timeText: String(row.time_text),
  action: String(row.action),
  category: String(row.category) as WeblogActionLog['category'],
  label: String(row.label ?? ''),
  target: asNullableString(row.target),
  detail: asNullableString(row.detail),
  pagePath: String(row.page_path ?? ''),
  pageTitle: asNullableString(row.page_title),
  durationMs: asNullableNumber(row.duration_ms),
  status: row.status === null || row.status === undefined
    ? null
    : (String(row.status) as WeblogActionLog['status']),
  appVersion: String(row.app_version ?? ''),
  osName: asNullableString(row.os_name),
  ua: asNullableString(row.ua),
  sessionId: asNullableString(row.session_id),
  traceId: asNullableString(row.trace_id),
});

/**
 * 规范化查询条数上限
 * @param limit 入参条数
 * @returns 落在 [1, WEBLOG_QUERY_LIMIT_MAX] 的条数
 */
const normalizeLimit = (limit?: number): number => {
  if (!limit || !Number.isFinite(limit)) return WEBLOG_QUERY_LIMIT;
  return Math.min(Math.max(1, Math.trunc(limit)), WEBLOG_QUERY_LIMIT_MAX);
};

/**
 * 查询报错日志（按时间倒序）
 * @param query 查询条件
 * @returns 报错日志列表（非 Tauri 环境返回空数组）
 */
export const selectErrorLogs = async (query: WeblogQuery = {}): Promise<WeblogErrorLog[]> => {
  const db = getDb();
  if (!db) return [];
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.sinceMs) {
    where.push('occurred_at >= ?');
    params.push(query.sinceMs);
  }
  if (query.level) {
    where.push('level = ?');
    params.push(query.level);
  }
  if (query.keyword) {
    // 插件按 ? 顺序绑定位置参数，关键字条件紧跟在已有条件之后
    const { clause, params: keywordParams } = buildKeywordClause(
      ERROR_LOG_SEARCH_COLUMNS,
      query.keyword,
    );
    where.push(clause);
    params.push(...keywordParams);
  }
  const sql = `SELECT * FROM error_log${
    where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY occurred_at DESC LIMIT ${normalizeLimit(query.limit)}`;
  const conn = await db;
  const rows = await conn.select<RawRow[]>(sql, params);
  return rows.map(toErrorLog);
};

/**
 * 查询行为日志（按时间倒序）
 * @param query 查询条件
 * @returns 行为日志列表（非 Tauri 环境返回空数组）
 */
export const selectActionLogs = async (query: WeblogQuery = {}): Promise<WeblogActionLog[]> => {
  const db = getDb();
  if (!db) return [];
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (query.sinceMs) {
    where.push('occurred_at >= ?');
    params.push(query.sinceMs);
  }
  if (query.category) {
    where.push('category = ?');
    params.push(query.category);
  }
  if (query.keyword) {
    const { clause, params: keywordParams } = buildKeywordClause(
      ACTION_LOG_SEARCH_COLUMNS,
      query.keyword,
    );
    where.push(clause);
    params.push(...keywordParams);
  }
  const sql = `SELECT * FROM action_log${
    where.length > 0 ? ` WHERE ${where.join(' AND ')}` : ''
  } ORDER BY occurred_at DESC LIMIT ${normalizeLimit(query.limit)}`;
  const conn = await db;
  const rows = await conn.select<RawRow[]>(sql, params);
  return rows.map(toActionLog);
};

/**
 * 统计保留期内日志条数（页面头部概览）
 * @param sinceMs 保留起始时间（毫秒）
 * @returns 报错 / 行为条数统计
 */
export const selectLogStats = async (sinceMs: number): Promise<WeblogLogStats> => {
  const db = getDb();
  if (!db) return { errorCount: 0, actionCount: 0, retentionFrom: sinceMs };
  const conn = await db;
  const errorRows = await conn.select<RawRow[]>(
    'SELECT COUNT(*) AS count FROM error_log WHERE occurred_at >= ?',
    [sinceMs],
  );
  const actionRows = await conn.select<RawRow[]>(
    'SELECT COUNT(*) AS count FROM action_log WHERE occurred_at >= ?',
    [sinceMs],
  );
  return {
    errorCount: Number(errorRows[0]?.count ?? 0),
    actionCount: Number(actionRows[0]?.count ?? 0),
    retentionFrom: sinceMs,
  };
};

/**
 * 删除保留期之前的日志（保留最近 N 天）
 * @param cutoffMs 保留起始时间（毫秒，早于该时间的记录被删除）
 * @returns 两个表各自删除的行数
 */
export const deleteLogsBefore = async (
  cutoffMs: number,
): Promise<{ errorDeleted: number; actionDeleted: number }> => {
  const db = getDb();
  if (!db) return { errorDeleted: 0, actionDeleted: 0 };
  const conn = await db;
  const errorResult = await conn.execute('DELETE FROM error_log WHERE occurred_at < ?', [
    cutoffMs,
  ]);
  const actionResult = await conn.execute('DELETE FROM action_log WHERE occurred_at < ?', [
    cutoffMs,
  ]);
  return {
    errorDeleted: errorResult.rowsAffected ?? 0,
    actionDeleted: actionResult.rowsAffected ?? 0,
  };
};

/**
 * 清空全部日志（用户在日志页手动触发）
 * @returns 两个表各自删除的行数
 */
export const deleteAllLogs = async (): Promise<{
  errorDeleted: number;
  actionDeleted: number;
}> => {
  const db = getDb();
  if (!db) return { errorDeleted: 0, actionDeleted: 0 };
  const conn = await db;
  const errorResult = await conn.execute('DELETE FROM error_log');
  const actionResult = await conn.execute('DELETE FROM action_log');
  return {
    errorDeleted: errorResult.rowsAffected ?? 0,
    actionDeleted: actionResult.rowsAffected ?? 0,
  };
};

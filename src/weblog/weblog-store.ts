/**
 * 系统日志存取门面（内存环形缓冲 + weblog.db）
 *
 * 分层职责：
 * - `push*`：只进内存（写入层攒批期间 / 日志页即时回显用）；
 * - `persist*`：进内存 + 落库（Tauri）；非 Tauri（浏览器 dev）只留内存，
 *   日志页仍可看到本次会话的记录，不因无库而空表；
 * - `query* / stats / clear / prune`：Tauri 走库、浏览器走内存，调用方无感。
 *
 * ⚠️ 本模块内部失败一律 `console.warn`（不 console.error）：console.error 已被
 * 错误采集钩住，用 error 级别会形成「写日志失败 → 记一条错误 → 又写日志」的自激循环。
 */
import {
  deleteAllLogs,
  deleteLogsBefore,
  insertActionLogRows,
  insertErrorLogRows,
  isWeblogDbAvailable,
  selectActionLogs,
  selectErrorLogs,
  selectLogStats,
} from '../api/weblog-db.api';
import { WEBLOG_MEMORY_BUFFER_MAX } from '../constants/weblog.constants';
import type {
  WeblogActionLog,
  WeblogErrorLog,
  WeblogLogStats,
  WeblogQuery,
} from '../types/weblog.types';

/** 行为日志内存缓冲（新记录在最前） */
const actionMemory: WeblogActionLog[] = [];

/** 报错日志内存缓冲（新记录在最前） */
const errorMemory: WeblogErrorLog[] = [];

/** 内存记录的自减序号（与库自增主键区分：负数即「未落库」） */
let memorySeq = -1;

/**
 * 内存记录专用主键（负数，与库自增主键不冲突）
 * @returns 递减的负整数
 */
export const nextMemoryId = (): number => {
  memorySeq -= 1;
  return memorySeq;
};

/**
 * 数据是否真正落库（页面据此提示「当前会话未持久化」）
 * @returns Tauri 桌面端返回 true
 */
export const isWeblogPersisted = (): boolean => isWeblogDbAvailable();

/**
 * 写入内存缓冲（超限丢弃最旧的尾部记录）
 * @param buffer 目标缓冲
 * @param rows 新记录（时间升序传入）
 */
const appendMemory = <T extends { id: number }>(buffer: T[], rows: T[]): void => {
  for (const row of rows) {
    buffer.unshift(row);
  }
  if (buffer.length > WEBLOG_MEMORY_BUFFER_MAX) {
    buffer.length = WEBLOG_MEMORY_BUFFER_MAX;
  }
};

/**
 * 行为日志入内存（不落库）
 * @param rows 行为日志记录数组
 */
export const pushActionLogs = (rows: WeblogActionLog[]): void => {
  if (rows.length > 0) appendMemory(actionMemory, rows);
};

/**
 * 报错日志入内存（不落库）
 * @param rows 报错日志记录数组
 */
export const pushErrorLogs = (rows: WeblogErrorLog[]): void => {
  if (rows.length > 0) appendMemory(errorMemory, rows);
};

/**
 * 行为日志入内存并落库
 * @param rows 行为日志记录数组
 * @returns 实际落库行数（浏览器环境为 0）
 */
export const persistActionLogs = async (rows: WeblogActionLog[]): Promise<number> => {
  if (rows.length === 0) return 0;
  pushActionLogs(rows);
  if (!isWeblogDbAvailable()) return 0;
  try {
    return await insertActionLogRows(rows);
  } catch (error) {
    console.warn('[weblog] 行为日志落库失败', error);
    return 0;
  }
};

/**
 * 报错日志入内存并落库
 * @param rows 报错日志记录数组
 * @returns 实际落库行数（浏览器环境为 0）
 */
export const persistErrorLogs = async (rows: WeblogErrorLog[]): Promise<number> => {
  if (rows.length === 0) return 0;
  pushErrorLogs(rows);
  if (!isWeblogDbAvailable()) return 0;
  try {
    return await insertErrorLogRows(rows);
  } catch (error) {
    console.warn('[weblog] 报错日志落库失败', error);
    return 0;
  }
};

/**
 * 关键字是否命中一条行为记录
 * @param row 行为记录
 * @param keyword 关键字
 * @returns 是否命中
 */
const matchActionKeyword = (row: WeblogActionLog, keyword: string): boolean =>
  [row.label, row.action, row.target, row.detail, row.pagePath]
    .filter((field): field is string => typeof field === 'string')
    .some((field) => field.toLowerCase().includes(keyword));

/**
 * 关键字是否命中一条报错记录
 * @param row 报错记录
 * @param keyword 关键字
 * @returns 是否命中
 */
const matchErrorKeyword = (row: WeblogErrorLog, keyword: string): boolean =>
  [row.message, row.stack, row.kind, row.pagePath, row.apiUrl, row.detail]
    .filter((field): field is string => typeof field === 'string')
    .some((field) => field.toLowerCase().includes(keyword));

/**
 * 内存行为日志查询（浏览器降级路径）
 * @param query 查询条件
 * @returns 过滤后的行为日志（时间倒序）
 */
const queryActionMemory = (query: WeblogQuery): WeblogActionLog[] => {
  const keyword = query.keyword?.trim().toLowerCase() ?? '';
  const limit = query.limit && query.limit > 0 ? query.limit : actionMemory.length;
  return actionMemory
    .filter((row) => (query.sinceMs ? row.occurredAt >= query.sinceMs : true))
    .filter((row) => (query.category ? row.category === query.category : true))
    .filter((row) => (keyword ? matchActionKeyword(row, keyword) : true))
    .slice(0, limit);
};

/**
 * 内存报错日志查询（浏览器降级路径）
 * @param query 查询条件
 * @returns 过滤后的报错日志（时间倒序）
 */
const queryErrorMemory = (query: WeblogQuery): WeblogErrorLog[] => {
  const keyword = query.keyword?.trim().toLowerCase() ?? '';
  const limit = query.limit && query.limit > 0 ? query.limit : errorMemory.length;
  return errorMemory
    .filter((row) => (query.sinceMs ? row.occurredAt >= query.sinceMs : true))
    .filter((row) => (query.level ? row.level === query.level : true))
    .filter((row) => (keyword ? matchErrorKeyword(row, keyword) : true))
    .slice(0, limit);
};

/**
 * 查询行为日志（Tauri 走库，浏览器走内存）
 * @param query 查询条件
 * @returns 行为日志列表（时间倒序）
 */
export const queryActionLogs = async (query: WeblogQuery = {}): Promise<WeblogActionLog[]> => {
  if (!isWeblogDbAvailable()) return queryActionMemory(query);
  try {
    return await selectActionLogs(query);
  } catch (error) {
    console.warn('[weblog] 行为日志查询失败，回退内存缓冲', error);
    return queryActionMemory(query);
  }
};

/**
 * 查询报错日志（Tauri 走库，浏览器走内存）
 * @param query 查询条件
 * @returns 报错日志列表（时间倒序）
 */
export const queryErrorLogs = async (query: WeblogQuery = {}): Promise<WeblogErrorLog[]> => {
  if (!isWeblogDbAvailable()) return queryErrorMemory(query);
  try {
    return await selectErrorLogs(query);
  } catch (error) {
    console.warn('[weblog] 报错日志查询失败，回退内存缓冲', error);
    return queryErrorMemory(query);
  }
};

/**
 * 查询日志统计（页面头部概览）
 * @param sinceMs 保留起始时间（毫秒）
 * @returns 报错 / 行为条数统计
 */
export const queryLogStats = async (sinceMs: number): Promise<WeblogLogStats> => {
  if (!isWeblogDbAvailable()) {
    return {
      errorCount: queryErrorMemory({ sinceMs }).length,
      actionCount: queryActionMemory({ sinceMs }).length,
      retentionFrom: sinceMs,
    };
  }
  try {
    return await selectLogStats(sinceMs);
  } catch (error) {
    console.warn('[weblog] 日志统计失败', error);
    return { errorCount: 0, actionCount: 0, retentionFrom: sinceMs };
  }
};

/**
 * 清空全部日志（内存缓冲与数据库同时清）
 * @returns 两表各自删除行数（浏览器环境为内存条数）
 */
export const clearWeblogLogs = async (): Promise<{
  errorDeleted: number;
  actionDeleted: number;
}> => {
  const memoryResult = {
    errorDeleted: errorMemory.length,
    actionDeleted: actionMemory.length,
  };
  actionMemory.length = 0;
  errorMemory.length = 0;
  if (!isWeblogDbAvailable()) return memoryResult;
  try {
    return await deleteAllLogs();
  } catch (error) {
    console.warn('[weblog] 清空日志失败', error);
    return memoryResult;
  }
};

/**
 * 就地裁剪内存缓冲（保留 cutoff 之后的记录）
 * @param buffer 目标缓冲
 * @param cutoffMs 保留起始时间（毫秒）
 * @returns 被移除的记录条数
 */
const trimMemory = <T extends { occurredAt: number }>(buffer: T[], cutoffMs: number): number => {
  const kept = buffer.filter((row) => row.occurredAt >= cutoffMs);
  const removed = buffer.length - kept.length;
  buffer.length = 0;
  buffer.push(...kept);
  return removed;
};

/**
 * 裁剪保留期之外的日志（启动与定时任务调用；内存缓冲同步裁剪）
 * @param cutoffMs 保留起始时间（毫秒）
 * @returns 两表各自删除行数
 */
export const pruneWeblogLogs = async (
  cutoffMs: number,
): Promise<{ errorDeleted: number; actionDeleted: number }> => {
  const memoryResult = {
    errorDeleted: trimMemory(errorMemory, cutoffMs),
    actionDeleted: trimMemory(actionMemory, cutoffMs),
  };
  if (!isWeblogDbAvailable()) return memoryResult;
  try {
    return await deleteLogsBefore(cutoffMs);
  } catch (error) {
    console.warn('[weblog] 过期日志裁剪失败', error);
    return memoryResult;
  }
};

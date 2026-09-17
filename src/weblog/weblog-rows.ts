/**
 * 系统日志落库 · 纯函数层（列序 + 行取值映射）
 *
 * 为什么单独一个文件：这里是「库表列」与「内存记录」的唯一映射点，
 * 一旦两者错位，日志会静默写歪（曾出过的事故：列 16 个、取值 15 个，
 * 导致 `ua` / `session_id` / `trace_id` 整体前移、`trace_id` 恒为 NULL）。
 * 抽成无副作用纯函数后，可被冒烟断言直跑（`.ai/tmp/weblog-rows-smoke.mjs`），
 * 也能脱离 Tauri 环境验证「列名 ↔ 取值器」是否一一对应。
 *
 * ⚠️ 列名与顺序必须与 `src-tauri/src/lib.rs` 的 WEBLOG_DB_V1 建表语句一致。
 */
import type { WeblogActionLog, WeblogErrorLog } from '../types/weblog.types';

/** 可写入 SQLite 的标量值 */
export type WeblogSqlValue = string | number | null;

/** 报错日志列顺序（INSERT 与 SELECT 共用，改动必须同步 Rust 侧建表） */
export const ERROR_LOG_COLUMNS = [
  'occurred_at',
  'time_text',
  'level',
  'kind',
  'message',
  'stack',
  'page_path',
  'page_title',
  'api_url',
  'api_status',
  'duration_ms',
  'app_version',
  'runtime',
  'os_name',
  'os_version',
  'ua',
  'webview',
  'screen',
  'trace_id',
  'detail',
] as const;

/** 行为日志列顺序 */
export const ACTION_LOG_COLUMNS = [
  'occurred_at',
  'time_text',
  'action',
  'category',
  'label',
  'target',
  'detail',
  'page_path',
  'page_title',
  'duration_ms',
  'status',
  'app_version',
  'os_name',
  'ua',
  'session_id',
  'trace_id',
] as const;

/** 报错日志列名 */
export type ErrorLogColumn = (typeof ERROR_LOG_COLUMNS)[number];

/** 行为日志列名 */
export type ActionLogColumn = (typeof ACTION_LOG_COLUMNS)[number];

/**
 * 行为日志「列名 → 取值器」
 *
 * 刻意按列名取值而不是按位置摆数组：`Record<ActionLogColumn, …>` 由 TS 做穷尽校验
 * （少一个列取值器就编译不过），列顺序调整也不会错位 —— 这类错位的代价是日志静默写歪，
 * 编译器守门比人眼可靠。
 */
const ACTION_LOG_GETTERS: Record<ActionLogColumn, (row: WeblogActionLog) => WeblogSqlValue> = {
  occurred_at: (row) => row.occurredAt,
  time_text: (row) => row.timeText,
  action: (row) => row.action,
  category: (row) => row.category,
  label: (row) => row.label,
  target: (row) => row.target ?? null,
  detail: (row) => row.detail ?? null,
  page_path: (row) => row.pagePath,
  page_title: (row) => row.pageTitle ?? null,
  duration_ms: (row) => row.durationMs ?? null,
  status: (row) => row.status ?? null,
  app_version: (row) => row.appVersion,
  os_name: (row) => row.osName ?? null,
  ua: (row) => row.ua ?? null,
  session_id: (row) => row.sessionId ?? null,
  trace_id: (row) => row.traceId ?? null,
};

/** 报错日志「列名 → 取值器」（同上：穷尽校验 + 与列序解耦） */
const ERROR_LOG_GETTERS: Record<ErrorLogColumn, (row: WeblogErrorLog) => WeblogSqlValue> = {
  occurred_at: (row) => row.occurredAt,
  time_text: (row) => row.timeText,
  level: (row) => row.level,
  kind: (row) => row.kind,
  message: (row) => row.message,
  stack: (row) => row.stack ?? null,
  page_path: (row) => row.pagePath,
  page_title: (row) => row.pageTitle ?? null,
  api_url: (row) => row.apiUrl ?? null,
  api_status: (row) => row.apiStatus ?? null,
  duration_ms: (row) => row.durationMs ?? null,
  app_version: (row) => row.appVersion,
  runtime: (row) => row.runtime,
  os_name: (row) => row.osName ?? null,
  os_version: (row) => row.osVersion ?? null,
  ua: (row) => row.ua ?? null,
  webview: (row) => row.webview ?? null,
  screen: (row) => row.screen ?? null,
  trace_id: (row) => row.traceId ?? null,
  detail: (row) => row.detail ?? null,
};

/**
 * 行为日志 → 按 `ACTION_LOG_COLUMNS` 顺序排列的参数数组
 * @param row 行为日志记录
 * @returns 与列序一一对应的值数组（长度恒等于列数）
 */
export const toActionLogValues = (row: WeblogActionLog): WeblogSqlValue[] =>
  ACTION_LOG_COLUMNS.map((column) => ACTION_LOG_GETTERS[column](row));

/**
 * 报错日志 → 按 `ERROR_LOG_COLUMNS` 顺序排列的参数数组
 * @param row 报错日志记录
 * @returns 与列序一一对应的值数组（长度恒等于列数）
 */
export const toErrorLogValues = (row: WeblogErrorLog): WeblogSqlValue[] =>
  ERROR_LOG_COLUMNS.map((column) => ERROR_LOG_GETTERS[column](row));

/**
 * 取某列在行为日志里对应的取值器（冒烟断言用：验证「列 ↔ 字段」映射语义）
 * @param column 列名
 * @returns 取值器
 */
export const getActionLogGetter = (
  column: ActionLogColumn,
): ((row: WeblogActionLog) => WeblogSqlValue) => ACTION_LOG_GETTERS[column];

/**
 * 取某列在报错日志里对应的取值器（冒烟断言用）
 * @param column 列名
 * @returns 取值器
 */
export const getErrorLogGetter = (
  column: ErrorLogColumn,
): ((row: WeblogErrorLog) => WeblogSqlValue) => ERROR_LOG_GETTERS[column];

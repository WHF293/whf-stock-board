/**
 * 内置 MCP：应用接口（app-api）
 *
 * 把应用内部接口封装成 MCP 工具供 Agent 调用（进程内直调，不经网络）：
 * - 保存新闻 / 已保存新闻读写（news_saved 表，与热点新闻页共用）；
 * - 本地数据库访问（agent.db / stock-board.db 通用 SQL 读写；weblog.db 只读，
 *   供 Agent 排查「刚才报了什么错 / 用户点了什么」）。
 *
 * 本服务器为**内置 MCP**：不可删除、不可编辑，随应用常驻
 */
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { z } from 'zod';
import {
  deleteSavedNews,
  listSavedNews,
  saveNews,
} from '../../api/news-db.api';
import type { BuiltinMcpServer, McpCallToolResult, McpToolEntry } from './types';

/** 本地库名 → 连接串 */
const DB_DSN: Record<'agent' | 'stock-board' | 'weblog', string> = {
  agent: 'sqlite:agent.db',
  'stock-board': 'sqlite:stock-board.db',
  weblog: 'sqlite:weblog.db',
};

let agentDbPromise: Promise<Database> | null = null;
let boardDbPromise: Promise<Database> | null = null;
let weblogDbPromise: Promise<Database> | null = null;

/**
 * 惰性打开指定本地库（非 Tauri 抛错，由 execute 统一包装为错误文本）
 * @param key 库名
 * @returns 数据库连接 Promise
 */
const loadDb = async (key: keyof typeof DB_DSN): Promise<Database> => {
  if (!isTauri()) throw new Error('本地数据库仅 Tauri 桌面端可用');
  if (key === 'agent') {
    agentDbPromise ??= Database.load(DB_DSN.agent);
    return agentDbPromise;
  }
  if (key === 'weblog') {
    weblogDbPromise ??= Database.load(DB_DSN.weblog);
    return weblogDbPromise;
  }
  boardDbPromise ??= Database.load(DB_DSN['stock-board']);
  return boardDbPromise;
};

/**
 * 单语句校验：去掉尾部分号后不允许再出现分号（拒绝多语句拼接注入）
 * @param sql 用户 SQL
 * @returns 清理后的单条 SQL
 */
const assertSingleStatement = (sql: string): string => {
  const trimmed = sql.trim().replace(/;+\s*$/, '');
  if (trimmed.includes(';')) {
    throw new Error('仅允许单条 SQL 语句（检测到多余的分号）');
  }
  return trimmed;
};

/**
 * 构造工具条目（zod schema 为单一事实源，inputSchema 由其推导出 JSON Schema）
 *
 * 本服务器的工具全部是**写操作或任意 SQL**：一律 `uiCallable: false`
 * ——沙箱 iframe 内的 MCP App 不得触发落库 / 改库（安全边界，勿放开）。
 *
 * @param name 工具名（snake_case）
 * @param description 给模型看的用途说明
 * @param schema 入参 zod schema
 * @param run 工具执行体（返回模型可见文本或可 JSON 序列化的对象）
 * @returns MCP 工具条目
 */
const entry = (
  name: string,
  description: string,
  schema: z.ZodType,
  run: (input: unknown) => Promise<unknown>,
): McpToolEntry => ({
  definition: { name, description, inputSchema: z.toJSONSchema(schema) as Record<string, unknown> },
  schema,
  uiCallable: false,
  execute: async (input): Promise<McpCallToolResult> => {
    const result = await run(input);
    return {
      content: [{ type: 'text', text: typeof result === 'string' ? result : JSON.stringify(result) }],
    };
  },
});

/** 内置「应用接口」MCP 服务器 */
export const APP_MCP_SERVER: BuiltinMcpServer = {
  key: 'app-api',
  name: '应用接口（内置）',
  description:
    '保存新闻、已保存新闻读写与本地数据库（agent.db / stock-board.db / weblog.db）访问',
  tools: [
    entry(
      'save_news',
      '保存一条新闻到本地新闻库（按 url 幂等，重复保存返回 saved=false）。source 用新闻源名（如 新浪/东财/澎湃），publishedAt 为毫秒时间戳可省略',
      z.object({
        source: z.string().describe('新闻源名称'),
        title: z.string().describe('新闻标题'),
        url: z.string().url().describe('新闻原文链接'),
        summary: z.string().nullish().describe('摘要（可省略）'),
        publishedAt: z.number().int().nullish().describe('发布时间毫秒时间戳（可省略）'),
      }),
      async (input) =>
        JSON.stringify(
          await saveNews(
            input as { source: string; title: string; url: string; summary?: string | null; publishedAt?: number | null },
          ),
        ),
    ),
    entry(
      'list_saved_news',
      '列出本地新闻库已保存的新闻（按保存时间倒序），返回 source/title/url/summary 等字段',
      z.object({
        limit: z.number().int().min(1).max(200).default(50).describe('返回条数上限，默认 50'),
      }),
      async (input) => JSON.stringify(await listSavedNews((input as { limit: number }).limit)),
    ),
    entry(
      'delete_saved_news',
      '按 url 删除本地新闻库中已保存的新闻',
      z.object({ url: z.string().url().describe('要删除的新闻链接') }),
      async (input) =>
        JSON.stringify(await deleteSavedNews((input as { url: string }).url)),
    ),
    entry(
      'db_query',
      '本地 SQLite 只读查询（agent.db：模型/Agent 配置/会话/技能/MCP；stock-board.db：板块/账户交割单/自选等业务表；weblog.db：error_log 报错日志 / action_log 行为日志，保留最近 3 天）。仅允许 SELECT / WITH 开头的单条语句',
      z.object({
        database: z.enum(['agent', 'stock-board', 'weblog']).describe('目标库名'),
        sql: z.string().describe('单条 SELECT 语句（建议显式 LIMIT）'),
      }),
      async (input) => {
        const { database, sql } = input as {
          database: 'agent' | 'stock-board' | 'weblog';
          sql: string;
        };
        const clean = assertSingleStatement(sql);
        if (!/^(select|with)\b/i.test(clean)) {
          return JSON.stringify({ error: 'db_query 仅允许 SELECT / WITH 查询' });
        }
        const db = await loadDb(database);
        const rows = await db.select<unknown[]>(clean);
        return JSON.stringify({ rows, count: rows.length });
      },
    ),
    entry(
      'db_execute',
      '本地 SQLite 写操作（INSERT / UPDATE / DELETE 单条语句，仅 agent.db / stock-board.db；日志库 weblog.db 只读，不开放写入与删除）。DDL（CREATE / DROP / ALTER）与 PRAGMA、ATTACH 一律拒绝',
      z.object({
        database: z.enum(['agent', 'stock-board']).describe('目标库名'),
        sql: z.string().describe('单条写语句'),
        params: z.array(z.unknown()).default([]).describe('位置参数 $1/$2… 对应的值列表'),
      }),
      async (input) => {
        const { database, sql, params } = input as {
          database: 'agent' | 'stock-board';
          sql: string;
          params: unknown[];
        };
        const clean = assertSingleStatement(sql);
        if (!/^(insert|update|delete)\b/i.test(clean)) {
          return JSON.stringify({ error: 'db_execute 仅允许 INSERT / UPDATE / DELETE' });
        }
        const db = await loadDb(database);
        const result = await db.execute(clean, params);
        return JSON.stringify({ rowsAffected: result.rowsAffected ?? 0 });
      },
    ),
  ],
};

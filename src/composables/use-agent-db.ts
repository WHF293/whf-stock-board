/**
 * agent.db 唯一落库出口（方案 §4 composables/use-agent-db.ts）
 *
 * 职责：
 * - 持有 `sqlite:agent.db` 连接单例（插件 migration 负责建表）；
 * - 蛇形行 → 驼峰接口的映射边界（UI 层不接触原始行）；
 * - JSON 文本列（toolNames 等）的序列化边界；
 * - 会话隔离：消息读写 SQL 一律带 session_id 条件。
 *
 * 约束：业务代码不允许绕过本文件直接 `load()` agent.db。
 */
import Database from '@tauri-apps/plugin-sql';
import { AGENT_DB_URL } from '@/constants/agent.constants';
import type {
  AgentProfile,
  ChatGroup,
  ChatMessage,
  ChatSession,
  CreateSessionInput,
  McpServer,
  McpTransport,
  MessagePart,
  MessageStatus,
  ModelConfig,
  ModelPresetKey,
  Skill,
  SubagentDef,
} from '@/types/agent.types';

/** 连接单例（Database.load 自带插件 migration；首连时补 PRAGMA） */
let dbPromise: Promise<Database> | null = null;

/**
 * 获取 agent.db 连接（懒加载单例）
 * @returns tauri-plugin-sql Database 实例
 */
export function getAgentDb(): Promise<Database> {
  if (dbPromise === null) {
    const created = Database.load(AGENT_DB_URL).then(async (db) => {
      // 级联删除依赖外键；sqlx 默认行为可能随版本变化，这里显式打开
      await db.execute('PRAGMA foreign_keys = ON');
      return db;
    });
    dbPromise = created;
  }
  return dbPromise;
}

/* ---------------------------------- 行映射 --------------------------------- */

/** DB 原始行（蛇形列，类型宽松） */
type Row = Record<string, unknown>;

/**
 * 行取值兜底（字符串）
 * @param v DB 原始值
 * @param fallback 非字符串时的兜底
 * @returns 字符串值
 */
function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

/**
 * 行取值兜底（数值，空值按 0）
 * @param v DB 原始值
 * @returns 数值
 */
function num(v: unknown): number {
  return typeof v === 'number' ? v : Number(v ?? 0);
}

/**
 * 行取值兜底（可空数值）
 * @param v DB 原始值
 * @returns 数值或 null
 */
function numOrNull(v: unknown): number | null {
  return v === null || v === undefined ? null : Number(v);
}

/**
 * 行取值兜底（布尔，0/1 → false/true）
 * @param v DB 原始值
 * @returns 布尔值
 */
function bool(v: unknown): boolean {
  return v === 1 || v === true;
}

/**
 * JSON 文本列 → 字符串数组（坏数据兜底为空数组）
 * @param v DB 原始 JSON 文本
 * @returns 字符串数组
 */
function jsonArr(v: unknown): string[] {
  if (typeof v !== 'string' || !v) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * JSON 文本列 → number 数组（profile 的 id 列表）
 * @param v DB 原始 JSON 文本
 * @returns 数值数组
 */
function jsonIdArr(v: unknown): number[] {
  if (typeof v !== 'string' || !v) return [];
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(Number) : [];
  } catch {
    return [];
  }
}

/**
 * parts JSON → 结构化块
 * @param v DB 原始 JSON 文本
 * @returns 结构化块数组或 null
 */
function parseParts(v: unknown): MessagePart[] | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    const parsed: unknown = JSON.parse(v);
    return Array.isArray(parsed) ? (parsed as MessagePart[]) : null;
  } catch {
    return null;
  }
}

/**
 * chat_group 行 → ChatGroup
 * @param r DB 原始行
 * @returns 分组对象
 */
function toGroup(r: Row): ChatGroup {
  return {
    id: num(r.id),
    name: str(r.name),
    sortOrder: num(r.sort_order),
    createdAt: num(r.created_at),
  };
}

/**
 * chat_session 行 → ChatSession
 * @param r DB 原始行
 * @returns 会话对象
 */
function toSession(r: Row): ChatSession {
  return {
    id: num(r.id),
    groupId: numOrNull(r.group_id),
    title: str(r.title),
    modelId: numOrNull(r.model_id),
    agentProfileId: numOrNull(r.agent_profile_id),
    pinned: bool(r.pinned),
    sortOrder: num(r.sort_order),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/* ------------------------------ 模型 / Skill / MCP ----------------------------- */

/** 保存模型配置入参（id 缺省 = 新建） */
export type SaveModelInput = Omit<ModelConfig, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: number;
};

/**
 * model_config 行 → ModelConfig（M2 模型管理使用）
 * @param r DB 原始行
 * @returns 模型配置对象
 */
export function toModel(r: Row): ModelConfig {
  return {
    id: num(r.id),
    name: str(r.name),
    presetKey: (r.preset_key as ModelPresetKey | null) ?? null,
    baseUrl: str(r.base_url),
    apiKey: str(r.api_key),
    modelId: str(r.model_id),
    supportsTools: bool(r.supports_tools),
    supportsImage: bool(r.supports_image),
    supportsThinking: bool(r.supports_thinking),
    maxInputTokens: numOrNull(r.max_input_tokens),
    maxOutputTokens: numOrNull(r.max_output_tokens),
    temperature: numOrNull(r.temperature),
    isDefault: bool(r.is_default),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/**
 * agent_profile 行 → AgentProfile（M4 Agent 配置使用）
 * @param r DB 原始行
 * @returns Agent 配置对象
 */
export function toProfile(r: Row): AgentProfile {
  return {
    id: num(r.id),
    name: str(r.name),
    description: (r.description as string | null) ?? null,
    systemPrompt: (r.system_prompt as string | null) ?? null,
    modelId: numOrNull(r.model_id),
    toolNames: jsonArr(r.tool_names),
    skillIds: jsonIdArr(r.skill_ids),
    mcpIds: jsonIdArr(r.mcp_ids),
    subagentIds: jsonIdArr(r.subagent_ids),
    isDefault: bool(r.is_default),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

/**
 * skill 行 → Skill
 * @param r DB 原始行
 * @returns Skill 对象
 */
export function toSkill(r: Row): Skill {
  return {
    id: num(r.id),
    name: str(r.name),
    dirName: str(r.dir_name),
    description: (r.description as string | null) ?? null,
    enabled: bool(r.enabled),
    createdAt: num(r.created_at),
  };
}

/**
 * mcp_server 行 → McpServer
 * @param r DB 原始行
 * @returns MCP 服务器对象
 */
export function toMcpServer(r: Row): McpServer {
  let headers: Record<string, string> | null = null;
  if (typeof r.headers === 'string' && r.headers) {
    try {
      const parsed: unknown = JSON.parse(r.headers);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        headers = parsed as Record<string, string>;
      }
    } catch {
      headers = null;
    }
  }
  return {
    id: num(r.id),
    name: str(r.name),
    transport: str(r.transport, 'streamable-http') as McpTransport,
    url: str(r.url),
    headers,
    enabled: bool(r.enabled),
    createdAt: num(r.created_at),
  };
}

/**
 * subagent 行 → SubagentDef（M4 subagent 管理使用）
 * @param r DB 原始行
 * @returns subagent 定义对象
 */
export function toSubagent(r: Row): SubagentDef {
  return {
    id: num(r.id),
    name: str(r.name),
    description: str(r.description),
    prompt: str(r.prompt),
    modelId: numOrNull(r.model_id),
    toolNames: jsonArr(r.tool_names),
    createdAt: num(r.created_at),
    updatedAt: num(r.updated_at),
  };
}

function toMessage(r: Row): ChatMessage {
  return {
    id: num(r.id),
    sessionId: num(r.session_id),
    role: str(r.role) as ChatMessage['role'],
    content: str(r.content),
    parts: parseParts(r.parts),
    status: str(r.status, 'done') as MessageStatus,
    error: (r.error as string | null) ?? null,
    createdAt: num(r.created_at),
  };
}

/* ----------------------------------- 分组 ---------------------------------- */

/**
 * 分组列表（sort_order 升序，id 兜底）
 * @returns 分组数组
 */
export async function listGroups(): Promise<ChatGroup[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>('SELECT * FROM chat_group ORDER BY sort_order, id');
  return rows.map(toGroup);
}

/**
 * 新建分组
 * @param name 分组名
 * @returns 新分组 id
 */
export async function createGroup(name: string): Promise<number> {
  const db = await getAgentDb();
  const result = await db.execute(
    'INSERT INTO chat_group (name, sort_order, created_at) VALUES ($1, $2, $3)',
    [name, Date.now(), Date.now()],
  );
  return Number(result.lastInsertId);
}

/**
 * 重命名分组
 * @param id 分组 id
 * @param name 新名称
 */
export async function renameGroup(id: number, name: string): Promise<void> {
  const db = await getAgentDb();
  await db.execute('UPDATE chat_group SET name = $1 WHERE id = $2', [name, id]);
}

/**
 * 删除分组（会话回落「未分组」，不删会话）
 * @param id 分组 id
 */
export async function deleteGroup(id: number): Promise<void> {
  const db = await getAgentDb();
  await db.execute('DELETE FROM chat_group WHERE id = $1', [id]);
}

/**
 * 批量写入分组排序
 * @param orders id → 新 sort_order
 */
export async function updateGroupOrders(orders: Array<{ id: number; sortOrder: number }>): Promise<void> {
  const db = await getAgentDb();
  for (const { id, sortOrder } of orders) {
    await db.execute('UPDATE chat_group SET sort_order = $1 WHERE id = $2', [sortOrder, id]);
  }
}

/* ----------------------------------- 会话 ---------------------------------- */

/**
 * 全量会话列表（置顶 → sort_order → id；UI 按 group 分桶）
 * @returns 会话数组
 */
export async function listSessions(): Promise<ChatSession[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>(
    'SELECT * FROM chat_session ORDER BY pinned DESC, sort_order, id',
  );
  return rows.map(toSession);
}

/**
 * 新建会话
 * @param input 标题 / 分组 / 模型 / Agent 配置（均可缺省）
 * @returns 新会话 id
 */
export async function createSession(input: CreateSessionInput = {}): Promise<number> {
  const db = await getAgentDb();
  const now = Date.now();
  // 新会话排到组内最前（同组最小 sort_order - 1）
  const head = await db.select<Row[]>(
    'SELECT MIN(sort_order) AS min_order FROM chat_session WHERE group_id IS $1',
    [input.groupId ?? null],
  );
  const minOrder = numOrNull(head[0]?.min_order) ?? 0;
  const result = await db.execute(
    `INSERT INTO chat_session (group_id, title, model_id, agent_profile_id, sort_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.groupId ?? null,
      input.title ?? '新对话',
      input.modelId ?? null,
      input.agentProfileId ?? null,
      minOrder - 1,
      now,
      now,
    ],
  );
  return Number(result.lastInsertId);
}

/**
 * 重命名会话
 * @param id 会话 id
 * @param title 新标题
 */
export async function renameSession(id: number, title: string): Promise<void> {
  const db = await getAgentDb();
  await db.execute('UPDATE chat_session SET title = $1, updated_at = $2 WHERE id = $3', [
    title,
    Date.now(),
    id,
  ]);
}

/**
 * 移动会话到分组（null = 未分组）
 * @param id 会话 id
 * @param groupId 目标分组 id
 */
export async function moveSession(id: number, groupId: number | null): Promise<void> {
  const db = await getAgentDb();
  await db.execute('UPDATE chat_session SET group_id = $1, updated_at = $2 WHERE id = $3', [
    groupId,
    Date.now(),
    id,
  ]);
}

/**
 * 置顶 / 取消置顶
 * @param id 会话 id
 * @param pinned 是否置顶
 */
export async function setSessionPinned(id: number, pinned: boolean): Promise<void> {
  const db = await getAgentDb();
  await db.execute('UPDATE chat_session SET pinned = $1, updated_at = $2 WHERE id = $3', [
    pinned ? 1 : 0,
    Date.now(),
    id,
  ]);
}

/**
 * 删除会话（消息级联删除）
 * @param id 会话 id
 */
export async function deleteSession(id: number): Promise<void> {
  const db = await getAgentDb();
  await db.execute('DELETE FROM chat_session WHERE id = $1', [id]);
}

/**
 * 批量写入会话排序与归属（拖拽排序 / 跨组移动共用）
 * @param orders id → 新 sort_order / group_id
 */
export async function updateSessionOrders(
  orders: Array<{ id: number; sortOrder: number; groupId: number | null }>,
): Promise<void> {
  const db = await getAgentDb();
  for (const { id, sortOrder, groupId } of orders) {
    await db.execute(
      'UPDATE chat_session SET sort_order = $1, group_id = $2, updated_at = $3 WHERE id = $4',
      [sortOrder, groupId, Date.now(), id],
    );
  }
}

/* ----------------------------------- 消息 ---------------------------------- */

/**
 * 会话消息列表（强制 session_id 隔离）
 * @param sessionId 会话 id
 * @returns 消息数组（时间升序）
 */
export async function listMessages(sessionId: number): Promise<ChatMessage[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>(
    'SELECT * FROM chat_message WHERE session_id = $1 ORDER BY created_at, id',
    [sessionId],
  );
  return rows.map(toMessage);
}

/**
 * 插入消息
 * @param msg 消息内容（parts 结构化块可选）
 * @param msg.sessionId
 * @param msg.role
 * @param msg.content
 * @param msg.parts
 * @param msg.status
 * @param msg.error
 * @returns 新消息 id
 */
export async function insertMessage(msg: {
  sessionId: number;
  role: ChatMessage['role'];
  content: string;
  parts?: MessagePart[] | null;
  status?: MessageStatus;
  error?: string | null;
}): Promise<number> {
  const db = await getAgentDb();
  const result = await db.execute(
    `INSERT INTO chat_message (session_id, role, content, parts, status, error, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      msg.sessionId,
      msg.role,
      msg.content,
      msg.parts ? JSON.stringify(msg.parts) : null,
      msg.status ?? 'done',
      msg.error ?? null,
      Date.now(),
    ],
  );
  return Number(result.lastInsertId);
}

/**
 * 更新消息内容与状态（流式 checkpoint / 终态覆写共用）
 * @param id 消息 id
 * @param patch 待更新字段
 * @param patch.content
 * @param patch.parts
 * @param patch.status
 * @param patch.error
 */
export async function updateMessage(
  id: number,
  patch: {
    content?: string;
    parts?: MessagePart[] | null;
    status?: MessageStatus;
    error?: string | null;
  },
): Promise<void> {
  const db = await getAgentDb();
  await db.execute(
    'UPDATE chat_message SET content = $1, parts = $2, status = $3, error = $4 WHERE id = $5',
    [
      patch.content ?? '',
      patch.parts ? JSON.stringify(patch.parts) : null,
      patch.status ?? 'done',
      patch.error ?? null,
      id,
    ],
  );
}

/* ------------------------- 模型 / 配置 / 子 agent 计数 ------------------------- */

/** 左栏角标计数 */
export interface AgentCounts {
  models: number;
  profiles: number;
  skills: number;
  mcps: number;
}

/**
 * 各管理表计数（左栏角标用）
 * @returns 计数对象
 */
export async function getAgentCounts(): Promise<AgentCounts> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>(
    `SELECT
       (SELECT COUNT(*) FROM model_config) AS models,
       (SELECT COUNT(*) FROM agent_profile) AS profiles,
       (SELECT COUNT(*) FROM skill WHERE enabled = 1) AS skills,
       (SELECT COUNT(*) FROM mcp_server WHERE enabled = 1) AS mcps`,
  );
  return {
    models: num(rows[0]?.models),
    profiles: num(rows[0]?.profiles),
    skills: num(rows[0]?.skills),
    mcps: num(rows[0]?.mcps),
  };
}

/* ---------------------------------- 模型 CRUD --------------------------------- */

/**
 * 全量模型列表
 * @returns 模型数组
 */
export async function listModels(): Promise<ModelConfig[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>('SELECT * FROM model_config ORDER BY id');
  return rows.map(toModel);
}

/**
 * 新增 / 更新模型配置；设为默认时清除其它默认
 * @param input 模型字段（id 缺省 = 新建）
 * @returns 生效的模型 id
 */
export async function saveModel(input: SaveModelInput): Promise<number> {
  const db = await getAgentDb();
  const now = Date.now();
  let id: number;
  if (input.id === undefined) {
    const result = await db.execute(
      `INSERT INTO model_config
         (name, preset_key, base_url, api_key, model_id, supports_tools, supports_image,
          supports_thinking, max_input_tokens, max_output_tokens, temperature, is_default,
          created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        input.name,
        input.presetKey,
        input.baseUrl,
        input.apiKey,
        input.modelId,
        input.supportsTools ? 1 : 0,
        input.supportsImage ? 1 : 0,
        input.supportsThinking ? 1 : 0,
        input.maxInputTokens,
        input.maxOutputTokens,
        input.temperature,
        input.isDefault ? 1 : 0,
        now,
        now,
      ],
    );
    id = Number(result.lastInsertId);
  } else {
    id = input.id;
    await db.execute(
      `UPDATE model_config SET name=$1, preset_key=$2, base_url=$3, api_key=$4, model_id=$5,
         supports_tools=$6, supports_image=$7, supports_thinking=$8, max_input_tokens=$9,
         max_output_tokens=$10, temperature=$11, is_default=$12, updated_at=$13
       WHERE id=$14`,
      [
        input.name,
        input.presetKey,
        input.baseUrl,
        input.apiKey,
        input.modelId,
        input.supportsTools ? 1 : 0,
        input.supportsImage ? 1 : 0,
        input.supportsThinking ? 1 : 0,
        input.maxInputTokens,
        input.maxOutputTokens,
        input.temperature,
        input.isDefault ? 1 : 0,
        now,
        id,
      ],
    );
  }
  if (input.isDefault) {
    await db.execute('UPDATE model_config SET is_default = 0 WHERE id != $1', [id]);
  }
  return id;
}

/**
 * 删除模型（引用它的 profile/subagent/session 的 model_id 置空）
 * @param id 模型 id
 */
export async function deleteModel(id: number): Promise<void> {
  const db = await getAgentDb();
  await db.execute('DELETE FROM model_config WHERE id = $1', [id]);
}

/* ---------------------------------- Skill CRUD -------------------------------- */

/**
 * 全量 Skill 列表
 * @returns Skill 数组
 */
export async function listSkills(): Promise<Skill[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>('SELECT * FROM skill ORDER BY id');
  return rows.map(toSkill);
}

/** 新增 Skill 入参 */
export interface SkillCreateInput {
  /** 展示名 */
  name: string;
  /** appData 内唯一目录名 */
  dirName: string;
  /** 描述（可空） */
  description: string | null;
}

/**
 * 新增 Skill（dir_name 唯一，重复返回 -1）
 *
 * @param input Skill 字段
 * @returns 新 id；目录名重复时返回 -1
 */
export async function createSkill(input: SkillCreateInput): Promise<number> {
  const db = await getAgentDb();
  const dup = await db.select<Row[]>('SELECT id FROM skill WHERE dir_name = $1', [input.dirName]);
  if (dup.length > 0) return -1;
  const result = await db.execute(
    'INSERT INTO skill (name, dir_name, description, enabled, created_at) VALUES ($1,$2,$3,1,$4)',
    [input.name, input.dirName, input.description, Date.now()],
  );
  return Number(result.lastInsertId);
}

/**
 * 启用 / 停用 Skill
 * @param id Skill id
 * @param enabled 是否启用
 */
export async function setSkillEnabled(id: number, enabled: boolean): Promise<void> {
  const db = await getAgentDb();
  await db.execute('UPDATE skill SET enabled = $1 WHERE id = $2', [enabled ? 1 : 0, id]);
}

/**
 * 删除 Skill
 * @param id Skill id
 */
export async function deleteSkill(id: number): Promise<void> {
  const db = await getAgentDb();
  await db.execute('DELETE FROM skill WHERE id = $1', [id]);
}

/* ----------------------------------- MCP CRUD --------------------------------- */

/**
 * 全量 MCP 服务器列表
 * @returns MCP 数组
 */
export async function listMcps(): Promise<McpServer[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>('SELECT * FROM mcp_server ORDER BY id');
  return rows.map(toMcpServer);
}

/** 新增 MCP 服务器入参 */
export interface McpCreateInput {
  /** 展示名 */
  name: string;
  /** 传输方式 */
  transport: McpTransport;
  /** 服务地址 */
  url: string;
  /** 请求头键值对（可空） */
  headers: Record<string, string> | null;
}

/**
 * 新增 MCP 服务器
 * @param input MCP 字段
 * @returns 新 id
 */
export async function createMcp(input: McpCreateInput): Promise<number> {
  const db = await getAgentDb();
  const result = await db.execute(
    'INSERT INTO mcp_server (name, transport, url, headers, enabled, created_at) VALUES ($1,$2,$3,$4,1,$5)',
    [input.name, input.transport, input.url, input.headers ? JSON.stringify(input.headers) : null, Date.now()],
  );
  return Number(result.lastInsertId);
}

/**
 * 启用 / 停用 MCP 服务器
 * @param id MCP id
 * @param enabled 是否启用
 */
export async function setMcpEnabled(id: number, enabled: boolean): Promise<void> {
  const db = await getAgentDb();
  await db.execute('UPDATE mcp_server SET enabled = $1 WHERE id = $2', [enabled ? 1 : 0, id]);
}

/**
 * 删除 MCP 服务器
 * @param id MCP id
 */
export async function deleteMcp(id: number): Promise<void> {
  const db = await getAgentDb();
  await db.execute('DELETE FROM mcp_server WHERE id = $1', [id]);
}

/* -------------------------------- Agent 配置 CRUD ------------------------------ */

/**
 * 全量 Agent 配置列表
 * @returns profile 数组
 */
export async function listProfiles(): Promise<AgentProfile[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>('SELECT * FROM agent_profile ORDER BY id');
  return rows.map(toProfile);
}

/** 保存 Agent 配置入参（id 缺省 = 新建） */
export type SaveProfileInput = Omit<AgentProfile, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: number;
};

/**
 * 新增 / 更新 Agent 配置；设为默认时清除其它默认
 * @param input 配置字段
 * @returns 生效的配置 id
 */
export async function saveProfile(input: SaveProfileInput): Promise<number> {
  const db = await getAgentDb();
  const now = Date.now();
  const json = {
    tools: JSON.stringify(input.toolNames),
    skills: JSON.stringify(input.skillIds),
    mcps: JSON.stringify(input.mcpIds),
    subagents: JSON.stringify(input.subagentIds),
  };
  let id: number;
  if (input.id === undefined) {
    const result = await db.execute(
      `INSERT INTO agent_profile
         (name, description, system_prompt, model_id, tool_names, skill_ids, mcp_ids,
          subagent_ids, is_default, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        input.name,
        input.description,
        input.systemPrompt,
        input.modelId,
        json.tools,
        json.skills,
        json.mcps,
        json.subagents,
        input.isDefault ? 1 : 0,
        now,
        now,
      ],
    );
    id = Number(result.lastInsertId);
  } else {
    id = input.id;
    await db.execute(
      `UPDATE agent_profile SET name=$1, description=$2, system_prompt=$3, model_id=$4,
         tool_names=$5, skill_ids=$6, mcp_ids=$7, subagent_ids=$8, is_default=$9, updated_at=$10
       WHERE id=$11`,
      [
        input.name,
        input.description,
        input.systemPrompt,
        input.modelId,
        json.tools,
        json.skills,
        json.mcps,
        json.subagents,
        input.isDefault ? 1 : 0,
        now,
        id,
      ],
    );
  }
  if (input.isDefault) {
    await db.execute('UPDATE agent_profile SET is_default = 0 WHERE id != $1', [id]);
  }
  return id;
}

/**
 * 删除 Agent 配置（绑定会话回落全局默认）
 * @param id 配置 id
 */
export async function deleteProfile(id: number): Promise<void> {
  const db = await getAgentDb();
  await db.execute('DELETE FROM agent_profile WHERE id = $1', [id]);
}

/* --------------------------------- Subagent CRUD ------------------------------- */

/**
 * 全量 subagent 定义列表
 * @returns subagent 数组
 */
export async function listSubagents(): Promise<SubagentDef[]> {
  const db = await getAgentDb();
  const rows = await db.select<Row[]>('SELECT * FROM subagent ORDER BY id');
  return rows.map(toSubagent);
}

/** 保存 subagent 入参（id 缺省 = 新建） */
export type SaveSubagentInput = Omit<SubagentDef, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: number;
};

/**
 * 新增 / 更新 subagent 定义
 * @param input 定义字段
 * @returns 生效的 subagent id
 */
export async function saveSubagent(input: SaveSubagentInput): Promise<number> {
  const db = await getAgentDb();
  const now = Date.now();
  const tools = JSON.stringify(input.toolNames);
  let id: number;
  if (input.id === undefined) {
    const result = await db.execute(
      `INSERT INTO subagent (name, description, prompt, model_id, tool_names, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [input.name, input.description, input.prompt, input.modelId, tools, now, now],
    );
    id = Number(result.lastInsertId);
  } else {
    id = input.id;
    await db.execute(
      `UPDATE subagent SET name=$1, description=$2, prompt=$3, model_id=$4, tool_names=$5, updated_at=$6
       WHERE id=$7`,
      [input.name, input.description, input.prompt, input.modelId, tools, now, id],
    );
  }
  return id;
}

/**
 * 删除 subagent 定义（引用它的 profile.subagent_ids 需调用方刷新清理）
 * @param id subagent id
 */
export async function deleteSubagent(id: number): Promise<void> {
  const db = await getAgentDb();
  await db.execute('DELETE FROM subagent WHERE id = $1', [id]);
}

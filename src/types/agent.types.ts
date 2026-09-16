/**
 * Agent 分析模块类型定义（方案 §3 / §4）
 *
 * 命名约定：DB 蛇形列由 `use-agent-db.ts` 统一映射为这里的驼峰接口，
 * UI 层不接触原始行结构。JSON 文本列（toolNames 等）在此均为数组。
 */

/** 消息角色 */
export type ChatRole = 'user' | 'assistant' | 'system';

/** 消息状态 */
export type MessageStatus = 'running' | 'done' | 'error' | 'stopped';

/** 供应商预设 key（仅影响表单预填，协议统一 OpenAI 兼容） */
export type ModelPresetKey =
  | 'openai'
  | 'deepseek'
  | 'moonshot'
  | 'openrouter'
  | 'ollama'
  | 'custom';

/** 模型配置（model_config 表） */
export interface ModelConfig {
  id: number;
  /** 展示名，如「DeepSeek-V3」 */
  name: string;
  /** 供应商标识（模板快捷用，可空 = custom） */
  presetKey: ModelPresetKey | null;
  /** OpenAI 兼容根地址 */
  baseUrl: string;
  /** 本地明文密钥（UI 掩码、不进日志） */
  apiKey: string;
  /** 模型标识，如 gpt-4o / deepseek-chat */
  modelId: string;
  /** 能力开关：工具调用 */
  supportsTools: boolean;
  /** 能力开关：图片输入 */
  supportsImage: boolean;
  /** 能力开关：思考模式（OpenAI 兼容规范下仅作标记） */
  supportsThinking: boolean;
  /** 输入上下文上限（空 = 提供方默认） */
  maxInputTokens: number | null;
  /** 输出上限（空 = 提供方默认） */
  maxOutputTokens: number | null;
  temperature: number | null;
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Agent 配置（agent_profile 表）：一套「主 agent」定义 */
export interface AgentProfile {
  id: number;
  name: string;
  description: string | null;
  /** 自定义系统提示词（空 = 用全局默认） */
  systemPrompt: string | null;
  /** 主模型（空 = 用会话所选模型） */
  modelId: number | null;
  /** 启用的内置行情工具白名单 */
  toolNames: string[];
  /** 启用的 skills */
  skillIds: number[];
  /** 启用的 MCP 服务器 */
  mcpIds: number[];
  /** 编排的 subagent（有序） */
  subagentIds: number[];
  isDefault: boolean;
  createdAt: number;
  updatedAt: number;
}

/** Subagent 定义（subagent 表，可被多个 profile 复用） */
export interface SubagentDef {
  id: number;
  /** 工具调用名（蛇形，如 kline_analyst） */
  name: string;
  /** 主 agent 据此决定何时派发 */
  description: string;
  /** 子 agent 的 system prompt */
  prompt: string;
  /** 独立模型（空 = 继承主 agent） */
  modelId: number | null;
  /** 工具白名单（空数组 = 继承全部） */
  toolNames: string[];
  /**
   * 子 agent 专属 skill 白名单（skill 名称，空数组 = 无 skill）
   *
   * ⚠️ deepagents 语义：custom subagent **默认不继承**主 agent 的 skills，
   * 必须在此显式声明才会装配（见 create-agent.ts 的 toSubAgents）。
   */
  skillNames: string[];
  /**
   * 是否启用（停用后不参与编排：不进主 agent 的派发清单，也不出现在配置勾选里）
   *
   * ⚠️ 存储分两轨（与 skill / mcp 一致）：
   * - 用户 subagent（id > 0）→ `subagent.enabled` 列；
   * - 内置 subagent（id < 0，纯常量、库里无行）→ `resource_scope.enabled`。
   * 列表里读到的是合并结果，写回由 store 的 toggleSubagent 按 id 分流。
   */
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

/** MCP 传输方式（一期仅远端） */
export type McpTransport = 'streamable-http' | 'sse';

/** 资源访问范围：all = 全部 agent 可用；custom = 仅 resource_grant 列出的 agent 可用 */
export type AccessScope = 'all' | 'custom';

/** 授权对象类型：主 agent（单例）/ 子 agent */
export type GrantAgentKind = 'main' | 'subagent';

/**
 * 受控资源类型
 *
 * ⚠️ `subagent` **只用 `resource_scope.enabled`**（内置子 agent 的启停），
 * 不参与 `resource_grant` 的「精确授权」—— 子 agent 是被主 agent 调用的角色，
 * 再叠加一层「哪些 agent 能用它」没有语义。故 UI 对它只给开关，不给访问范围。
 */
export type GrantResourceKind = 'mcp' | 'skill' | 'subagent';

/**
 * 资源授权行（resource_grant 表）——**授权的唯一事实源**
 *
 * 「资源设置弹窗勾 agent」与「agent 编辑弹窗勾资源」是同一份关系的两个视图，
 * 读写都落在这张表上，因此天然一致、无需同步逻辑。
 */
export interface ResourceGrant {
  id: number;
  resourceKind: GrantResourceKind;
  /** mcp_server.id 或 skill.id */
  resourceId: number;
  agentKind: GrantAgentKind;
  /** main 恒为 MAIN_AGENT_ID(0)；subagent 为 subagent.id（内置子 agent 为负数） */
  agentId: number;
  createdAt: number;
}

/** 授权面板中的可选 agent 项 */
export interface GrantTarget {
  kind: GrantAgentKind;
  /** 主 agent 为 MAIN_AGENT_ID(0) */
  id: number;
  name: string;
  /** 是否内置子 agent（内置不可编辑） */
  builtin: boolean;
}

/** 资源访问范围行（resource_scope 表）—— 内置资源用负数 id */
export interface ResourceScope {
  resourceKind: GrantResourceKind;
  /** mcp_server.id / skill.id，内置资源为负数常量 id */
  resourceId: number;
  scope: AccessScope;
  /**
   * 该资源是否启用（关闭则整体不装配，对任何 agent 都不可用）
   *
   * ⚠️ 仅对**内置资源**有权威性（内置没有自己的表）。用户资源（mcp_server / skill）
   * 的启用状态仍以自身表的 `enabled` 列为准 —— 设置弹窗对用户资源会转写到该列，
   * 保证同一资源只有一个写入者。
   */
  enabled: boolean;
}

/** 单个资源的授权状态（范围 + 启用 + 被授权的对象集合） */
export interface ResourceGrantState {
  /** all = 全部 agent 可用（targets 被忽略）；custom = 仅 targets 列出的可用 */
  scope: AccessScope;
  /** 是否启用（用户资源的启用状态由其自身表承载，本字段仅内置资源有意义） */
  enabled: boolean;
  /** 被授权的 agent 集合（scope='custom' 时生效） */
  targets: Array<{ agentKind: GrantAgentKind; agentId: number }>;
}

/** Skill（skill 表） */
export interface Skill {
  id: number;
  name: string;
  /** appData 内的唯一目录名 */
  dirName: string;
  description: string | null;
  enabled: boolean;
  createdAt: number;
}

/** MCP 服务器（mcp_server 表，仅用户添加的远端服务器；内置服务器见 agent/mcp/constants.ts） */
export interface McpServer {
  id: number;
  name: string;
  transport: McpTransport;
  url: string;
  /** JSON 文本列（键值对） */
  headers: Record<string, string> | null;
  enabled: boolean;
  createdAt: number;
}

/** 会话分组（chat_group 表） */
export interface ChatGroup {
  id: number;
  name: string;
  sortOrder: number;
  createdAt: number;
}

/** 会话（chat_session 表） */
export interface ChatSession {
  id: number;
  /** NULL = 未分组 */
  groupId: number | null;
  title: string;
  modelId: number | null;
  agentProfileId: number | null;
  pinned: boolean;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
}

/** 消息里的结构化块：工具调用卡 */
export interface ToolCallPart {
  type: 'tool_call';
  /** 工具调用 id（配对开始/结束；优先取模型的 tool_call id） */
  callId: string;
  toolName: string;
  /** 所属 MCP server key（卡片徽标：app-api / stock-sdk / remote:<id>） */
  serverKey?: string;
  /** 状态：running / success / error */
  state: 'running' | 'success' | 'error';
  /** 参数（JSON 字符串） */
  argsText: string;
  /** 结果文本（结束时写入） */
  resultText?: string;
  /** 耗时毫秒 */
  durationMs?: number;
  /** subagent 派发（task 卡）时的子 agent 名 */
  subagentName?: string;
  /**
   * MCP Apps 渲染数据：工具声明了 `_meta.ui.resourceUri` 且调用成功时写入，
   * 聊天区据此在卡片内承载沙箱 iframe（载荷只服务 UI，不回灌模型上下文）
   */
  ui?: {
    /** ui://<server>/<app> */
    resourceUri: string;
    /** 工具结果的结构化数据（体积超限时丢弃，仅保留 resourceUri） */
    payload: Record<string, unknown>;
  };
}

/** 消息里的结构化块：todo 计划卡 */
export interface TodoPart {
  type: 'todo';
  items: Array<{ content: string; status: string }>;
}

/** 消息里的结构化块（parts JSON 数组元素） */
export type MessagePart = ToolCallPart | TodoPart;

/** 消息（chat_message 表） */
export interface ChatMessage {
  id: number;
  sessionId: number;
  role: ChatRole;
  /** 纯文本兜底内容（搜索/导出用） */
  content: string;
  /** 结构化块（UI 渲染的事实来源） */
  parts: MessagePart[] | null;
  status: MessageStatus;
  error: string | null;
  createdAt: number;
}

/** 新建会话入参 */
export interface CreateSessionInput {
  title?: string;
  groupId?: number | null;
  modelId?: number | null;
  agentProfileId?: number | null;
}

/** 左栏管理入口 key */
export type AgentManagerKey = 'skills' | 'mcp' | 'model' | 'agents';

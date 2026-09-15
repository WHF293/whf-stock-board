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
  createdAt: number;
  updatedAt: number;
}

/** MCP 传输方式（一期仅远端） */
export type McpTransport = 'streamable-http' | 'sse';

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

/** MCP 服务器（mcp_server 表） */
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

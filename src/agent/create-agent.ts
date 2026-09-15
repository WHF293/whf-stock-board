/**
 * Agent 运行时（方案 §5，M2 范围：单主 agent 无工具）
 *
 * - 模型统一 OpenAI 兼容协议（ChatOpenAI）；fetch 走 tauri-plugin-http
 *   （Rust 层直连，绕开 webview CORS），经 OpenAI SDK 的 configuration.fetch 注入；
 * - deepagents createDeepAgent 装配主 agent 与 subagent（task 工具派发，M4 全量启用）；
 * - 流式：LangGraph streamMode 'messages' 产出 token 级 chunk，
 *   文本增量交给 SmoothStreamer（由调用方驱动消费循环）。
 */
import { ChatOpenAI } from '@langchain/openai';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { createDeepAgent } from 'deepagents';
import type { SubAgent } from 'deepagents';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import type { ModelConfig, SubagentDef } from '@/types/agent.types';

/** openai SDK 允许注入自定义 fetch；tauri fetch 签名兼容（走 Rust 直连无 CORS） */
type CustomFetch = typeof globalThis.fetch;

/** 会话历史（已落库消息的轻量形态） */
export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** 一次 agent 运行的事件回调 */
export interface AgentRunHandlers {
  /** 文本增量（未平滑的原始速率，调用方负责缓冲） */
  onDelta: (text: string) => void;
  /**
   * 模型发起工具调用（工具卡「运行中」态的提前信号；实际执行结果由 MCP sink 回填）
   * @param event 工具调用事件
   * @param event.id 模型给出的调用 id（缺失时为 index 兜底 id）
   * @param event.name 工具名
   * @param event.argsText 累计入参文本（tool_call_chunks 分片归并结果）
   */
  onToolRequest?: (event: { id: string; name: string; argsText: string }) => void;
  /** 正常结束或被停止；full 为运行时累计的完整文本 */
  onDone: (full: string, stopped: boolean) => void;
  /** 运行出错 */
  onError: (message: string) => void;
}

/** 运行句柄（停止用） */
export interface AgentRunHandle {
  stop: () => void;
}

/**
 * model_config → ChatOpenAI 实例
 * @param model 模型配置
 * @returns ChatOpenAI 实例
 */
export function buildChatModel(model: ModelConfig): ChatOpenAI {
  return new ChatOpenAI({
    model: model.modelId,
    temperature: model.temperature ?? undefined,
    maxTokens: model.maxOutputTokens ?? undefined,
    configuration: {
      baseURL: model.baseUrl,
      apiKey: model.apiKey,
      fetch: tauriFetch as CustomFetch,
    },
  });
}

/**
 * subagent 定义 → deepagents SubAgent 规格
 * @param defs 用户定义的 subagent 列表（有序）
 * @param fallbackModel 主模型配置（子 agent 未指定独立模型时继承）
 * @returns deepagents subagent 数组
 */
function toSubAgents(defs: SubagentDef[], fallbackModel: ModelConfig): SubAgent[] {
  return defs.map((def) => ({
    name: def.name,
    description: def.description,
    systemPrompt: def.prompt || undefined,
    model:
      def.modelId !== null && def.modelId !== fallbackModel.id
        ? undefined // 独立模型在 M4 接 ModelRegistry 后生效；先统一继承主模型
        : undefined,
  }));
}

/** 运行入参 */
export interface StartAgentRunParams {
  model: ModelConfig;
  systemPrompt: string;
  /** 历史消息（不含本次提问） */
  history: HistoryMessage[];
  /** 本次用户输入 */
  message: string;
  /** 编排的 subagent 定义 */
  subagents: SubagentDef[];
  /** 工具集（内置 MCP 装配；空数组 / 缺省 = 无工具） */
  tools?: StructuredToolInterface[];
}

/**
 * 启动一次 agent 运行（流式）
 *
 * @param params 模型 / 提示词 / 历史 / 输入 / subagents
 * @param handlers 事件回调
 * @returns 运行句柄（AbortController 封装）
 */
export function startAgentRun(params: StartAgentRunParams, handlers: AgentRunHandlers): AgentRunHandle {
  const controller = new AbortController();
  const agent = createDeepAgent({
    model: buildChatModel(params.model),
    systemPrompt: params.systemPrompt,
    subagents: toSubAgents(params.subagents, params.model),
    tools: params.tools ?? [],
  });

  const messages: BaseMessage[] = [
    ...params.history.map((h) =>
      h.role === 'user' ? new HumanMessage({ content: h.content }) : new AIMessage({ content: h.content }),
    ),
    new HumanMessage({ content: params.message }),
  ];

  void (async () => {
    let full = '';
    /** 流式工具调用累计（按 chunk 的 index 归并 args 分片，name/id 出现在首个分片） */
    const pendingCalls = new Map<number, { id: string; name: string; argsText: string }>();
    try {
      const stream = await agent.stream(
        { messages },
        { streamMode: 'messages', signal: controller.signal },
      );
      for await (const item of stream) {
        // 'messages' 模式产出 [chunk, metadata] 元组
        const chunk = Array.isArray(item) ? item[0] : item;
        for (const call of extractToolRequests(chunk, pendingCalls)) {
          handlers.onToolRequest?.(call);
        }
        const text = extractAiText(chunk);
        if (text) {
          full += text;
          handlers.onDelta(text);
        }
      }
      handlers.onDone(full, false);
    } catch (error) {
      if (controller.signal.aborted) {
        handlers.onDone(full, true);
        return;
      }
      handlers.onError(error instanceof Error ? error.message : String(error));
    }
  })();

  return { stop: () => controller.abort() };
}

/**
 * 从 AI 消息块中提取工具调用（含分片 args 累计）
 *
 * LangChain 的 tool_call_chunks 是**增量**的：每个分片只带 args 的一小段，
 * name / id 通常只在首个分片出现 → 必须按 index 归并，否则拿到半截 JSON。
 * 这里只用于让卡片「提前出现」，权威结果由 MCP 运行时的事件 sink 回填。
 *
 * @param chunk 消息块
 * @param pending 累计表（跨 chunk 复用，按 index 归并）
 * @returns 本次新增/更新的调用列表
 */
function extractToolRequests(
  chunk: unknown,
  pending: Map<number, { id: string; name: string; argsText: string }>,
): Array<{ id: string; name: string; argsText: string }> {
  if (!chunk || typeof chunk !== 'object') return [];
  const message = chunk as {
    getType?: () => string;
    tool_call_chunks?: Array<{ id?: string | null; name?: string | null; args?: string | null; index?: number }>;
  };
  if (message.getType?.() !== 'ai' || !Array.isArray(message.tool_call_chunks)) return [];
  const updates: Array<{ id: string; name: string; argsText: string }> = [];
  for (const [position, piece] of message.tool_call_chunks.entries()) {
    const index = typeof piece.index === 'number' ? piece.index : position;
    const current = pending.get(index) ?? { id: '', name: '', argsText: '' };
    if (typeof piece.id === 'string' && piece.id) current.id = piece.id;
    if (typeof piece.name === 'string' && piece.name) current.name = piece.name;
    if (typeof piece.args === 'string') current.argsText += piece.args;
    pending.set(index, current);
    if (current.name) {
      updates.push({
        id: current.id || 'call-' + String(index),
        name: current.name,
        argsText: current.argsText,
      });
    }
  }
  return updates;
}

/**
 * 从 LangGraph messages 模式的 chunk 中提取 AI 文本
 * （过滤 ToolMessage 等非 AI 消息，避免工具结果混入正文）
 *
 * @param chunk 消息块
 * @returns 文本增量（无则空串）
 */
function extractAiText(chunk: unknown): string {
  if (!chunk || typeof chunk !== 'object') return '';
  const message = chunk as { getType?: () => string; content?: unknown };
  const type = message.getType?.();
  if (type !== undefined && type !== 'ai') return '';
  const content = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        const text = (part as { text?: unknown })?.text;
        return typeof text === 'string' ? text : '';
      })
      .join('');
  }
  return '';
}

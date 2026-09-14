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
  });

  const messages: BaseMessage[] = [
    ...params.history.map((h) =>
      h.role === 'user' ? new HumanMessage({ content: h.content }) : new AIMessage({ content: h.content }),
    ),
    new HumanMessage({ content: params.message }),
  ];

  void (async () => {
    let full = '';
    try {
      const stream = await agent.stream(
        { messages },
        { streamMode: 'messages', signal: controller.signal },
      );
      for await (const item of stream) {
        // 'messages' 模式产出 [chunk, metadata] 元组
        const chunk = Array.isArray(item) ? item[0] : item;
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

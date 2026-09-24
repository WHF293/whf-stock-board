/**
 * 定时任务执行器（Agent 分析 · 无 UI 的精简运行链路）
 *
 * 与 ChatPanel 的对话链路同构（历史窗口 → 消息落库 → sink 工具卡 →
 * buildRunContext 装配 → startAgentRun 流式运行），但三处刻意不同：
 *
 * 1. **落库为准，无实时 UI**：SmoothStreamer 只负责匀速缓冲，每 5s 把已生成
 *    内容 checkpoint 进库（防应用中途退出丢失整轮）；终态一次性覆写。
 * 2. **不提供停止**：定时任务没有「停止」按钮，stopped 只作为防御性终态处理。
 * 3. **结束后回写任务状态**：`markScheduleRun` 的 ok / error 供任务列表展示
 *    「上次执行」；触发时的 'running' 标记由调度方（stores/schedule.ts）先写。
 *
 * 工具卡与 UI 载荷守卫直接复用 ChatPanel 抽出的 utils，避免两条链路行为漂移。
 */
import type { StructuredToolInterface } from '@langchain/core/tools';
import { SmoothStreamer } from '@/agent/smooth-streamer';
import { startAgentRun, type HistoryMessage } from '@/agent/create-agent';
import { buildRunContext, type RunContext } from '@/agent/run-context';
import { getMcpRuntime } from '@/agent/mcp/registry';
import type { McpToolEventSink } from '@/agent/mcp/types';
import {
  listMessages,
  insertMessage,
  updateMessage,
  markScheduleRun,
  insertUsage,
} from '@/composables/use-agent-db';
import { resolveAgentSystemPrompt } from '@/utils/agent-prompt';
import { upsertToolPart } from '@/utils/upsert-tool-part';
import { guardUiPayload } from '@/utils/guard-ui-payload';
import { STREAM_TICK_MS } from '@/constants/agent.constants';
import { SCHEDULE_CHECKPOINT_MS, SCHEDULE_HISTORY_LIMIT } from '@/constants/schedule.constants';
import type {
  AgentProfile,
  MessageStatus,
  ModelConfig,
  Skill,
  SubagentDef,
  ToolCallPart,
} from '@/types/agent.types';

/** 执行入参（运行时由调用方解析好；会话存在性与模型可用性也由调用方先校验） */
export interface RunScheduleTaskParams {
  /** 任务 id（终态回写 last_run_status 用） */
  taskId: number;
  /** 绑定会话 id（执行结果都落这个会话） */
  sessionId: number;
  /** 到期发送给 agent 的消息 */
  prompt: string;
  /** 已解析的生效模型（调用方保证非空） */
  model: ModelConfig;
  /** 会话绑定的 Agent 配置（未绑定 = null，回落默认系统提示词） */
  profile: AgentProfile | null;
  /** 本次参与编排的子 agent（已按 profile.subagentIds 解析，可空） */
  subagents: readonly SubagentDef[];
  /** DB 里的用户 skill 列表（读盘装载用） */
  userSkills: readonly Skill[];
}

/**
 * 执行一次定时任务：在绑定会话内完整跑一轮 agent 对话，全程落库
 *
 * 准备阶段（取历史 / 插消息）失败会抛错，由调度方 catch 并标记任务 error；
 * 运行阶段的错误一律转为消息 error 状态 + 任务 'ok'/'error' 回写，不抛出。
 *
 * @param params 执行入参
 * @returns 本次执行结果（'ok' = 正常完成或中断；'error' = 运行报错）
 */
export async function runScheduleTask(params: RunScheduleTaskParams): Promise<'ok' | 'error'> {
  const { sessionId, prompt, model, profile, subagents, userSkills } = params;

  // --- 历史窗口：先于本次消息插入读取，天然不含本次问句 ---
  const prior = await listMessages(sessionId);
  const history: HistoryMessage[] = prior
    .filter((m) => m.status === 'done' || m.status === 'stopped')
    .slice(-SCHEDULE_HISTORY_LIMIT)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

  // --- 消息落库：用户消息 + 助手占位（先落库拿真实 id，崩溃也不丢轮次） ---
  await insertMessage({ sessionId, role: 'user', content: prompt });
  const assistantId = await insertMessage({
    sessionId,
    role: 'assistant',
    content: '',
    status: 'running',
  });

  // --- 无 UI 消费：匀速缓冲累积到本地，checkpoint 周期落库 ---
  let streamedText = '';
  const streamer = new SmoothStreamer((out) => {
    streamedText += out;
  });

  // --- 工具卡数据源（onStart 提前插卡 / onEnd 按 callId 回填终态，与 ChatPanel 一致） ---
  const parts: ToolCallPart[] = [];
  const sink: McpToolEventSink = {
    onStart: (event) => {
      upsertToolPart(parts, {
        callId: event.id,
        toolName: event.toolName,
        serverKey: event.serverKey,
        argsText: event.argsText,
        state: 'running',
      });
    },
    onEnd: (event) => {
      const existing = parts.find((part) => part.callId === event.id);
      upsertToolPart(parts, {
        callId: event.id,
        // 结束事件不带工具名，沿用卡片上已有的名字
        toolName: existing?.toolName ?? 'tool',
        state: event.state,
        resultText: event.resultText,
        durationMs: event.durationMs,
        ...(event.ui
          ? { ui: { resourceUri: event.ui.resourceUri, payload: guardUiPayload(event.ui.payload) ?? {} } }
          : {}),
      });
    },
  };

  // --- 资源装配：失败不阻断任务，退化「无工具、无 skill」（与 ChatPanel 同策略） ---
  let runContext: RunContext = {
    tools: [],
    subagentTools: new Map<number, StructuredToolInterface[]>(),
    subagents: [...subagents],
    skills: [],
    skillPathByName: new Map<string, string>(),
    skillFiles: {},
  };
  try {
    const runtime = await getMcpRuntime();
    runContext = await buildRunContext({ runtime, sink, subagents, userSkills });
  } catch (error) {
    console.warn(
      '[schedule] 运行上下文装配失败，本次无工具与 skill：' +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  return await new Promise<'ok' | 'error'>((resolve) => {
    /** 运行时累计的完整文本（onDone 给出；优先于本地缓冲） */
    let finalText: string | null = null;
    let stopped = false;
    let errorMessage: string | null = null;
    /** onDone / onError 是否已触发（之后只等 backlog 排空） */
    let done = false;
    let tickTimer: number | null = null;

    /** 运行中途把已生成内容写库（应用中途退出时至少不丢已生成部分） */
    const checkpoint = (): void => {
      void updateMessage(assistantId, { content: streamedText, parts, status: 'running' }).catch(
        () => undefined,
      );
    };

    /** 流结束（backlog 排空）后的终态收尾：挂卡收口 → 消息终态 → 任务状态回写 */
    const finish = (): void => {
      if (tickTimer !== null) {
        clearInterval(tickTimer);
        tickTimer = null;
      }
      streamer.flush();
      const status: MessageStatus = errorMessage ? 'error' : stopped ? 'stopped' : 'done';
      // 中断 / 出错时收尾悬挂的工具卡，避免留下「运行中」假状态
      if (status !== 'done') {
        for (const part of parts) {
          if (part.type === 'tool_call' && part.state === 'running') {
            part.state = 'error';
            part.resultText = errorMessage ?? '已停止';
          }
        }
      }
      const content = finalText ?? streamedText;
      void (async () => {
        try {
          await updateMessage(assistantId, { content, parts, status, error: errorMessage });
          await markScheduleRun(params.taskId, status === 'error' ? 'error' : 'ok');
        } catch (error) {
          console.warn('[schedule] 终态落库失败：', error);
        }
        resolve(status === 'error' ? 'error' : 'ok');
      })();
    };

    /** 运行起点（用量记录的 durationMs 口径） */
    const startedAt = Date.now();

    startAgentRun(
      {
        model,
        // 专业模式唯一：自定义提示词强制追加金融边界（与 ChatPanel 同口径）
        systemPrompt: resolveAgentSystemPrompt(profile?.systemPrompt),
        history,
        message: prompt,
        subagents: runContext.subagents,
        tools: runContext.tools,
        subagentTools: runContext.subagentTools,
        skills: runContext.skills,
        skillPathByName: runContext.skillPathByName,
        skillFiles: runContext.skillFiles,
      },
      {
        onDelta: (delta) => streamer.push(delta),
        // 尽力采集的用量落库（模型不回 usage 不触发；失败静默，不影响任务状态）
        onUsage: (usage) => {
          void insertUsage({
            sessionId,
            modelName: model.name,
            modelId: model.modelId,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            durationMs: Date.now() - startedAt,
          }).catch(() => undefined);
        },
        onToolRequest: (event) =>
          upsertToolPart(parts, {
            callId: event.id,
            toolName: event.name,
            argsText: event.argsText,
            state: 'running',
          }),
        onDone: (full, wasStopped) => {
          finalText = full;
          stopped = wasStopped;
          done = true;
          streamer.end();
        },
        onError: (message) => {
          // 带上实际请求的模型，模型配置改动没生效时可直接从任务状态看出来
          errorMessage = `${message}（请求模型：${model.modelId}）`;
          done = true;
          streamer.end();
        },
      },
    );

    // 消费循环：匀速取出 + 运行期间周期 checkpoint；tick 返回 false = 流已结束且排空
    let lastCheckpoint = Date.now();
    tickTimer = window.setInterval(() => {
      const alive = streamer.tick();
      if (!done && Date.now() - lastCheckpoint >= SCHEDULE_CHECKPOINT_MS) {
        lastCheckpoint = Date.now();
        checkpoint();
      }
      if (!alive) finish();
    }, STREAM_TICK_MS);
  });
}

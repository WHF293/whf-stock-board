<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { useAgentStore } from '@/stores/agent';
import {
  WELCOME_SCENES,
  QUICK_PROMPTS,
  CHAT_INPUT_MIN_ROWS,
  CHAT_INPUT_MAX_ROWS,
  SESSION_DEFAULT_TITLE,
} from '@/constants/agent.constants';
import { listMessages, insertMessage, updateMessage } from '@/composables/use-agent-db';
import { resolveAgentSystemPrompt } from '@/utils/agent-prompt';
import { SmoothStreamer } from '@/agent/smooth-streamer';
import { startAgentRun, type AgentRunHandle, type HistoryMessage } from '@/agent/create-agent';
import { buildRunContext, type RunContext } from '@/agent/run-context';
import { getMcpRuntime } from '@/agent/mcp/registry';
import { resolveInputHeight } from '@/utils/chat-input-height';
import { upsertToolPart } from '@/utils/upsert-tool-part';
import { guardUiPayload } from '@/utils/guard-ui-payload';
import type { ChatMessage, MessageStatus, SubagentDef, ToolCallPart } from '@/types/agent.types';
import type { AgentManagerKey } from '@/types/agent.types';
import MenuIcon from '@/components/ui/MenuIcon.vue';
import ToolCallCard from './ToolCallCard.vue';

/**
 * Agent 聊天区（方案 §6.2 / §5.3.1）
 *
 * - 无消息 → 欢迎态（问候 + 场景 chips + 胶囊输入框）；有消息 → 消息流；
 * - 发送：未建会话先建会话；用户消息与助手消息均落库；
 * - 流式：运行时增量进 SmoothStreamer，统一消费循环（~30ms）匀速渲染打字机；
 * - 思考中：消息 running 且尚无可见文本 → spinner + 耗时；停止按钮可中断。
 */
const store = useAgentStore();

const emit = defineEmits<{
  /** 请求打开管理弹窗（模型徽标点击等） */
  (e: 'open-manager', key: AgentManagerKey): void;
}>();

/* --------------------------------- 消息缓存 -------------------------------- */

/** 每会话消息缓存（按需从 DB 加载；运行中实时更新） */
const messagesBySession = reactive<Record<number, ChatMessage[]>>({});

/** 当前会话消息列表 */
const messages = computed<ChatMessage[]>(
  () => messagesBySession[store.currentSessionId ?? -1] ?? [],
);

/**
 * 加载会话消息（缓存命中跳过）
 * @param sessionId 会话 id
 */
const loadMessages = async (sessionId: number): Promise<void> => {
  if (messagesBySession[sessionId]) return;
  messagesBySession[sessionId] = await listMessages(sessionId);
};

/**
 * 强制重读某会话消息（缓存失效重建）
 *
 * 旁路写入方（定时任务执行器在任务会话里落库）完成后的刷新入口：
 * 缓存命中守卫会让常规切换读不到新消息，宿主跳转任务会话时必须显式调它。
 *
 * @param sessionId 会话 id
 */
const reloadSession = async (sessionId: number): Promise<void> => {
  delete messagesBySession[sessionId];
  await loadMessages(sessionId);
};

defineExpose({ reloadSession });

watch(
  () => store.currentSessionId,
  (id) => {
    if (id !== null) void loadMessages(id);
  },
  { immediate: true },
);

/* --------------------------------- 输入与发送 ------------------------------- */

const draft = ref('');
const inputRef = ref<HTMLTextAreaElement | null>(null);
const scrollRef = ref<HTMLElement | null>(null);

/** 发送前置提示（未配置模型等） */
const sendHint = ref('');

/** 当前会话绑定的 Agent 配置（store 计算属性为唯一事实源） */
const currentProfile = computed(() => store.activeProfile);

/**
 * 当前生效模型：会话绑定 > Agent 配置 > 默认模型（同 store.effectiveModel）
 *
 * ⚠️ 与「模型管理」里的默认模型不是一回事：绑定了模型时默认模型不生效，
 * 所以请求用的模型必须由 store 统一给出，避免两处口径不一致。
 */
const currentModel = computed(() => store.effectiveModel);

/**
 * 当前 Agent 配置是否自定义了系统提示词
 *
 * 有值时内置提示词会被整体替换，金融边界只剩「自动追加 STOCK_ONLY_GUARD」这一层兜底，
 * UI 必须显式说明，否则用户会以为自定义提示词绕过了专业模式约束。
 */
const hasCustomPrompt = computed(() => Boolean(currentProfile.value?.systemPrompt?.trim()));

/**
 * 输入框高度自适应：2~5 行之间随内容长高，超出后框内滚动
 *
 * 单行 textarea 不会自动长高（原生行为是出滚动条），需要在每次内容变化后
 * 先归零测 scrollHeight，再夹到 [min, max]，并按是否溢出切换 overflow。
 */
const syncInputHeight = (): void => {
  const el = inputRef.value;
  if (!el) return;
  const lineHeight = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
  el.style.height = 'auto';
  const { height, scrollable } = resolveInputHeight({
    lineHeight,
    contentHeight: el.scrollHeight,
    minRows: CHAT_INPUT_MIN_ROWS,
    maxRows: CHAT_INPUT_MAX_ROWS,
  });
  el.style.height = `${height}px`;
  el.style.overflowY = scrollable ? 'auto' : 'hidden';
};

watch(draft, () => void nextTick(syncInputHeight));
onMounted(() => syncInputHeight());

/**
 * 场景 chips 预填
 * @param prompt
 */
const prefill = (prompt: string): void => {
  draft.value = prompt;
  inputRef.value?.focus();
};

/** 问候语（按小时段） */
const greeting = computed(() => {
  const hour = new Date().getHours();
  if (hour < 6) return '夜深了';
  if (hour < 12) return '早上好';
  if (hour < 18) return '下午好';
  return '晚上好';
});

/* --------------------------------- 工具卡 -------------------------------- */

/**
 * 取消息里的工具卡块（消息 parts 中 type=tool_call 的部分）
 * @param msg 消息
 * @returns 工具卡列表（按发生顺序）
 */
const toolCards = (msg: ChatMessage): ToolCallPart[] =>
  (msg.parts ?? []).filter((part): part is ToolCallPart => part.type === 'tool_call');

/**
 * 工具卡 upsert（流式提前信号与运行时事件共用，按 callId 配对）→ 见 utils/upsert-tool-part.ts
 * UI 载荷体积守卫（超限丢弃、卡片退化纯文本）→ 见 utils/guard-ui-payload.ts
 * 两份实现抽到 utils：对话流与定时任务执行链路（schedule-runner）共用，避免行为漂移。
 */

/* --------------------------------- 运行注册表 ------------------------------- */

/** 活跃运行（M2 单运行；M3 RunRegistry 扩展为多会话并行） */
interface ActiveRun {
  sessionId: number;
  messageId: number;
  streamer: SmoothStreamer;
  handle: AgentRunHandle;
  startedAt: number;
  /** 流结束后的终态（等 backlog 排空后落库） */
  finalText: string | null;
  stopped: boolean;
  error: string | null;
}

const activeRuns = ref<ActiveRun[]>([]);
/** 是否有运行中（当前会话） */
const isRunning = computed(() =>
  activeRuns.value.some((r) => r.sessionId === store.currentSessionId),
);
/** 思考耗时秒（ticker 每帧刷新驱动模板更新） */
const elapsedSeconds = ref(0);

/** 统一消费循环：所有活跃 run 的平滑缓冲共用一个 tick */
let ticker: ReturnType<typeof setInterval> | null = null;

onMounted(() => {
  ticker = setInterval(() => {
    elapsedSeconds.value = Math.floor(Date.now() / 1000);
    for (const run of [...activeRuns.value]) {
      const alive = run.streamer.tick();
      autoscroll();
      if (!alive) finalizeRun(run);
    }
  }, 30);
});

onBeforeUnmount(() => {
  if (ticker !== null) clearInterval(ticker);
});

/**
 * 终态落库（backlog 排空后由 ticker 调用）
 * @param run 活跃运行
 */
const finalizeRun = (run: ActiveRun): void => {
  run.streamer.flush();
  const list = messagesBySession[run.sessionId];
  const msg = list?.find((m) => m.id === run.messageId);
  const status: MessageStatus = run.error ? 'error' : run.stopped ? 'stopped' : 'done';
  if (msg) {
    msg.status = status;
    if (run.error) msg.error = run.error;
    // 中断 / 出错时收尾悬挂的工具卡，避免留下「运行中」假状态（重新打开会话会一直转）
    if (status !== 'done') {
      for (const part of msg.parts ?? []) {
        if (part.type === 'tool_call' && part.state === 'running') {
          part.state = 'error';
          part.resultText = run.error ?? '已停止';
        }
      }
    }
    // 保证显示内容与落库一致（flush 已全量吐出）
  }
  void updateMessage(run.messageId, {
    content: msg?.content ?? '',
    status,
    error: run.error,
    parts: msg?.parts ?? null,
  });
  activeRuns.value = activeRuns.value.filter((r) => r !== run);
};

/**
 * 发送消息
 */
const send = async (): Promise<void> => {
  const text = draft.value.trim();
  if (!text || isRunning.value) return;

  if (!currentModel.value) {
    sendHint.value = '尚未配置模型：请先在 Model 管理中添加并设为默认';
    emit('open-manager', 'model');
    return;
  }
  sendHint.value = '';

  // 未建会话先建
  let sessionId = store.currentSessionId;
  if (sessionId === null) {
    sessionId = await store.newSession(null);
    messagesBySession[sessionId] = [];
  }
  const list = messagesBySession[sessionId] ?? [];
  messagesBySession[sessionId] = list;

  // 用户消息落库 + 上屏
  const userContent = text;
  draft.value = '';
  const userMsg: ChatMessage = {
    id: await insertMessage({ sessionId, role: 'user', content: userContent }),
    sessionId,
    role: 'user',
    content: userContent,
    parts: null,
    status: 'done',
    error: null,
    createdAt: Date.now(),
  };
  list.push(userMsg);

  // 首条问句自动命名：标题仍是默认「新对话」时，取前 6 个字符
  if (
    list.filter((m) => m.role === 'user').length === 1 &&
    store.sessions.find((s) => s.id === sessionId)?.title === SESSION_DEFAULT_TITLE
  ) {
    void store.renameSession(sessionId, text.slice(0, 6));
  }

  // 助手消息占位（先落库拿真实 id，崩溃也不丢轮次）
  const assistantMsg: ChatMessage = {
    id: await insertMessage({ sessionId, role: 'assistant', content: '', status: 'running' }),
    sessionId,
    role: 'assistant',
    content: '',
    parts: [],
    status: 'running',
    error: null,
    createdAt: Date.now(),
  };
  list.push(assistantMsg);
  autoscroll();

  // 历史窗口（最近 30 条已完成消息，排除本次）
  const history: HistoryMessage[] = list
    .filter((m) => m.id !== assistantMsg.id && (m.status === 'done' || m.status === 'stopped'))
    .slice(-30)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }));

  const model = currentModel.value;
  const profile = currentProfile.value;
  const streamer = new SmoothStreamer((out) => {
    assistantMsg.content += out;
  });

  // 工具卡数据源：MCP 运行时事件（确定性）与流式提前信号（体验）共同写入消息 parts
  const parts: ToolCallPart[] = [];
  assistantMsg.parts = parts;
  const sink = {
    onStart: (event: {
      id: string;
      serverKey: string;
      toolName: string;
      argsText: string;
    }): void => {
      upsertToolPart(parts, {
        callId: event.id,
        toolName: event.toolName,
        serverKey: event.serverKey,
        argsText: event.argsText,
        state: 'running',
      });
    },
    onEnd: (event: {
      id: string;
      state: 'success' | 'error';
      resultText: string;
      durationMs: number;
      ui?: { resourceUri: string; payload: Record<string, unknown> };
    }): void => {
      const existing = parts.find((part) => part.callId === event.id);
      upsertToolPart(parts, {
        callId: event.id,
        // 事件里没带工具名（结束事件）时沿用卡片上已有的名字
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

  // 本次参与编排的子 agent（profile.subagentIds 有序；内置 + 用户，失效 id 容错忽略）
  const subagents = (profile?.subagentIds ?? [])
    .map((id) => store.subagents.find((s) => s.id === id))
    .filter((s): s is SubagentDef => s !== undefined);

  // 资源装配：授权（resource_scope × resource_grant）× MCP 工具分组 × skill 虚拟文件
  // 装配失败不阻断对话：退化为「无工具、无 skill」比整个会话报错更有用
  let runContext: RunContext = {
    tools: [],
    subagentTools: new Map<number, StructuredToolInterface[]>(),
    subagents,
    skills: [],
    skillPathByName: new Map<string, string>(),
    skillFiles: {},
  };
  try {
    const runtime = await getMcpRuntime();
    runContext = await buildRunContext({ runtime, sink, subagents, userSkills: store.skills });
  } catch (error) {
    console.warn(
      '[agent] 运行上下文装配失败，本次无工具与 skill：' +
        (error instanceof Error ? error.message : String(error)),
    );
  }

  const run: ActiveRun = {
    sessionId,
    messageId: assistantMsg.id,
    streamer,
    handle: startAgentRun(
      {
        model,
        // 专业模式是唯一模式：Agent 配置自定义了提示词时强制追加金融边界，
        // 不允许自定义提示词把「仅金融」这条约束顶掉（详见 utils/agent-prompt.ts）
        systemPrompt: resolveAgentSystemPrompt(profile?.systemPrompt),
        history,
        message: userContent,
        subagents: runContext.subagents,
        // 主 agent 工具 + 子 agent 工具子集 + skill 声明（均由授权收敛，见 agent/run-context.ts）
        tools: runContext.tools,
        subagentTools: runContext.subagentTools,
        skills: runContext.skills,
        skillPathByName: runContext.skillPathByName,
        skillFiles: runContext.skillFiles,
      },
      {
        onDelta: (delta) => streamer.push(delta),
        // 模型刚发起调用即插卡（结果由 sink 回填），避免长工具链「静默等待」
        onToolRequest: (event) =>
          upsertToolPart(parts, {
            callId: event.id,
            toolName: event.name,
            argsText: event.argsText,
            state: 'running',
          }),
        onDone: (full, stopped) => {
          run.finalText = full;
          run.stopped = stopped;
          streamer.end();
        },
        onError: (message) => {
          // 带上本次实际请求的模型：模型名写错、或配置改动没生效时，
          // 用户能直接从报错里看出「请求用的到底是哪个 model」
          run.error = `${message}（请求模型：${model.modelId}）`;
          streamer.end();
        },
      },
    ),
    startedAt: Date.now(),
    finalText: null,
    stopped: false,
    error: null,
  };
  activeRuns.value.push(run);
};

/**
 * 停止当前会话运行
 */
const stop = (): void => {
  for (const run of activeRuns.value) {
    if (run.sessionId === store.currentSessionId) run.handle.stop();
  }
};

/**
 * 一键追问 Agent：把一段文本交给对话流
 *
 * 空闲直接发送；运行中只预填（不打断当前运行）。快捷分析按钮与 MCP App 的
 * `ui/message` 追问共用此语义。
 *
 * @param text 追问文本（前后空白会被裁掉，纯空白忽略）
 */
const askAgent = (text: string): void => {
  const content = text.trim();
  if (!content) return;
  draft.value = content;
  if (isRunning.value) {
    void nextTick(() => inputRef.value?.focus());
    return;
  }
  void send();
};

/**
 * MCP App 的 `ui/message`：把 App 里点出来的追问交给 Agent（见 askAgent）
 *
 * @param text App 发起的追问文本
 */
const onAppAsk = (text: string): void => {
  askAgent(text);
};

/* --------------------------------- 滚动与渲染 ------------------------------- */

/** 用户是否贴底（自动跟随滚动） */
const pinnedToBottom = ref(true);

/**
 * 贴底时跟随滚动（tick / 消息变化时调用）
 */
const autoscroll = (): void => {
  const el = scrollRef.value;
  if (!el || !pinnedToBottom.value) return;
  el.scrollTop = el.scrollHeight;
};

/**
 * 滚动事件：判定是否贴底
 */
const onScroll = (): void => {
  const el = scrollRef.value;
  if (!el) return;
  pinnedToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
};

watch(
  () => [store.currentSessionId, messages.value.length],
  () => {
    pinnedToBottom.value = true;
    void nextTick(autoscroll);
  },
);

watch(elapsedSeconds, () => autoscroll());

/** 欢迎态：无会话或会话尚无消息 */
const showWelcome = computed(() => messages.value.length === 0);
</script>

<template>
  <div class="flex h-full min-w-0 flex-1 flex-col bg-flat-weak">
    <!-- 顶部：侧栏开关 + 模型徽标 + 运行状态（不放标题文案，标题见左侧栏 / 欢迎页） -->
    <header class="flex h-12 shrink-0 items-center gap-3 bg-surface px-4">
      <button
        type="button"
        class="pressable shrink-0 rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-flat-weak hover:text-text"
        :aria-label="store.sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        @click="store.sidebarCollapsed = !store.sidebarCollapsed"
      >
        <MenuIcon name="panelLeft" :size="16" />
      </button>
      <div class="min-w-0 flex-1" />
      <button
        type="button"
        class="flex max-w-[18rem] items-center gap-1.5 rounded-full border border-flat-weak px-2.5 py-1 text-xs text-text-secondary transition-colors hover:border-primary hover:text-primary"
        :title="
          currentModel
            ? `请求参数 model：${currentModel.modelId}\n接口地址：${currentModel.baseUrl}`
            : '未配置模型'
        "
        @click="emit('open-manager', 'model')"
      >
        <MenuIcon name="cpu" :size="13" class="shrink-0" />
        <span class="truncate">{{ currentModel ? currentModel.name : '未配置模型' }}</span>
        <span v-if="currentModel" class="shrink-0 text-text-tertiary">{{ currentModel.modelId }}</span>
      </button>
      <span
        class="h-2 w-2 rounded-full"
        :class="isRunning ? 'animate-pulse bg-primary' : 'bg-flat-weak'"
        :aria-label="isRunning ? '运行中' : '空闲'"
      />
    </header>

    <!-- 消息流 / 欢迎态 -->
    <div ref="scrollRef" class="min-h-0 flex-1 overflow-y-auto" @scroll="onScroll">
      <!-- 欢迎态 -->
      <div
        v-if="showWelcome"
        class="flex min-h-full flex-col items-center justify-center px-6 py-10"
      >
        <h1 class="text-2xl font-semibold text-text">{{ greeting }}，我是你的分析 Agent</h1>
        <p class="mt-2 text-sm text-text-tertiary">
          {{
            store.models.length === 0
              ? '先在左侧 Model 中添加模型，即可开始对话'
              : '输入问题开始对话，@ 可引用 Agent 配置'
          }}
        </p>
        <div class="mt-8 flex flex-wrap justify-center gap-2">
          <button
            v-for="scene in WELCOME_SCENES"
            :key="scene.label"
            type="button"
            class="rounded-full border border-flat-weak bg-surface px-3.5 py-1.5 text-sm text-text-secondary transition-colors hover:border-primary hover:text-primary"
            @click="prefill(scene.prompt)"
          >
            {{ scene.label }}
          </button>
        </div>
      </div>

      <!-- 消息列表 -->
      <div v-else class="mx-auto max-w-3xl space-y-4 px-6 py-6">
        <div v-for="msg in messages" :key="msg.id">
          <!-- 用户消息：右侧气泡 -->
          <div v-if="msg.role === 'user'" class="flex justify-end">
            <div class="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-on-primary">
              <p class="whitespace-pre-wrap break-words">{{ msg.content }}</p>
            </div>
          </div>

          <!-- 助手消息：通栏 -->
          <div v-else class="rounded-2xl bg-surface px-4 py-3">
            <!-- 工具调用卡（含 MCP Apps 沙箱渲染位），在正文上方按发生顺序排列 -->
            <div v-if="toolCards(msg).length > 0" class="mb-3 space-y-2">
              <p class="text-[11px] text-text-tertiary">工具调用 {{ toolCards(msg).length }} 次</p>
              <ToolCallCard
                v-for="card in toolCards(msg)"
                :key="card.callId"
                :part="card"
                @ask="onAppAsk"
              />
            </div>
            <!-- 思考中（尚无可见文本且无工具卡） -->
            <div
              v-if="msg.status === 'running' && !msg.content && toolCards(msg).length === 0"
              class="flex items-center gap-2 text-sm text-text-tertiary"
            >
              <span class="flex gap-1">
                <span class="thinking-dot" />
                <span class="thinking-dot [animation-delay:0.2s]" />
                <span class="thinking-dot [animation-delay:0.4s]" />
              </span>
              思考中 {{ elapsedSeconds }}s
            </div>
            <p
              v-else
              class="whitespace-pre-wrap break-words text-sm leading-6 text-text"
            >
              {{ msg.content }}<span v-if="msg.status === 'running'" class="cursor-blink" />
            </p>
            <!-- 错误卡 -->
            <div
              v-if="msg.status === 'error'"
              class="mt-2 rounded-lg bg-up-weak px-3 py-2 text-xs text-up"
            >
              运行出错：{{ msg.error ?? '未知错误' }}
            </div>
            <p v-if="msg.status === 'stopped'" class="mt-1.5 text-xs text-text-tertiary">
              已停止
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- 发送前置提示 -->
    <div v-if="sendHint" class="mx-auto w-full max-w-3xl px-6">
      <p class="rounded-lg bg-primary-weak px-3 py-2 text-xs text-primary" role="alert">
        {{ sendHint }}
      </p>
    </div>

    <!-- 专业模式说明：仅当 Agent 配置自带提示词时提示金融边界由代码兜底 -->
    <div v-if="hasCustomPrompt" class="mx-auto w-full max-w-3xl shrink-0 px-6">
      <span class="block truncate text-xs text-text-tertiary">
        当前配置「{{ currentProfile?.name }}」自带提示词，已自动叠加金融领域边界（仅回答金融 / 股票相关问题）
      </span>
    </div>

    <!-- 快捷分析按钮：一键发送（agent 运行中点击则填入输入框，不打断当前回答） -->
    <div v-if="!showWelcome" class="mx-auto w-full max-w-3xl shrink-0 px-6 pt-1">
      <div class="flex flex-wrap gap-1.5">
        <button
          v-for="quick in QUICK_PROMPTS"
          :key="quick.label"
          type="button"
          class="rounded-full border border-flat-weak bg-surface px-3 py-1 text-xs text-text-secondary transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!currentModel"
          @click="askAgent(quick.prompt)"
        >
          {{ quick.label }}
        </button>
      </div>
    </div>

    <!-- 输入区（胶囊，悬浮于底部） -->
    <div class="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4 pt-2">
      <div
        class="flex items-end gap-2 rounded-3xl border border-flat-weak bg-surface px-4 py-3 shadow-sm transition-colors focus-within:border-primary"
      >
        <textarea
          ref="inputRef"
          v-model="draft"
          :rows="CHAT_INPUT_MIN_ROWS"
          class="flex-1 resize-none bg-transparent text-sm leading-5 text-text outline-none placeholder:text-text-tertiary"
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          @keydown.enter.exact.prevent="void send()"
          @input="syncInputHeight"
        />
        <!-- 运行中 → 停止按钮；否则发送 -->
        <button
          v-if="isRunning"
          type="button"
          class="rounded-full bg-flat-weak p-2 text-text transition-opacity hover:opacity-80"
          aria-label="停止"
          @click="stop"
        >
          <span class="block h-3 w-3 rounded-[2px] bg-current" />
        </button>
        <button
          v-else
          type="button"
          class="rounded-full bg-primary p-2 text-on-primary transition-opacity disabled:opacity-40"
          :disabled="!draft.trim()"
          aria-label="发送"
          @click="void send()"
        >
          <MenuIcon name="chevronRight" :size="16" />
        </button>
      </div>
      <div class="mt-1.5 text-center text-xs text-text-tertiary">
        {{
          currentProfile
            ? `当前 Agent 配置：${currentProfile.name}`
            : '内容仅保存在本机 SQLite'
        }}
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 思考中三点动画 */
.thinking-dot {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 9999px;
  background: currentColor;
  animation: thinking-bounce 1.2s ease-in-out infinite;
}
@keyframes thinking-bounce {
  0%,
  60%,
  100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-3px);
    opacity: 1;
  }
}

/* 流式尾部光标 */
.cursor-blink {
  display: inline-block;
  width: 2px;
  height: 1em;
  margin-left: 2px;
  vertical-align: text-bottom;
  background: var(--color-primary);
  animation: cursor-blink 0.9s step-end infinite;
}
@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0;
  }
}
</style>

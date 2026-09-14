<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue';
import { useAgentStore } from '@/stores/agent';
import { WELCOME_SCENES, DEFAULT_AGENT_SYSTEM_PROMPT } from '@/constants/agent.constants';
import { listMessages, insertMessage, updateMessage } from '@/composables/use-agent-db';
import { SmoothStreamer } from '@/agent/smooth-streamer';
import { startAgentRun, type AgentRunHandle, type HistoryMessage } from '@/agent/create-agent';
import type { ChatMessage, MessageStatus } from '@/types/agent.types';
import type { AgentManagerKey } from '@/types/agent.types';
import MenuIcon from '@/components/ui/MenuIcon.vue';

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

/** 当前会话绑定的 Agent 配置 */
const currentProfile = computed(() => {
  const pid = store.activeSession?.agentProfileId;
  return pid ? (store.profiles.find((p) => p.id === pid) ?? null) : null;
});

/** 当前生效模型：会话 > profile > 全局默认 */
const currentModel = computed(() => {
  const session = store.activeSession;
  const modelId = session?.modelId ?? currentProfile.value?.modelId ?? null;
  return store.models.find((m) => m.id === modelId) ?? store.defaultModel;
});

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
    // 保证显示内容与落库一致（flush 已全量吐出）
  }
  void updateMessage(run.messageId, {
    content: msg?.content ?? '',
    status,
    error: run.error,
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

  // 助手消息占位（先落库拿真实 id，崩溃也不丢轮次）
  const assistantMsg: ChatMessage = {
    id: await insertMessage({ sessionId, role: 'assistant', content: '', status: 'running' }),
    sessionId,
    role: 'assistant',
    content: '',
    parts: null,
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

  const run: ActiveRun = {
    sessionId,
    messageId: assistantMsg.id,
    streamer,
    handle: startAgentRun(
      {
        model,
        systemPrompt: profile?.systemPrompt ?? DEFAULT_AGENT_SYSTEM_PROMPT,
        history,
        message: userContent,
        subagents: (profile?.subagentIds ?? [])
          .map((id) => store.subagents.find((s) => s.id === id))
          .filter((s) => s !== undefined),
      },
      {
        onDelta: (delta) => streamer.push(delta),
        onDone: (full, stopped) => {
          run.finalText = full;
          run.stopped = stopped;
          streamer.end();
        },
        onError: (message) => {
          run.error = message;
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
    <!-- 顶部：标题 + 模型徽标 + 运行状态 -->
    <header class="flex h-12 shrink-0 items-center gap-3 bg-surface px-4">
      <h2 class="min-w-0 flex-1 truncate text-sm font-medium text-text">
        {{ store.activeSession?.title ?? 'Agent 分析' }}
      </h2>
      <button
        type="button"
        class="flex items-center gap-1.5 rounded-full border border-flat-weak px-2.5 py-1 text-xs text-text-secondary transition-colors hover:border-primary hover:text-primary"
        @click="emit('open-manager', 'model')"
      >
        <MenuIcon name="cpu" :size="13" />
        {{ currentModel ? currentModel.name : '未配置模型' }}
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
            <div class="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-white">
              <p class="whitespace-pre-wrap break-words">{{ msg.content }}</p>
            </div>
          </div>

          <!-- 助手消息：通栏 -->
          <div v-else class="rounded-2xl bg-surface px-4 py-3">
            <!-- 思考中（尚无可见文本） -->
            <div
              v-if="msg.status === 'running' && !msg.content"
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

    <!-- 输入区（胶囊，悬浮于底部） -->
    <div class="mx-auto w-full max-w-3xl shrink-0 px-6 pb-4 pt-2">
      <div
        class="flex items-end gap-2 rounded-3xl border border-flat-weak bg-surface px-4 py-3 shadow-sm transition-colors focus-within:border-primary"
      >
        <textarea
          ref="inputRef"
          v-model="draft"
          rows="1"
          class="max-h-40 min-h-6 flex-1 resize-none bg-transparent text-sm text-text outline-none placeholder:text-text-tertiary"
          placeholder="输入问题，Enter 发送，Shift+Enter 换行"
          @keydown.enter.exact.prevent="void send()"
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
          class="rounded-full bg-primary p-2 text-white transition-opacity disabled:opacity-40"
          :disabled="!draft.trim()"
          aria-label="发送"
          @click="void send()"
        >
          <MenuIcon name="chevronRight" :size="16" />
        </button>
      </div>
      <p class="mt-1.5 text-center text-xs text-text-tertiary">
        {{
          currentProfile
            ? `当前 Agent 配置：${currentProfile.name}`
            : '内容仅保存在本机 SQLite'
        }}
      </p>
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

<script setup lang="ts">
/**
 * 工具调用卡（消息 parts 里的 tool_call 块渲染）
 *
 * 两种形态：
 * - 常规工具：折叠式「入参 / 结果」文本卡（参数与结果各自可展开，避免刷屏）；
 * - MCP Apps 工具：结果声明了 `_meta.ui.resourceUri` 时，卡片体承载沙箱 iframe
 *   （见 McpAppHost），并在其下保留「原始结果」折叠区，便于核对 UI 与数据是否一致。
 *
 * 与消息文本的关系：卡片渲染在正文上方，正文保持模型的口语化结论；
 * 卡片内的数据来自 `structuredContent`（**不进模型上下文**），因此模型看不到
 * 渲染细节、也不会把整张表抄进回复。
 */
import { computed, ref } from 'vue';
import McpAppHost from './McpAppHost.vue';
import MenuIcon from '@/components/ui/MenuIcon.vue';
import type { ToolCallPart } from '@/types/agent.types';

const props = defineProps<{
  /** 工具调用块 */
  part: ToolCallPart;
}>();

const emit = defineEmits<{
  /** MCP App 请求继续追问（透传给 ChatPanel） */
  (e: 'ask', text: string): void;
}>();

const argsOpen = ref(false);
const resultOpen = ref(false);

/** 状态文案 */
const STATE_TEXT = {
  running: '运行中',
  success: '完成',
  error: '失败',
} as const;

/** 状态点颜色（primary 跟随主题；错误用 down 语义色） */
const stateClass = computed(() =>
  props.part.state === 'running'
    ? 'bg-primary animate-pulse'
    : props.part.state === 'error'
      ? 'bg-down'
      : 'bg-up',
);

/** 入参摘要（单行，过长截断） */
const argsSummary = computed(() => {
  const text = props.part.argsText || '';
  if (!text || text === '{}') return '无参数';
  return text.length > 120 ? text.slice(0, 120) + '…' : text;
});

/** 结果摘要（单行，过长截断） */
const resultSummary = computed(() => {
  const text = props.part.resultText ?? '';
  if (!text) return props.part.state === 'running' ? '执行中…' : '无结果';
  return text.length > 160 ? text.slice(0, 160) + '…' : text;
});

/** 是否渲染 MCP App（有资源地址即渲染；载荷缺失时宿主会展示降级提示） */
const appPayload = computed<Record<string, unknown> | null>(() => props.part.ui?.payload ?? null);
</script>

<template>
  <div class="rounded-xl border border-flat-weak bg-flat-weak px-3 py-2">
    <div class="flex items-center gap-2 text-xs">
      <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="stateClass" />
      <span class="truncate font-medium text-text">{{ part.toolName }}</span>
      <span
        v-if="part.serverKey"
        class="shrink-0 rounded border border-flat-weak px-1.5 py-0.5 text-[11px] text-text-tertiary"
      >
        {{ part.serverKey }}
      </span>
      <span class="shrink-0 text-text-tertiary">{{ STATE_TEXT[part.state] }}</span>
      <span v-if="part.durationMs !== undefined" class="shrink-0 text-text-tertiary">
        {{ part.durationMs }}ms
      </span>
      <span class="min-w-0 flex-1 truncate text-text-tertiary">{{ argsSummary }}</span>
      <button
        type="button"
        class="shrink-0 rounded p-0.5 text-text-tertiary transition-colors hover:text-text"
        :aria-label="argsOpen ? '收起参数' : '展开参数'"
        @click="argsOpen = !argsOpen"
      >
        <MenuIcon name="chevronRight" :size="13" :class="argsOpen ? 'rotate-90' : ''" />
      </button>
    </div>

    <pre
      v-if="argsOpen"
      class="mt-2 max-h-40 overflow-auto rounded-lg bg-surface p-2 text-[11px] leading-5 text-text-secondary"
    >{{ part.argsText || '{}' }}</pre>

    <div v-if="part.ui" class="mt-2">
      <McpAppHost
        :resource-uri="part.ui.resourceUri"
        :payload="appPayload"
        :args-text="part.argsText"
        :is-error="part.state === 'error'"
        @ask="(text) => emit('ask', text)"
      />
    </div>

    <div class="mt-2">
      <p class="truncate text-[11px] text-text-tertiary">{{ resultSummary }}</p>
      <button
        v-if="(part.resultText ?? '').length > 160"
        type="button"
        class="mt-1 text-[11px] text-primary transition-opacity hover:opacity-80"
        @click="resultOpen = !resultOpen"
      >
        {{ resultOpen ? '收起原始结果' : '查看原始结果' }}
      </button>
      <pre
        v-if="resultOpen"
        class="mt-1 max-h-60 overflow-auto rounded-lg bg-surface p-2 text-[11px] leading-5 text-text-secondary"
      >{{ part.resultText }}</pre>
    </div>
  </div>
</template>

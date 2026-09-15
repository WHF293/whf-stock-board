<script setup lang="ts">
/**
 * MCP App 宿主（MCP Apps 规范中的 host 侧）
 *
 * 职责：把 `ui://` 资源放进沙箱 iframe，并与 it 之间实现 postMessage 握手与桥接：
 * - App → 宿主：`ui/initialize`（回协议版本 + hostContext）、`ui/notifications/initialized`、
 *   `ui/notifications/size-changed`（驱动高度）、`tools/call`（白名单校验后转发）、
 *   `ui/open-link`（仅 http/https）、`ui/message`（抛给 ChatPanel 作为用户追问）；
 * - 宿主 → App：`ui/notifications/tool-input`、`ui/notifications/tool-result`
 *   （structuredContent + hostContext）、`ui/notifications/host-context-changed`。
 *
 * 安全边界（逐条对应）：
 * - iframe `sandbox="allow-scripts"`：**不给 allow-same-origin**，App 拿不到
 *   本应用 DOM / localStorage / cookie；给了 allow-same-origin 就等于同源直连，整套
 *   sandbox 形同虚设（规范明确禁止）；
 * - 消息校验 `event.source === iframe.contentWindow`：拒绝其他窗口 / 页面的伪造消息；
 * - `tools/call` 经 `runtime.callUiTool` 双重白名单（资源 uiCallableTools ∧ 工具 uiCallable），
 *   写库类工具（save_news / db_execute…）永远不可达；并有单实例调用次数上限；
 * - `ui/open-link` 仅放行 http/https，挡掉 file: / javascript: 等危险协议。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getMcpRuntime } from '@/agent/mcp/registry';
import {
  MCP_APP_DEFAULT_HEIGHT,
  MCP_APP_MAX_HEIGHT,
  MCP_APP_MAX_TOOL_CALLS,
  MCP_APP_SANDBOX,
} from '@/agent/mcp/constants';
import { MCP_APP_PROTOCOL_VERSION } from '@/agent/mcp/ui-apps';
import { useTheme } from '@/composables/use-theme';
import { useSettingsStore } from '@/stores/settings';

/** 宿主标识（回给 App 的 hostInfo） */
const HOST_INFO = { name: 'whf-stock-board', version: '2.1.0' } as const;

const props = defineProps<{
  /** 资源地址（ui://<server>/<app>） */
  resourceUri: string;
  /** 工具结果的结构化数据（进 tool-result 的 structuredContent） */
  payload: Record<string, unknown> | null;
  /** 工具入参 JSON 文本（进 tool-input，供 App 显示「查了什么」） */
  argsText?: string;
  /** 工具是否失败（App 可据此展示错误态） */
  isError?: boolean;
}>();

const emit = defineEmits<{
  /** App 请求让 Agent 继续对话（ui/message） */
  (e: 'ask', text: string): void;
}>();

const { isDark } = useTheme();
const settings = useSettingsStore();

const iframeRef = ref<HTMLIFrameElement | null>(null);
/** 资源 HTML（沙箱 srcdoc；加载失败保持 null 并渲染降级提示） */
const html = ref<string | null>(null);
/** 资源是否加载失败（降级提示用） */
const loadFailed = ref(false);
/** 已收到 initialized 握手（此前不推送结果，避免 App 未就绪时丢消息） */
const handshakeDone = ref(false);
const frameHeight = ref(MCP_APP_DEFAULT_HEIGHT);
/** 本实例已发生的反向工具调用次数（防死循环） */
let toolCallCount = 0;

/** 下发给 App 的宿主上下文（主题 / 涨跌配色） */
const hostContext = computed(() => ({
  theme: isDark.value ? ('dark' as const) : ('light' as const),
  trend: settings.trendTheme,
}));

/**
 * 向 iframe 投递消息（iframe 未就绪时静默跳过）
 * @param message JSON-RPC 消息
 * @returns 无
 */
const postToApp = (message: Record<string, unknown>): void => {
  const target = iframeRef.value?.contentWindow;
  if (!target) return;
  // 沙箱 iframe 为不可预测的不透明来源，只能以 '*' 投递；安全性由「校验 event.source」保证
  target.postMessage(message, '*');
};

/**
 * 推送工具结果（App 渲染的数据来源）
 * @returns 无
 */
const pushToolResult = (): void => {
  postToApp({
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-result',
    params: {
      structuredContent: props.payload ?? {},
      isError: props.isError === true,
      hostContext: hostContext.value,
    },
  });
};

/**
 * 推送工具入参
 * @returns 无
 */
const pushToolInput = (): void => {
  postToApp({
    jsonrpc: '2.0',
    method: 'ui/notifications/tool-input',
    params: {
      arguments: props.argsText ?? '',
      hostContext: hostContext.value,
    },
  });
};

/**
 * 响应 App 的 JSON-RPC 请求
 * @param id 请求 id
 * @param result 成功结果
 * @returns 无
 */
const reply = (id: unknown, result: Record<string, unknown>): void => {
  postToApp({ jsonrpc: '2.0', id, result });
};

/**
 * 以 JSON-RPC 错误响应请求
 * @param id 请求 id
 * @param message 错误信息
 * @returns 无
 */
const replyError = (id: unknown, message: string): void => {
  postToApp({ jsonrpc: '2.0', id, error: { code: -32000, message } });
};

/**
 * 处理 `ui/open-link`：仅放行 http/https，桌面端走系统浏览器
 * @param id 请求 id
 * @param params 请求参数
 * @returns 无
 */
const handleOpenLink = async (id: unknown, params: Record<string, unknown>): Promise<void> => {
  const url = typeof params.url === 'string' ? params.url : '';
  if (!/^https?:\/\//i.test(url)) {
    replyError(id, '仅允许打开 http/https 链接');
    return;
  }
  try {
    if (isTauri()) await openUrl(url);
    else window.open(url, '_blank', 'noopener,noreferrer');
    reply(id, {});
  } catch (error) {
    replyError(id, error instanceof Error ? error.message : String(error));
  }
};

/**
 * 处理 `tools/call`：经运行时白名单转发（写操作类工具永远拒绝）
 * @param id 请求 id
 * @param params 请求参数（name / arguments）
 * @returns 无
 */
const handleToolCall = async (id: unknown, params: Record<string, unknown>): Promise<void> => {
  if (toolCallCount >= MCP_APP_MAX_TOOL_CALLS) {
    replyError(id, '该卡片调用工具次数已达上限');
    return;
  }
  const name = typeof params.name === 'string' ? params.name : '';
  if (!name) {
    replyError(id, '缺少工具名');
    return;
  }
  toolCallCount += 1;
  try {
    const runtime = await getMcpRuntime();
    const result = await runtime.callUiTool(props.resourceUri, name, params.arguments ?? {});
    reply(id, {
      content: result.content,
      structuredContent: result.structuredContent ?? {},
      isError: result.isError === true,
    });
  } catch (error) {
    replyError(id, error instanceof Error ? error.message : String(error));
  }
};

/**
 * 处理 App 发来的 `ui/message`：把文本抛给 ChatPanel（作为用户追问的预填）
 * @param id 请求 id
 * @param params 请求参数
 * @returns 无
 */
const handleAppMessage = (id: unknown, params: Record<string, unknown>): void => {
  const content = Array.isArray(params.content) ? params.content : [];
  const text = content
    .map((part) => (part && typeof part === 'object' ? (part as { text?: unknown }).text : ''))
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .join('\n');
  if (text) emit('ask', text);
  reply(id, {});
};

/**
 * 桥接入口：校验来源后分发 App 消息
 * @param event postMessage 事件
 * @returns 无
 */
const onAppMessage = (event: MessageEvent): void => {
  // 安全卡口：只接受本卡片 iframe 发来的消息
  if (!iframeRef.value || event.source !== iframeRef.value.contentWindow) return;
  const message = event.data as
    | { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
    | undefined;
  if (!message || message.jsonrpc !== '2.0') return;
  const params = message.params ?? {};

  if (typeof message.method === 'string' && message.id !== undefined) {
    switch (message.method) {
      case 'ui/initialize':
        reply(message.id, {
          // 版本宽容策略：第三方 App 声明什么就回显什么，不因版本不同拒绝渲染
          protocolVersion:
            typeof params.protocolVersion === 'string' ? params.protocolVersion : MCP_APP_PROTOCOL_VERSION,
          hostInfo: HOST_INFO,
          hostCapabilities: { tools: { listChanged: false }, openLinks: {} },
          hostContext: hostContext.value,
        });
        return;
      case 'tools/call':
        void handleToolCall(message.id, params);
        return;
      case 'ui/open-link':
        void handleOpenLink(message.id, params);
        return;
      case 'ui/message':
        handleAppMessage(message.id, params);
        return;
      case 'ui/update-model-context':
        // 本宿主不把 UI 数据回灌模型上下文（避免 token 与幻觉双重成本），仅确认
        reply(message.id, {});
        return;
      default:
        reply(message.id, {});
        return;
    }
  }

  switch (message.method) {
    case 'ui/notifications/initialized':
      handshakeDone.value = true;
      pushToolInput();
      pushToolResult();
      return;
    case 'ui/notifications/size-changed': {
      const height = Number(params.height);
      if (Number.isFinite(height)) {
        frameHeight.value = Math.min(MCP_APP_MAX_HEIGHT, Math.max(80, Math.round(height)));
      }
      return;
    }
    default:
      return;
  }
};

watch(handshakeDone, (done) => {
  if (done) pushToolResult();
});

watch(
  () => props.payload,
  () => {
    if (handshakeDone.value) pushToolResult();
  },
);

watch(hostContext, (context) => {
  postToApp({ jsonrpc: '2.0', method: 'ui/notifications/host-context-changed', params: { hostContext: context } });
});

onMounted(async () => {
  window.addEventListener('message', onAppMessage);
  try {
    const runtime = await getMcpRuntime();
    const resource = await runtime.readUiResource(props.resourceUri);
    if (!resource) {
      loadFailed.value = true;
      return;
    }
    html.value = resource.html;
  } catch {
    loadFailed.value = true;
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('message', onAppMessage);
});
</script>

<template>
  <div class="overflow-hidden rounded-xl border border-flat-weak bg-surface">
    <iframe
      v-if="html"
      ref="iframeRef"
      :srcdoc="html"
      :sandbox="MCP_APP_SANDBOX"
      :style="{ height: `${frameHeight}px` }"
      class="block w-full border-0 bg-transparent"
      title="MCP App"
    />
    <p v-else-if="loadFailed" class="px-3 py-2 text-xs text-text-tertiary">
      该 MCP App 资源不可用（已回退为文本结果）
    </p>
    <p v-else class="px-3 py-2 text-xs text-text-tertiary">正在加载 MCP App…</p>
  </div>
</template>

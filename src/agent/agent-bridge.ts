/**
 * 「AI 分析」跨页调用桥（主窗口页面 → Agent 分析）
 *
 * Agent 只活在 `/agent-window`（Tauri 独立 WebviewWindow / 浏览器同窗路由），
 * 主窗口页面要把一条分析请求递给它，两条通路：
 * - **Tauri**：全局事件投递。已开窗口 → 聚焦 + `agent:ask`；未开 → 创建窗口后
 *   等 Agent 侧 `agent:ready` 回执再投（新 webview 挂载有延迟，直接 emit 会丢），
 *   等待超时按尽力投递处理；创建失败回退站内路由。
 * - **浏览器**：同窗路由跳转，请求暂存模块级变量，AgentAnalysisView 挂载后取走消费
 *   （同一 JS 上下文，无需事件）。
 *
 * Agent 侧消费逻辑（无模型开 Model 弹窗 / 有模型直发）在 AgentAnalysisView，
 * 本文件只管把 prompt 送到。
 */
import { isTauri } from '@tauri-apps/api/core';
import { emit, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { ROUTE_PATH } from '@/constants/router-meta.constants';
import {
  AGENT_ASK_EVENT,
  AGENT_ASK_HANDSHAKE_TIMEOUT_MS,
  AGENT_READY_EVENT,
} from '@/constants/agent-ask.constants';
import { AGENT_WINDOW_LABEL, openAgentAnalysisWindow } from '@/utils/agent-window';
import { router } from '@/router';

/** 浏览器回退路径下暂存的待消费请求（同窗路由跳转后由 AgentAnalysisView 取走） */
let pendingAsk: string | null = null;

/**
 * 发起一次 AI 分析请求（主窗口页面入口）
 *
 * 送达后 Agent 侧行为：切回对话视图；未配置模型 → 提示 + 自动打开 Model 管理；
 * 已配置 → 直接作为用户消息发送。
 * @param prompt 完整提示词（调用方用 utils/build-*-analysis-prompt 组装）
 */
export const requestAgentAnalysis = async (prompt: string): Promise<void> => {
  if (!isTauri()) {
    pendingAsk = prompt;
    await router.push(ROUTE_PATH.AGENT_WINDOW);
    return;
  }
  const existing = await WebviewWindow.getByLabel(AGENT_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    await emit(AGENT_ASK_EVENT, { prompt });
    return;
  }
  const opened = await openAgentAnalysisWindow();
  if (!opened) {
    pendingAsk = prompt;
    await router.push(ROUTE_PATH.AGENT_WINDOW);
    return;
  }
  await waitReadyThenEmit(prompt);
};

/**
 * 新建 Agent 窗口后的握手投递：等 `agent:ready`（监听一次）再 emit；
 * 超时（Agent 侧异常未回执）按尽力投递 emit，丢了自己重点一次即可
 * @param prompt 提示词
 */
const waitReadyThenEmit = async (prompt: string): Promise<void> => {
  await new Promise<void>((resolve) => {
    const unlisten = listen(AGENT_READY_EVENT, () => {
      clearTimeout(timer);
      unlisten.then((off) => off());
      resolve();
    });
    const timer = setTimeout(() => {
      unlisten.then((off) => off());
      resolve();
    }, AGENT_ASK_HANDSHAKE_TIMEOUT_MS);
  });
  await emit(AGENT_ASK_EVENT, { prompt });
};

/**
 * Agent 侧：订阅跨窗口分析请求（AgentAnalysisView 挂载时调用）
 * @param handler 收到请求的回调（prompt 已解包）
 * @returns 取消订阅函数（非 Tauri 环境返回空操作）
 */
export const listenAgentAsk = async (
  handler: (prompt: string) => void,
): Promise<UnlistenFn> => {
  if (!isTauri()) return () => undefined;
  return listen<{ prompt: string }>(AGENT_ASK_EVENT, (event) => {
    handler(event.payload.prompt);
  });
};

/**
 * Agent 侧：广播就绪回执（init 完成后调用，主窗口握手方据此投递）
 */
export const notifyAgentReady = async (): Promise<void> => {
  if (!isTauri()) return;
  await emit(AGENT_READY_EVENT);
};

/**
 * Agent 侧：取走浏览器回退路径暂存的待消费请求（读后即清）
 * @returns 提示词；无暂存返回 null
 */
export const consumePendingAgentAsk = (): string | null => {
  const prompt = pendingAsk;
  pendingAsk = null;
  return prompt;
};

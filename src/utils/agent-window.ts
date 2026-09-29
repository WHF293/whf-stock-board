/**
 * Agent 分析独立窗口（webview 容器）
 *
 * - 与热点新闻原文窗口同思路：Tauri 下用独立 WebviewWindow 打开，
 *   内容区加载应用内路由 /agent-window（standalone 布局，占满整个 webview）；
 * - label 固定为 agent-analysis：已存在时聚焦而不是再开一个（Agent 是单例工作区）；
 * - capabilities 的 windows 列表须包含该 label（default.json），否则 IPC 全被拒
 */
import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

/** Agent 窗口 label（全局唯一；capabilities 按此授权） */
export const AGENT_WINDOW_LABEL = 'agent-analysis';

/** 窗口默认尺寸（可拉伸；standalone 内容自适应铺满） */
const AGENT_WINDOW_WIDTH = 1280;
const AGENT_WINDOW_HEIGHT = 820;

/**
 * 打开 Agent 分析窗口
 *
 * - Tauri：已有 agent-analysis 窗口 → 聚焦；否则创建新 WebviewWindow；
 *   url 用 `index.html?page=/agent-window`（router 启动时把 page 参数
 *   replaceState 成真实路径，规避 Tauri 静态资源协议对 SPA 子路径的回退不确定性）
 * - 浏览器：返回 false（调用方回退为站内路由跳转）
 *
 * ⚠️ WebviewWindow 构造函数是同步返回的，创建成败经 tauri://created / tauri://error
 * 事件异步到达（如 capabilities 未重编译导致 IPC 被拒），必须等事件再下结论，
 * 否则创建失败会被误报成功、调用方无法回退
 * @returns 是否以独立窗口打开
 */
export const openAgentAnalysisWindow = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  try {
    const existing = await WebviewWindow.getByLabel(AGENT_WINDOW_LABEL);
    if (existing) {
      await existing.setFocus();
      return true;
    }
    return await new Promise<boolean>((resolve) => {
      const win = new WebviewWindow(AGENT_WINDOW_LABEL, {
        url: `index.html?page=/agent-window`,
        title: 'Agent 分析',
        width: AGENT_WINDOW_WIDTH,
        height: AGENT_WINDOW_HEIGHT,
        center: true,
        resizable: true,
        // 与主窗口一致：去系统标题栏，用应用内 AgentWindowTitlebar 自绘
        decorations: false,
      });
      win.once('tauri://created', () => resolve(true));
      win.once('tauri://error', (event) => {
        console.error('[agent-window] create failed', event);
        resolve(false);
      });
    });
  } catch (error) {
    console.error('[agent-window] open', error);
    return false;
  }
};

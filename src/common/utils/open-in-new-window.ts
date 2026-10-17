import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl } from '@tauri-apps/plugin-opener';

/** 浏览器态新闻原文小窗宽度（居中弹出，3:1 比例） */
const NEWS_WINDOW_WIDTH = 900;

/** 浏览器态新闻原文小窗高度（3:1 比例） */
const NEWS_WINDOW_HEIGHT = Math.round(NEWS_WINDOW_WIDTH / 3);

/** Tauri 态原文窗口宽度 */
const TAURI_NEWS_WINDOW_WIDTH = 1024;

/** Tauri 态原文窗口高度 */
const TAURI_NEWS_WINDOW_HEIGHT = 768;

/**
 * 用独立窗口打开新闻原文页（热点新闻页 / 盯盘小组件新闻视图共用）
 *
 * - Tauri：新建独立 WebviewWindow 加载原文页（应用内 webview 容器），
 *   远程页面无 IPC 权限（capabilities 仅对 main 授予核心权限，
 *   news-* 窗口只保留原生关闭能力）；创建失败时回退系统默认浏览器；
 * - 浏览器：新开 900 x 300 小窗直接导航原文页——不使用 iframe，
 *   规避新闻站点的 X-Frame-Options / CSP 反框架限制（iframe 方案会白屏）
 * @param url 新闻原文链接
 */
export const openInNewWindow = async (url: string): Promise<void> => {
  if (isTauri()) {
    try {
      // label 全局唯一且不能复用已销毁窗口的 label，用时间戳避免冲突
      const label = `news-${Date.now()}`;
      const win = new WebviewWindow(label, {
        url,
        title: '新闻',
        width: TAURI_NEWS_WINDOW_WIDTH,
        height: TAURI_NEWS_WINDOW_HEIGHT,
        center: true,
      });
      // 创建失败（权限缺失 / label 冲突等）时回退系统浏览器
      win.once('tauri://error', (event) => {
        console.error('[news-window] webview window', event);
        void openUrl(url);
      });
      return;
    } catch (error) {
      console.error('[news-window] webview window', error);
      try {
        await openUrl(url);
      } catch (openError) {
        console.error('[news-window] opener', openError);
      }
      return;
    }
  }
  // 浏览器：3:1 小窗（900 x 300）居中弹出
  const left = Math.max(
    0,
    Math.round((window.screen.availWidth - NEWS_WINDOW_WIDTH) / 2),
  );
  const top = Math.max(
    0,
    Math.round((window.screen.availHeight - NEWS_WINDOW_HEIGHT) / 2),
  );
  const features =
    `width=${NEWS_WINDOW_WIDTH},height=${NEWS_WINDOW_HEIGHT},left=${left},top=${top},` +
    'menubar=no,toolbar=no,location=no,status=no';
  if (!window.open(url, '_blank', features)) {
    window.open(url, '_blank', 'noopener');
  }
};

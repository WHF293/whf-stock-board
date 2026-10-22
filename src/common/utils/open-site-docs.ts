import { isTauri } from '@tauri-apps/api/core';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { openUrl } from '@tauri-apps/plugin-opener';
import { SITE_URL } from '../constants/app-info.constants.ts';

/** 官网「软件文档」页地址（hash 路由） */
export const SITE_DOCS_URL = `${SITE_URL}#/docs`;

/** 应用内白皮书窗口宽度（px） */
const DOCS_WINDOW_WIDTH = 1120;

/** 应用内白皮书窗口高度（px） */
const DOCS_WINDOW_HEIGHT = 800;

/**
 * 应用内打开官网「软件文档」（顶栏书本图标 → 气泡「在应用内打开」）
 *
 * - Tauri：新建独立 WebviewWindow 加载官网文档页（应用内 webview 容器，
 *   远程页面无 IPC 权限，同 news-* 窗口先例）；创建失败回退系统默认浏览器；
 * - 浏览器：新标签页打开（dev 环境无 Tauri runtime）
 */
export const openSiteDocsInApp = async (): Promise<void> => {
  if (isTauri()) {
    try {
      // label 全局唯一且不能复用已销毁窗口的 label，用时间戳避免冲突
      const label = `site-docs-${Date.now()}`;
      const win = new WebviewWindow(label, {
        url: SITE_DOCS_URL,
        title: '软件白皮书',
        width: DOCS_WINDOW_WIDTH,
        height: DOCS_WINDOW_HEIGHT,
        center: true,
      });
      // 创建失败（权限缺失 / label 冲突等）时回退系统默认浏览器
      win.once('tauri://error', (event) => {
        console.error('[site-docs-window] webview window', event);
        void openUrl(SITE_DOCS_URL);
      });
      return;
    } catch (error) {
      console.error('[site-docs-window] webview window', error);
      void openUrl(SITE_DOCS_URL).catch(() => window.open(SITE_DOCS_URL, '_blank'));
      return;
    }
  }
  window.open(SITE_DOCS_URL, '_blank', 'noopener');
};

/**
 * 系统默认浏览器打开官网「软件文档」（顶栏书本图标 → 气泡「在浏览器打开」；
 * Tauri plugin-opener，纯浏览器 dev 环境兜底新标签页）
 */
export const openSiteDocsInBrowser = async (): Promise<void> => {
  await openUrl(SITE_DOCS_URL).catch(() => window.open(SITE_DOCS_URL, '_blank'));
};

import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * 窗口关闭行为（Tauri 托盘）· API
 *
 * 前端把「关闭按钮最小化到托盘」的设置同步给 Rust 侧；窗口 CloseRequested
 * 的拦截在 Rust 侧统一处理（自绘标题栏 ×、Alt+F4、任务栏关闭都走同一条路）。
 * 浏览器开发模式无窗口概念，所有同步为空操作。
 */

/**
 * 同步「关闭按钮最小化到托盘」设置到 Rust 侧
 * @param enabled true = 关闭请求仅隐藏窗口（托盘菜单「退出」才真正退出）
 */
export const syncCloseToTray = async (enabled: boolean): Promise<void> => {
  if (!isTauri()) return;
  try {
    await invoke('set_close_to_tray', { enabled });
  } catch (error) {
    // 同步失败不致命：托盘未建（如无图标环境）时保持默认行为即可
    console.warn('[tray] 同步关闭行为设置失败', error);
  }
};

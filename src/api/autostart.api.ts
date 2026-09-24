import { isTauri } from '@tauri-apps/api/core';
import {
  disable,
  enable,
  isEnabled,
} from '@tauri-apps/plugin-autostart';

/**
 * 开机自动启动（Tauri autostart 插件）· API
 *
 * Windows 实现为写 HKCU `Software\Microsoft\Windows\CurrentVersion\Run`
 * 注册表键（免提权，随当前用户登录启动）。注册表是持久事实源：应用内
 * 只在用户切换开关时调用 enable / disable，不做启动时强制回写，
 * 避免覆盖用户在系统层面（任务管理器启动项页签）的手动调整。
 * 浏览器模式全部为空操作。
 */

/**
 * 查询当前是否已设置开机自动启动
 * @returns true = 已写入系统启动项；false = 未设置或非 Tauri 环境
 */
export const isAutoStartEnabled = async (): Promise<boolean> => {
  if (!isTauri()) return false;
  try {
    return await isEnabled();
  } catch (error) {
    // 查询失败（如权限异常）按未开启处理，仅控制台留痕
    console.warn('[autostart] 查询开机自启状态失败', error);
    return false;
  }
};

/**
 * 设置开机自动启动
 * @param enabled true = 写入系统启动项（随登录启动应用）；false = 移除启动项
 */
export const setAutoStartEnabled = async (enabled: boolean): Promise<void> => {
  if (!isTauri()) return;
  if (enabled) {
    await enable();
  } else {
    await disable();
  }
};

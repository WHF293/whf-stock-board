import { computed, type ComputedRef } from 'vue';
import { isTauri } from '@tauri-apps/api/core';
import { STORAGE_NS_DEBUG_DESKTOP_CHROME } from '../constants/storage-key.constants.ts';
import { appStorage } from '../utils/app-local-storage';

/** URL 参数名：`?desktopTitlebar=0` 显式关闭模拟，`=1` 显式开启；无参数用默认（开） */
const QUERY_KEY = 'desktopTitlebar';

/**
 * 是否按桌面外壳渲染的最终取值（模块加载时定死，一次求值）：
 * 1. URL 显式参数优先（'1' / '0'，同时写穿持久层，供下次无参数时沿用）；
 * 2. 无参数时用持久化值；从未设置过则默认 '1'——浏览器默认模拟客户端外壳，
 *    方便随时与真实客户端比对样式（王总指定 2026-10-13）。
 */
const storedValue = appStorage.getItem(STORAGE_NS_DEBUG_DESKTOP_CHROME);
const queryValue = new URLSearchParams(window.location.search).get(QUERY_KEY);
let resolvedValue: string;
if (queryValue === '1' || queryValue === '0') {
  appStorage.setItem(STORAGE_NS_DEBUG_DESKTOP_CHROME, queryValue);
  resolvedValue = queryValue;
} else {
  resolvedValue = storedValue ?? '1';
}

/** 是否运行在 Tauri 客户端（进程内不变，模块级求值一次） */
const inTauri = isTauri();

const desktopChromeEnabled = computed(() => inTauri || resolvedValue === '1');

/**
 * 桌面端布局开关
 *
 * 背景：自绘 TitleBar 等桌面外壳仅 Tauri 渲染，浏览器对样式时（尤其是标题栏区域）
 * 无法直观确认渲染效果。此开关让浏览器**默认就按桌面布局渲染**：
 * - 默认开启，无需任何参数；
 * - URL 带 `?desktopTitlebar=0` 可关闭（记住，之后无参数仍为关）；
 * - 带 `?desktopTitlebar=1` 可再开回来；
 * - Tauri 客户端恒为桌面布局，不受开关影响。
 *
 * @returns desktopChrome 是否按桌面端外壳渲染（自绘 TitleBar / 侧栏顶部块上移等）；
 *          canControlWindow 窗口控制按钮是否可实际操作（仅 Tauri；浏览器模拟时禁用渲染、占位一致）
 */
export const useDesktopChrome = (): {
  desktopChrome: ComputedRef<boolean>;
  canControlWindow: boolean;
} => ({
  desktopChrome: desktopChromeEnabled,
  canControlWindow: inTauri,
});

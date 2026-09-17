/**
 * 内置插件清单（唯一事实源）
 *
 * 新增一个内置能力 = 在 `src/plugins/<name>/` 写一个插件定义（元信息 + apply），
 * 然后追加到本数组。数组顺序不影响挂载顺序 —— 挂载由内核按 `inject` 依赖收敛决定。
 */
import { sidebarWatchPlugin } from './sidebar-watch/plugin';
import { quickNotePlugin } from './quick-note/plugin';
import { pluginLabPlugin } from './plugin-lab/plugin';
import { mainlinePlugin } from './mainline/plugin';
import type { PluginDefinition } from '../types/plugin.types';

/** 全部随应用分发的内置插件 */
export const BUILTIN_PLUGINS: readonly PluginDefinition[] = [
  sidebarWatchPlugin,
  quickNotePlugin,
  pluginLabPlugin,
  mainlinePlugin,
];

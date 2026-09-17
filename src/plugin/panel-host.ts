/**
 * 插件面板宿主上下文
 *
 * 面板组件由宿主（MainLayout / 插件抽屉）渲染，宿主通过 `provide` 下发这个上下文，
 * 面板即可知道「我现在是内联还是抽屉形态」「怎么把自己关掉」，
 * 而不需要向宿主组件传一堆回调 props。
 *
 * 面板侧用法：
 * ```ts
 * const host = usePluginPanelHost();
 * host?.close();
 * ```
 */
import { inject } from 'vue';
import type { InjectionKey } from 'vue';
import type { PluginPanelHostMode } from '../types/plugin.types';

/** 插件面板宿主上下文 */
export interface PluginPanelHost {
  /** 面板全局键（`<pluginId>#<panelId>`） */
  key: string;
  /** 面板承载形态（内联侧栏 / 右侧抽屉 / 顶栏下拉） */
  mode: PluginPanelHostMode;
  /** 关闭自己：inline 面板折叠；drawer 面板关抽屉；header 面板收起下拉 */
  close: () => void;
}

/** 宿主上下文的注入键 */
export const PLUGIN_PANEL_HOST_KEY: InjectionKey<PluginPanelHost> = Symbol('plugin-panel-host');

/**
 * 取当前面板的宿主上下文（不在插件面板内调用时返回 undefined）
 * @returns 宿主上下文；面板外调用返回 undefined
 */
export const usePluginPanelHost = (): PluginPanelHost | undefined =>
  inject(PLUGIN_PANEL_HOST_KEY);

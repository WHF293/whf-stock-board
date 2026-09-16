import { defineStore } from 'pinia';

/** 插件面板宿主 store 状态（会话级，不持久化） */
interface PluginPanelsState {
  /** 当前在右侧抽屉里打开的插件面板全局键（null = 未打开） */
  drawerPanelKey: string | null;
  /** 请求「滚动到 inline 面板」的面板全局键 */
  revealPanelKey: string;
  /**
   * 滚动请求序号
   *
   * 用递增序号而不是布尔标记：用户连续两次请求展开同一个面板时，
   * 布尔值第二次不会变化、watch 不触发；序号每次都变，滚动必定重放。
   */
  revealSeq: number;
}

/**
 * 插件面板宿主 store
 *
 * 左侧栏面板由插件内核注册、由 MainLayout 渲染，但「打开 / 展开」这类动作
 * 可能来自任意位置（命令、事件、其他插件）。与其让调用方去找 DOM，
 * 不如把意图集中到这里，由宿主组件消费：这正是 `panel:open` 服务的实现底座。
 */
export const usePluginPanelsStore = defineStore('pluginPanels', {
  state: (): PluginPanelsState => ({
    drawerPanelKey: null,
    revealPanelKey: '',
    revealSeq: 0,
  }),

  getters: {
    /**
     * 抽屉是否打开
     * @param state store 状态
     * @returns 是否打开
     */
    isDrawerOpen: (state: PluginPanelsState): boolean => state.drawerPanelKey !== null,
  },

  actions: {
    /**
     * 在右侧抽屉里打开某个插件面板
     * @param panelKey 面板全局键（`<pluginId>#<panelId>`）
     */
    openDrawer(panelKey: string): void {
      this.drawerPanelKey = panelKey;
    },

    /** 关闭插件面板抽屉 */
    closeDrawer(): void {
      this.drawerPanelKey = null;
    },

    /**
     * 请求把某个 inline 面板滚动到可视区
     * @param panelKey 面板全局键（`<pluginId>#<panelId>`）
     */
    requestReveal(panelKey: string): void {
      this.revealPanelKey = panelKey;
      this.revealSeq += 1;
    },
  },
});

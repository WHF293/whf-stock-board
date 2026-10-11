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
  /** 请求展开的顶栏条目全局键（`<pluginId>#<id>`，空串 = 无请求） */
  headerItemKey: string;
  /** 顶栏展开请求序号（同 revealSeq 的理由：连续两次请求同一个条目也要能重放） */
  headerSeq: number;
  /** 请求收起的顶栏条目全局键（空串 = 无请求） */
  headerCloseKey: string;
  /** 顶栏收起请求序号（同 headerSeq 的理由） */
  headerCloseSeq: number;
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
    headerItemKey: '',
    headerSeq: 0,
    headerCloseKey: '',
    headerCloseSeq: 0,
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

    /**
     * 请求展开某个顶栏条目的下拉面板
     * @param itemKey 条目全局键（`<pluginId>#<id>`）
     */
    requestHeaderOpen(itemKey: string): void {
      this.headerItemKey = itemKey;
      this.headerSeq += 1;
    },

    /**
     * 请求收起某个顶栏条目的下拉面板（`panel:close` 服务的顶栏分支）
     *
     * 下拉的展开态是 `HeaderItemHost` 的本地 state，宿主因此只能「发意图」：
     * 这里记 key + 递增序号，由对应条目自己 watch 并收起。
     * @param itemKey 条目全局键（`<pluginId>#<id>`）
     */
    requestHeaderClose(itemKey: string): void {
      this.headerCloseKey = itemKey;
      this.headerCloseSeq += 1;
    },
  },
});

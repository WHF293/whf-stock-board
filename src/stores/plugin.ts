import { defineStore } from 'pinia';
import { STORAGE_NS_PLUGIN } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';

/** 插件 store 状态 */
interface PluginState {
  /**
   * 被用户禁用的插件 id 列表（**黑名单**语义）
   *
   * 用黑名单而非白名单：版本升级新增的内置插件不需要任何迁移脚本即默认生效，
   * 用户只显式记录「我关掉了谁」。
   */
  disabledPlugins: string[];
  /**
   * 折叠起来的侧栏插件面板全局键列表（`<pluginId>#<panelId>`）
   *
   * 面板默认展开，这里只记「被用户折起来的那几个」。
   */
  collapsedSidebarPanels: string[];
}

/**
 * 插件偏好 store（localStorage 持久化）
 *
 * 只存**用户偏好**，不存运行时状态：插件是否已挂载由内核（`pluginKernel`）持有，
 * 刷新后由 `installPlugins()` 依据本 store 的黑名单重新收敛。
 */
export const usePluginStore = defineStore('plugin', {
  state: (): PluginState => ({
    disabledPlugins: [],
    collapsedSidebarPanels: [],
  }),

  actions: {
    /**
     * 插件是否被用户启用（未列入黑名单即启用）
     * @param id 插件 id
     * @returns 是否启用
     */
    isPluginEnabled(id: string): boolean {
      return !this.disabledPlugins.includes(id);
    },

    /**
     * 记录插件启用 / 禁用偏好（只改持久化，内核收敛由调用方的 usePlugins 负责）
     * @param id 插件 id
     * @param enabled 是否启用
     */
    setPluginEnabled(id: string, enabled: boolean): void {
      const next = new Set(this.disabledPlugins);
      if (enabled) {
        next.delete(id);
      } else {
        next.add(id);
      }
      this.disabledPlugins = [...next];
    },

    /**
     * 取某个插件全部被折叠的面板键
     * @param pluginId 插件 id
     * @returns 该插件下已折叠的面板全局键
     */
    listCollapsedPanelsOf(pluginId: string): string[] {
      const prefix = `${pluginId}#`;
      return this.collapsedSidebarPanels.filter((key) => key.startsWith(prefix));
    },

    /**
     * 面板是否处于折叠态
     * @param panelKey 面板全局键（`<pluginId>#<panelId>`）
     * @returns 是否折叠
     */
    isPanelCollapsed(panelKey: string): boolean {
      return this.collapsedSidebarPanels.includes(panelKey);
    },

    /**
     * 切换面板折叠态
     * @param panelKey 面板全局键（`<pluginId>#<panelId>`）
     */
    togglePanelCollapsed(panelKey: string): void {
      this.collapsedSidebarPanels = this.collapsedSidebarPanels.includes(panelKey)
        ? this.collapsedSidebarPanels.filter((key) => key !== panelKey)
        : [...this.collapsedSidebarPanels, panelKey];
    },

    /**
     * 清理已被卸载插件的残留偏好（避免黑名单无限增长）
     * @param aliveIds 当前仍存在的插件 id 列表
     */
    pruneUnknownPlugins(aliveIds: readonly string[]): void {
      const alive = new Set(aliveIds);
      const nextDisabled = this.disabledPlugins.filter((id) => alive.has(id));
      const nextCollapsed = this.collapsedSidebarPanels.filter((key) =>
        alive.has(key.split('#')[0] ?? ''),
      );
      if (nextDisabled.length !== this.disabledPlugins.length) {
        this.disabledPlugins = nextDisabled;
      }
      if (nextCollapsed.length !== this.collapsedSidebarPanels.length) {
        this.collapsedSidebarPanels = nextCollapsed;
      }
    },
  },

  persist: {
    key: STORAGE_NS_PLUGIN,
    storage: appStorage,
  },
});

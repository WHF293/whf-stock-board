import { computed } from 'vue';
import { pluginKernel } from '../plugin';
import { usePluginStore } from '../stores/plugin';
import { PLUGIN_STATUS } from '../constants/plugin.constants';
import { trackAction } from '../weblog/weblogActions';
import type { ComputedRef } from 'vue';
import type { PluginRuntimeInfo } from '../types/plugin.types';

/** `usePlugins` 返回句柄 */
export interface UsePluginsReturn {
  /** 插件运行时快照（状态变化后自动刷新） */
  plugins: ComputedRef<readonly PluginRuntimeInfo[]>;
  /** 已挂载插件数量 */
  mountedCount: ComputedRef<number>;
  /**
   * 启用 / 禁用插件（同时更新持久化偏好与内核挂载状态）
   * @param id 插件 id
   * @param enabled 是否启用
   */
  setEnabled: (id: string, enabled: boolean) => void;
  /**
   * 重试挂载失败的插件
   * @param id 插件 id
   */
  retry: (id: string) => void;
  /**
   * 插件是否被用户启用（读持久化偏好）
   * @param id 插件 id
   * @returns 是否启用
   */
  isEnabled: (id: string) => boolean;
}

/**
 * 插件启停的宿主入口
 *
 * 单向数据流：用户操作 → 写持久化偏好（`pluginStore`）→ 内核收敛挂载状态
 * （`pluginKernel.setEnabled`）→ 注册表变化驱动 UI 重渲染。
 * 内核不读 localStorage，store 也不直接操作注册表，两边各管一半。
 * @returns 插件列表与启停句柄
 */
export const usePlugins = (): UsePluginsReturn => {
  const pluginStore = usePluginStore();

  const plugins = computed<readonly PluginRuntimeInfo[]>(() => {
    // 订阅内核版本号：任何状态变化都能让本快照重新求值
    void pluginKernel.revision.value;
    return pluginKernel.list();
  });

  const mountedCount = computed(
    () => plugins.value.filter((plugin) => plugin.status === PLUGIN_STATUS.MOUNTED).length,
  );

  return {
    plugins,
    mountedCount,
    setEnabled: (id, enabled) => {
      pluginStore.setPluginEnabled(id, enabled);
      pluginKernel.setEnabled(id, enabled);
      trackAction('PLUGIN_TOGGLE', {
        target: id,
        detail: enabled ? '启用' : '禁用',
      });
    },
    retry: (id) => {
      pluginKernel.retry(id);
    },
    isEnabled: (id) => pluginStore.isPluginEnabled(id),
  };
};

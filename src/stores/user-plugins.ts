import { defineStore } from 'pinia';
import { USER_PLUGIN_RECORD_MAX } from '../constants/plugin.constants';
import { STORAGE_NS_USER_PLUGINS } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import type { UserPluginRecord } from '../types/plugin.types';

/** 用户插件 store 状态 */
interface UserPluginsState {
  /** 已安装的用户插件记录（代码原文在内，按安装时间倒序） */
  records: UserPluginRecord[];
}

/**
 * 用户安装插件 store（localStorage 持久化）
 *
 * 只负责**代码的存与取**：挂载由 `plugin/setup.ts` 启动时驱动，
 * 安装 / 卸载动作由 `composables/use-user-plugins.ts` 编排（内核与 store 各管一半）。
 */
export const useUserPluginsStore = defineStore('userPlugins', {
  state: (): UserPluginsState => ({
    records: [],
  }),

  actions: {
    /**
     * 插件 id 是否已安装
     * @param id 插件 id
     * @returns 是否已安装
     */
    has(id: string): boolean {
      return this.records.some((record) => record.id === id);
    },

    /**
     * 取某个已安装插件的记录
     * @param id 插件 id
     * @returns 插件记录；未安装返回 undefined
     */
    get(id: string): UserPluginRecord | undefined {
      return this.records.find((record) => record.id === id);
    },

    /**
     * 安装 / 覆盖安装一条记录（同 id 覆盖，其余追加；超出上限时拒绝）
     * @param record 插件记录
     * @returns 是否写入成功（false = 超出条目上限且非覆盖）
     */
    upsert(record: UserPluginRecord): boolean {
      const index = this.records.findIndex((item) => item.id === record.id);
      if (index >= 0) {
        this.records.splice(index, 1, record);
        return true;
      }
      if (this.records.length >= USER_PLUGIN_RECORD_MAX) return false;
      this.records = [record, ...this.records];
      return true;
    },

    /**
     * 卸载一条记录（代码从持久化移除；插件运行时数据不在此清理）
     * @param id 插件 id
     * @returns 是否确实移除了记录
     */
    remove(id: string): boolean {
      const before = this.records.length;
      this.records = this.records.filter((record) => record.id !== id);
      return this.records.length < before;
    },
  },

  persist: {
    key: STORAGE_NS_USER_PLUGINS,
    storage: appStorage,
  },
});

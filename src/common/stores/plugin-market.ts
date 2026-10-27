/**
 * 插件市场源列表 store（localStorage 持久化）
 *
 * 只负责**源配置的存与取**：内置官方源 + 用户添加的第三方 GitHub 仓库。
 * 拉取 / 聚合 / 安装在 `composables/use-plugin-market.ts`；
 * 持久化数据经数据迁移登记（`data-port.constants.ts` 的 plugins 类别 nsKeys）跨机搬运。
 */
import { defineStore } from 'pinia';
import {
  PLUGIN_MARKET_BUILTIN_LABEL,
  PLUGIN_MARKET_BUILTIN_REPO,
  PLUGIN_MARKET_ERR_SOURCE_DUP,
  PLUGIN_MARKET_ERR_SOURCE_MAX,
  PLUGIN_MARKET_SOURCE_MAX,
} from '../constants/plugin-market.constants.ts';
import { STORAGE_NS_PLUGIN_MARKET } from '../constants/storage-key.constants.ts';
import { appStorage } from '../utils/app-local-storage';
import type { PluginMarketSource } from '../types/plugin-market.types.ts';

/** 插件市场源列表 store 状态 */
interface PluginMarketState {
  /** 插件源列表（内置官方源恒在首位，自定义源按添加时间正序） */
  sources: PluginMarketSource[];
}

/** 添加源的结果 */
export interface PluginMarketAddResult {
  /** 是否添加成功 */
  ok: boolean;
  /** 失败原因（成功时为空串） */
  error: string;
}

/**
 * 插件市场源列表 store
 *
 * 内置官方源**不持久化删除**：状态初始化与 `ensureBuiltinSource()` 都会把它补回
 * （老版本持久化数据里没有它、或用户数据损坏时，市场也不会失去官方源）。
 */
export const usePluginMarketStore = defineStore('pluginMarket', {
  state: (): PluginMarketState => ({
    sources: [
      {
        repo: PLUGIN_MARKET_BUILTIN_REPO,
        label: PLUGIN_MARKET_BUILTIN_LABEL,
        builtin: true,
        addedAt: '',
      },
    ],
  }),

  actions: {
    /**
     * 确保内置官方源在列（持久化数据缺它时补回首位；幂等）
     */
    ensureBuiltinSource(): void {
      if (this.sources.some((source) => source.builtin)) return;
      const builtin: PluginMarketSource = {
        repo: PLUGIN_MARKET_BUILTIN_REPO,
        label: PLUGIN_MARKET_BUILTIN_LABEL,
        builtin: true,
        addedAt: '',
      };
      this.sources = [builtin, ...this.sources.filter((source) => !source.builtin)];
    },

    /**
     * 添加一个第三方源（去重、限量；归一化在调用方完成，这里只收 `owner/repo`）
     * @param repo 仓库全名 `owner/repo`
     * @param label 展示名（缺省取 repo）
     * @returns 添加结果（失败带面向用户的原因）
     */
    addSource(repo: string, label?: string): PluginMarketAddResult {
      if (this.sources.some((source) => source.repo.toLowerCase() === repo.toLowerCase())) {
        return { ok: false, error: PLUGIN_MARKET_ERR_SOURCE_DUP };
      }
      const customCount = this.sources.filter((source) => !source.builtin).length;
      if (customCount >= PLUGIN_MARKET_SOURCE_MAX) {
        return { ok: false, error: PLUGIN_MARKET_ERR_SOURCE_MAX(PLUGIN_MARKET_SOURCE_MAX) };
      }
      const source: PluginMarketSource = {
        repo,
        label: label?.trim() || repo,
        builtin: false,
        addedAt: new Date().toISOString(),
      };
      // 内置源恒在首位，自定义源追加在后
      this.sources = [...this.sources, source];
      return { ok: true, error: '' };
    },

    /**
     * 删除一个第三方源（内置官方源不可删）
     * @param repo 仓库全名
     * @returns 是否确实移除
     */
    removeSource(repo: string): boolean {
      const before = this.sources.length;
      this.sources = this.sources.filter((source) => source.builtin || source.repo !== repo);
      return this.sources.length < before;
    },
  },

  persist: {
    key: STORAGE_NS_PLUGIN_MARKET,
    storage: appStorage,
  },
});

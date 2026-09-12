import { defineStore } from 'pinia';
import { STORAGE_NS_WATCHLIST } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAME } from '../constants/watchlist.constants';
import type { WatchlistGroup, WatchlistStock } from '../types/watchlist.types';

/** 自选股 store 状态 */
interface WatchlistState {
  /** 自选股分组列表（默认组固定在首位） */
  groups: WatchlistGroup[];
}

/**
 * 自选股分组 store（localStorage 持久化，刷新不丢失）
 *
 * 股票以 sh600519 完整符号形态入库，展示层直接消费
 */
export const useWatchlistStore = defineStore('watchlist', {
  state: (): WatchlistState => ({
    groups: [{ id: DEFAULT_GROUP_ID, name: DEFAULT_GROUP_NAME, stocks: [] }],
  }),

  getters: {
    /**
     * 全部分组内自选股符号（去重后的扁平列表）
     * @param state store 状态
     * @returns 符号列表（sh600519 形态）
     */
    allSymbols: (state: WatchlistState): string[] => [
      ...new Set(state.groups.flatMap((group) => group.stocks.map((stock) => stock.symbol))),
    ],
  },

  actions: {
    /**
     * 添加自选股到指定分组（全站按符号去重，已存在则不重复添加）
     * @param stock 自选股条目
     * @param groupId 目标分组 id，缺省加入默认组
     * @returns 是否成功加入（false 表示已存在于任一分组）
     */
    addStock(stock: WatchlistStock, groupId: string = DEFAULT_GROUP_ID): boolean {
      const exists = this.groups.some((group) =>
        group.stocks.some((item) => item.symbol === stock.symbol),
      );
      if (exists) {
        return false;
      }
      const target = this.groups.find((group) => group.id === groupId);
      if (!target) {
        return false;
      }
      target.stocks.push(stock);
      this.$persist();
      return true;
    },

    /**
     * 从指定分组移除自选股
     * @param groupId 分组 id
     * @param symbol 待移除的股票符号
     */
    removeStock(groupId: string, symbol: string): void {
      const target = this.groups.find((group) => group.id === groupId);
      if (!target) {
        return;
      }
      target.stocks = target.stocks.filter((stock) => stock.symbol !== symbol);
      this.$persist();
    },

    /**
     * 拖拽排序：把分组内某位置的股票移动到目标位置（其余条目顺序平移）
     * @param groupId 分组 id
     * @param fromIndex 拖起条目下标
     * @param toIndex 放置目标下标
     */
    reorderStock(groupId: string, fromIndex: number, toIndex: number): void {
      const target = this.groups.find((group) => group.id === groupId);
      if (!target) {
        return;
      }
      const boundedFrom = Math.max(0, Math.min(fromIndex, target.stocks.length - 1));
      const boundedTo = Math.max(0, Math.min(toIndex, target.stocks.length - 1));
      if (boundedFrom === boundedTo) {
        return;
      }
      const [moved] = target.stocks.splice(boundedFrom, 1);
      target.stocks.splice(boundedTo, 0, moved);
      this.$persist();
    },

    /**
     * 新建自定义分组
     * @param name 分组名称
     * @returns 新建的分组对象
     */
    addGroup(name: string): WatchlistGroup {
      const group: WatchlistGroup = {
        id: crypto.randomUUID(),
        name,
        stocks: [],
      };
      this.groups.push(group);
      this.$persist();
      return group;
    },

    /**
     * 删除自定义分组（默认组受保护不可删除）
     * @param groupId 分组 id
     */
    removeGroup(groupId: string): void {
      if (groupId === DEFAULT_GROUP_ID) {
        return;
      }
      this.groups = this.groups.filter((group) => group.id !== groupId);
      this.$persist();
    },
  },

  persist: {
    key: STORAGE_NS_WATCHLIST,
    storage: appStorage,
    // 调试期开启，验证插件确实在读写；生产可移除
    debug: import.meta.env.DEV,
  },
});

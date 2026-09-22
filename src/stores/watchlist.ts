import { defineStore } from 'pinia';
import { STORAGE_NS_WATCHLIST } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import {
  DEFAULT_GROUP_ID,
  DEFAULT_GROUP_NAME,
  WATCHLIST_SYMBOL_PATTERN,
} from '../constants/watchlist.constants';
import { toFullSymbol } from '../utils/to-full-symbol';
import { repairWatchlistGroups } from '../utils/repair-watchlist-groups';
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

    /**
     * 某只票当前所在的分组 id 列表（分组归属弹窗的初始勾选态）
     *
     * 取函数形态：归属随参数变化，调用方传入符号即时求值
     * @param state store 状态
     * @returns 接收符号、返回该票所在分组 id 列表的函数
     */
    groupIdsOfSymbol:
      (state: WatchlistState) =>
      (symbol: string): string[] => {
        const normalized = toFullSymbol(symbol);
        return state.groups
          .filter((group) => group.stocks.some((stock) => stock.symbol === normalized))
          .map((group) => group.id);
      },
  },

  actions: {
    /**
     * 添加自选股到指定分组（**按分组去重**：同一只票可以同时属于多个分组，
     * 查重只在目标分组内进行，加到别的分组不受影响）
     * @param stock 自选股条目
     * @param groupId 目标分组 id，缺省加入默认组
     * @returns 是否成功加入（false = 目标分组内已有 / 分组不存在 / 符号非法）
     */
    addStock(stock: WatchlistStock, groupId: string = DEFAULT_GROUP_ID): boolean {
      const symbol = toFullSymbol(stock.symbol);
      if (!WATCHLIST_SYMBOL_PATTERN.test(symbol)) {
        return false;
      }
      const target = this.groups.find((group) => group.id === groupId);
      if (!target) {
        return false;
      }
      const exists = target.stocks.some((item) => item.symbol === symbol);
      if (exists) {
        return false;
      }
      target.stocks.push({ ...stock, symbol });
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

    /**
     * 把同一只股票一次性加入多个分组（弹窗勾选确认后调用）
     * @param stock 自选股条目
     * @param groupIds 目标分组 id 列表
     * @returns 实际新增成功的分组 id 列表
     */
    addStockToGroups(stock: WatchlistStock, groupIds: string[]): string[] {
      const added: string[] = [];
      for (const groupId of groupIds) {
        if (this.addStock(stock, groupId)) {
          added.push(groupId);
        }
      }
      return added;
    },

    /**
     * 一次性从所有分组移除指定股票（弹窗「删除全部」确认后调用）
     * @param symbol 待移除的股票符号
     */
    removeStockFromAllGroups(symbol: string): void {
      const normalized = toFullSymbol(symbol);
      for (const group of this.groups) {
        const before = group.stocks.length;
        group.stocks = group.stocks.filter((stock) => stock.symbol !== normalized);
        if (group.stocks.length !== before) {
          this.$persist();
        }
      }
    },

    /**
     * 按目标分组集合同步某只票的归属（自选股表格「编辑」弹窗确认后调用）
     *
     * 与 `addStockToGroups` 的区别：这是**幂等同步**而不是只做添加 ——
     * 在 `groupIds` 里而组内没有则加入，不在 `groupIds` 里而组内有则移除，
     * 因此「取消勾选」也能生效；传空数组 = 从全部分组移除（等于删自选）。
     * 无论归属是否变化，都保留原有条目的 `addedAt`（只更新名称）。
     * @param stock 自选股条目（用于加入新分组时播种名称）
     * @param groupIds 目标分组 id 列表（勾选结果）
     */
    syncStockGroups(stock: WatchlistStock, groupIds: string[]): void {
      const symbol = toFullSymbol(stock.symbol);
      if (!WATCHLIST_SYMBOL_PATTERN.test(symbol)) {
        return;
      }
      const wanted = new Set(groupIds);
      let changed = false;
      for (const group of this.groups) {
        const index = group.stocks.findIndex((item) => item.symbol === symbol);
        if (wanted.has(group.id)) {
          if (index < 0) {
            group.stocks.push({ ...stock, symbol });
            changed = true;
          } else if (group.stocks[index].name !== stock.name) {
            // 名称可能因上游改名而变化，同步时顺手刷新（symbol 与顺序不动）
            group.stocks[index].name = stock.name;
            changed = true;
          }
        } else if (index >= 0) {
          group.stocks.splice(index, 1);
          changed = true;
        }
      }
      if (changed) {
        this.$persist();
      }
    },

    /**
     * 修复持久化数据里的历史脏条目（载入时自动执行，见 utils/repair-watchlist-groups）
     * @returns 是否发生了修改（true 时需要回写持久化）
     */
    repairLoadedGroups(): boolean {
      const { groups, changed } = repairWatchlistGroups(this.groups);
      if (changed) {
        this.groups = groups;
      }
      return changed;
    },
  },

  persist: {
    key: STORAGE_NS_WATCHLIST,
    storage: appStorage,
    // 调试期开启，验证插件确实在读写；生产可移除
    debug: import.meta.env.DEV,
    /**
     * 水合后清理历史脏数据（签名由 pinia-plugin-persistedstate 提供：
     * 钩子早于 store 实例被业务代码消费，动作通过 $persist 回写）
     * @param context 持久化上下文（含当前 store 实例）
     */
    afterHydrate: (context) => {
      const store = context.store as unknown as { repairLoadedGroups: () => boolean };
      if (store.repairLoadedGroups()) {
        context.store.$persist();
      }
    },
  },
});


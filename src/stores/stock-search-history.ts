import { defineStore } from 'pinia';
import { SEARCH_HISTORY_MAX } from '../constants/search.constants';
import { STORAGE_NS_STOCK_SEARCH } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import type { SearchResult } from '../types/stock-quote.types';

/** 标的搜索历史 store 状态 */
interface StockSearchHistoryState {
  /** 用户确认过的标的（最新在前） */
  items: SearchResult[];
}

/**
 * 标的搜索历史：记录用户在标的搜索弹窗里**确认选中**过的标的
 *
 * 全站共用一个搜索弹窗（`components/business/StockSearchModal.vue`）——
 * 顶栏搜索 / 自选股添加 / 速记关联股票都走它，因此共用同一份历史：
 * 弹窗打开且输入框为空时在列表区展示「上次搜索」，点击即再次确认该标的。
 * 持久化落在 `whf:app` 整包的 `stockSearch` 命名空间下（与其它 store 同一套存储）。
 */
export const useStockSearchHistoryStore = defineStore('stock-search-history', {
  state: (): StockSearchHistoryState => ({ items: [] }),

  actions: {
    /**
     * 记录一次确认选中：同标的去重前置顶，超出上限丢弃最旧一条
     * @param result 用户确认的搜索结果
     */
    remember(result: SearchResult): void {
      this.items = [result, ...this.items.filter((item) => item.code !== result.code)].slice(
        0,
        SEARCH_HISTORY_MAX,
      );
    },
  },

  persist: {
    key: STORAGE_NS_STOCK_SEARCH,
    storage: appStorage,
  },
});

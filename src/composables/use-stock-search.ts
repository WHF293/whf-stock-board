import { ref, watch } from 'vue';
import { useDebounceFn } from '@vueuse/core';
import { searchStocks } from '../api/search.api';
import { SEARCH_DEBOUNCE_MS, SEARCH_MIN_KEYWORD_LENGTH } from '../constants/search.constants';
import { handleSdkError } from '../utils/handle-sdk-error';
import type { SearchResult } from '../types/stock-quote.types';

/**
 * 标的搜索（防抖 300ms，关键词 >= 2 字符才触发，避免上游被无效请求轰炸）
 *
 * 失败只降级记录并清空结果，不打断输入
 * @returns keyword 关键词（双向绑定）；results 搜索结果；searching 是否请求中
 */
export const useStockSearch = () => {
  const keyword = ref('');
  const results = ref<SearchResult[]>([]);
  const searching = ref(false);

  /** 执行一次搜索 */
  const doSearch = async (): Promise<void> => {
    const trimmed = keyword.value.trim();
    if (trimmed.length < SEARCH_MIN_KEYWORD_LENGTH) {
      results.value = [];
      return;
    }
    searching.value = true;
    try {
      results.value = await searchStocks(trimmed);
    } catch (error) {
      results.value = [];
      console.error('[use-stock-search]', handleSdkError(error));
    } finally {
      searching.value = false;
    }
  };

  const debouncedSearch = useDebounceFn(doSearch, SEARCH_DEBOUNCE_MS);
  watch(keyword, () => {
    void debouncedSearch();
  });

  return { keyword, results, searching };
};

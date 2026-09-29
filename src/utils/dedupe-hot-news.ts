import type { HotNewsItem } from '@/api/news.api';
import { NEWS_ANALYSIS_MAX_ITEMS } from '@/constants/agent-ask.constants';

/**
 * 新闻条目去重限量（AI 分析前置）
 *
 * 去掉无标题占位条目与跨通道重复（oid 键），并限量到单次分析携带上限 ——
 * 正文抓取与清单拼行都以这份列表为准，避免已加载的长列表把抓取拖到分钟级
 * @param items 新闻条目（可跨源混入重复）
 * @returns 去重限量后的条目（保持原顺序）
 */
export const dedupeHotNews = (items: readonly HotNewsItem[]): HotNewsItem[] => {
  const seen = new Set<string>();
  const result: HotNewsItem[] = [];
  for (const item of items) {
    if (!item.title || seen.has(item.oid)) continue;
    seen.add(item.oid);
    result.push(item);
    if (result.length >= NEWS_ANALYSIS_MAX_ITEMS) break;
  }
  return result;
};

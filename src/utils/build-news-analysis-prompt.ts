import type { HotNewsItem } from '@/api/news.api';
import {
  NEWS_ANALYSIS_ITEM_LINE_TEMPLATE,
  NEWS_ANALYSIS_MAX_CHARS,
  NEWS_ANALYSIS_MAX_ITEMS,
  NEWS_ANALYSIS_PROMPT_TEMPLATE,
  NEWS_ANALYSIS_SUMMARY_MAX_CHARS,
} from '@/constants/agent-ask.constants';

/**
 * 把热点新闻列表组装成「AI 总结」提示词
 *
 * 去 oid 重复 → 单行模板拼接（摘要截断防单条过长）→ 整体截断 → 填入提示词模板。
 * 空列表返回空串，由调用方提示「暂无可总结的新闻」。
 * @param items 当前展示的新闻条目（可跨源混入重复，内部去重）
 * @returns 提示词；无有效条目返回空串
 */
export const buildNewsAnalysisPrompt = (items: readonly HotNewsItem[]): string => {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const item of items) {
    if (!item.title || seen.has(item.oid)) continue;
    seen.add(item.oid);
    if (lines.length >= NEWS_ANALYSIS_MAX_ITEMS) break;
    const summary = item.summary.length > NEWS_ANALYSIS_SUMMARY_MAX_CHARS
      ? item.summary.slice(0, NEWS_ANALYSIS_SUMMARY_MAX_CHARS) + '…'
      : item.summary;
    lines.push(
      NEWS_ANALYSIS_ITEM_LINE_TEMPLATE.replace('{media}', item.media || '未知来源')
        .replace('{title}', item.title)
        .replace('{summary}', summary),
    );
  }
  if (lines.length === 0) return '';
  let news = lines.join('\n');
  if (news.length > NEWS_ANALYSIS_MAX_CHARS) {
    news = news.slice(0, NEWS_ANALYSIS_MAX_CHARS) + '\n…（已截断）';
  }
  return NEWS_ANALYSIS_PROMPT_TEMPLATE.replace('{news}', news);
};

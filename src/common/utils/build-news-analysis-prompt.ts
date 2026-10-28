import type { HotNewsItem } from '@/common/api/news.api';
import {
  NEWS_ANALYSIS_ITEM_LINE_TEMPLATE,
  NEWS_ANALYSIS_MAX_CHARS,
  NEWS_ANALYSIS_MAX_ITEMS,
  NEWS_ANALYSIS_PROMPT_TEMPLATE,
} from '@/common/constants/agent-ask.constants';

/**
 * 把单个新闻源当前栏目的热点新闻组装成「AI 分析」提示词（轻量模式）
 *
 * 只投递「标题 + 链接」清单，正文不由页面预抓——提示词指示 Agent 用
 * fetch_news_content 工具按需抓取关键条目正文后再下结论。
 * 去 oid 重复 → 逐条拼行 → 超整体上限时从尾部丢整条并注明（不截半行，保住每条的标题）。
 * 空列表返回空串，由调用方提示「暂无可总结的新闻」。
 * @param items 新闻条目（同源内可能混入重复，内部去重）
 * @param sourceLabel 新闻源展示名（如「财联社」，填入提示词）
 * @returns 提示词；无有效条目返回空串
 */
export const buildNewsAnalysisPrompt = (
  items: readonly HotNewsItem[],
  sourceLabel: string,
): string => {
  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const item of items) {
    if (!item.title || seen.has(item.oid)) continue;
    seen.add(item.oid);
    total += 1;
    if (lines.length < NEWS_ANALYSIS_MAX_ITEMS) {
      lines.push(
        NEWS_ANALYSIS_ITEM_LINE_TEMPLATE.replace('{media}', item.media || '未知来源')
          .replace('{title}', item.title)
          .replace('{link}', item.url),
      );
    }
  }
  if (lines.length === 0) return '';
  let news = lines.join('\n');
  if (news.length > NEWS_ANALYSIS_MAX_CHARS) {
    while (news.length > NEWS_ANALYSIS_MAX_CHARS && lines.length > 1) {
      lines.pop();
      news = lines.join('\n');
    }
    const dropped = total - lines.length;
    news += dropped > 0 ? `\n…（因长度限制另有 ${dropped} 条未纳入）` : '\n…（已截断）';
  }
  return NEWS_ANALYSIS_PROMPT_TEMPLATE.replace('{source}', sourceLabel).replace('{news}', news);
};

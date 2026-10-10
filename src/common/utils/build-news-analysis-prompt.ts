import type { HotNewsItem } from '@/common/api/news.api';
import {
  NEWS_ANALYSIS_BODY_MAX_CHARS,
  NEWS_ANALYSIS_ITEM_LINE_TEMPLATE,
  NEWS_ANALYSIS_ITEM_LINE_WITH_BODY_TEMPLATE,
  NEWS_ANALYSIS_MAX_CHARS,
  NEWS_ANALYSIS_MAX_ITEMS,
  NEWS_ANALYSIS_PROMPT_TEMPLATE,
  NEWS_ANALYSIS_SUMMARY_MAX_CHARS,
} from '@/common/constants/agent-ask.constants';

/** 抓到的正文表（url → 正文文本；空串 = 该条抓取失败，仅标题 + 摘要分析） */
export type NewsBodiesMap = ReadonlyMap<string, string>;

/**
 * 截断文本（超长补省略号）
 * @param text 原文本
 * @param max 最大字符数
 * @returns 截断后的文本
 */
const truncate = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max)}…` : text;

/**
 * 组装单条新闻清单行：有正文用正文（截断到上限），否则回退摘要，
 * 连摘要也没有的只保留标题 —— 标题与正文可能不符，正文可用时必须优先给模型
 * @param item 新闻条目
 * @param bodies 正文表（url 键）
 * @returns 单行文本
 */
const toNewsLine = (item: HotNewsItem, bodies: NewsBodiesMap): string => {
  const media = item.media || '未知来源';
  const body = bodies.get(item.url) ?? '';
  if (body !== '') {
    return NEWS_ANALYSIS_ITEM_LINE_WITH_BODY_TEMPLATE.replace('{media}', media)
      .replace('{title}', item.title)
      .replace('{body}', truncate(body, NEWS_ANALYSIS_BODY_MAX_CHARS));
  }
  if (item.summary !== '') {
    return NEWS_ANALYSIS_ITEM_LINE_TEMPLATE.replace('{media}', media)
      .replace('{title}', item.title)
      .replace('{summary}', truncate(item.summary, NEWS_ANALYSIS_SUMMARY_MAX_CHARS));
  }
  return `【${media}】${item.title}`;
};

/**
 * 把热点新闻列表组装成「AI 总结」提示词
 *
 * 去 oid 重复 → 逐条按「正文优先、摘要回退、仅标题兜底」拼行 →
 * 超整体上限时从尾部丢整条并注明（不截半行，保住每条的标题）→ 填入模板。
 * 空列表返回空串，由调用方提示「暂无可总结的新闻」。
 * @param items 新闻条目（可跨源混入重复，内部去重）
 * @param bodies 抓取到的正文表（url 键；不传 = 全部按标题 + 摘要分析）
 * @returns 提示词；无有效条目返回空串
 */
export const buildNewsAnalysisPrompt = (
  items: readonly HotNewsItem[],
  bodies: NewsBodiesMap = new Map(),
): string => {
  const seen = new Set<string>();
  const lines: string[] = [];
  let total = 0;
  for (const item of items) {
    if (!item.title || seen.has(item.oid)) continue;
    seen.add(item.oid);
    total += 1;
    if (lines.length < NEWS_ANALYSIS_MAX_ITEMS) {
      lines.push(toNewsLine(item, bodies));
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
  return NEWS_ANALYSIS_PROMPT_TEMPLATE.replace('{news}', news);
};

/**
 * 白皮书搜索索引构建与检索（官网文档页用）
 *
 * 与客户端 WhitepaperView 的搜索同源同款：同一份分词 / 匹配 / 摘要工具
 * （src/common/utils/whitepaper-search.ts），索引拆条口径一致——
 * 章节标题、引导语、内容块逐条拆分；表格按行拆、名词 term 与 desc 合成一条。
 */
import type { GuideChapter } from '../../common/types/whitepaper.types';
import { buildSnippet, matchAll, type HighlightSegment } from '../../common/utils/whitepaper-search';

/** 搜索索引条目：白皮书中一处可定位的文本 */
export interface WhitepaperSearchDoc {
  /** 所属章节 id（跳转定位用） */
  chapterId: string;
  /** 所属章节标题（结果分组标题） */
  chapterTitle: string;
  /** 来源标签（如「步骤 2」「名词 · 指数卡」） */
  label: string;
  /** 完整原文 */
  text: string;
}

/** 命中条目：索引条目 + 高亮摘要 */
export interface WhitepaperSearchHit extends WhitepaperSearchDoc {
  /** 命中摘要（高亮分段） */
  snippet: HighlightSegment[];
}

/** 命中分组（按章节归拢，保持文档顺序） */
export interface WhitepaperSearchGroup {
  /** 章节 id */
  chapterId: string;
  /** 章节标题 */
  chapterTitle: string;
  /** 该章节命中的条目 */
  hits: WhitepaperSearchHit[];
}

/** 检索结果：分组 + 总命中数 */
export interface WhitepaperSearchResult {
  groups: WhitepaperSearchGroup[];
  hitCount: number;
}

/**
 * 构建全文搜索索引
 * @param chapters 白皮书章节（单源数据）
 * @returns 扁平索引（顺序即文档顺序）
 */
export function buildWhitepaperSearchDocs(chapters: readonly GuideChapter[]): WhitepaperSearchDoc[] {
  const docs: WhitepaperSearchDoc[] = [];
  for (const chapter of chapters) {
    docs.push({ chapterId: chapter.id, chapterTitle: chapter.title, label: '章节', text: chapter.title });
    if (chapter.intro) {
      docs.push({ chapterId: chapter.id, chapterTitle: chapter.title, label: '引导语', text: chapter.intro });
    }
    chapter.blocks.forEach((block, blockIndex) => {
      const blockNo = blockIndex + 1;
      if (block.type === 'text') {
        docs.push(doc(chapter, '正文', block.text));
      } else if (block.type === 'list') {
        block.items.forEach((item, i) => docs.push(doc(chapter, `要点 ${i + 1}`, item)));
      } else if (block.type === 'steps') {
        block.items.forEach((item, i) => docs.push(doc(chapter, `步骤 ${i + 1}`, item)));
      } else if (block.type === 'defs') {
        block.items.forEach((item) => docs.push(doc(chapter, `名词 · ${item.term}`, `${item.term}：${item.desc}`)));
      } else if (block.type === 'tip') {
        docs.push(doc(chapter, `提示 ${blockNo}`, block.text));
      } else if (block.type === 'code') {
        docs.push(doc(chapter, `代码 ${blockNo}`, block.text));
      } else if (block.type === 'image') {
        if (block.caption) docs.push(doc(chapter, `图 ${blockNo}`, block.caption));
      } else {
        block.rows.forEach((row) => docs.push(doc(chapter, row[0] ?? '表格', row.join(' · '))));
      }
    });
  }
  return docs;
}

/**
 * 全文检索：命中全部词条的索引条目按章节归拢（保持文档顺序）
 * @param docs 索引（buildWhitepaperSearchDocs 的产物）
 * @param terms 词条（parseQuery 的结果）
 * @returns 分组与总命中数（未截断，截断由视图按阈值处理）
 */
export function searchWhitepaper(docs: readonly WhitepaperSearchDoc[], terms: readonly string[]): WhitepaperSearchResult {
  if (terms.length === 0) return { groups: [], hitCount: 0 };
  const groups: WhitepaperSearchGroup[] = [];
  const byChapter = new Map<string, WhitepaperSearchGroup>();
  for (const item of docs) {
    if (!matchAll(item.text, [...terms])) continue;
    let group = byChapter.get(item.chapterId);
    if (!group) {
      group = { chapterId: item.chapterId, chapterTitle: item.chapterTitle, hits: [] };
      byChapter.set(item.chapterId, group);
      groups.push(group);
    }
    group.hits.push({ ...item, snippet: buildSnippet(item.text, [...terms]) });
  }
  return { groups, hitCount: groups.reduce((sum, group) => sum + group.hits.length, 0) };
}

/**
 * 构造一条索引条目
 * @param chapter 所属章节
 * @param label 来源标签
 * @param text 原文
 * @returns 索引条目
 */
function doc(chapter: GuideChapter, label: string, text: string): WhitepaperSearchDoc {
  return { chapterId: chapter.id, chapterTitle: chapter.title, label, text };
}

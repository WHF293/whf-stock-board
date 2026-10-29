/**
 * 白皮书正文内「章节跳转链接」的解析
 *
 * 白皮书正文是纯文本单源，跨章节引用用行内标记 `[文案](#章节id)` 书写；
 * 渲染层（DocsView）把它拆成文本段与链接段，链接段接管点击——选中对应章节并同步地址栏，
 * 点击行为与左侧目录点选完全一致（目标章节在其他 Tab 时自动切 Tab）。
 */

/** 解析后的行内片段（chapterId 缺省 = 纯文本段） */
export interface ChapterLinkSegment {
  /** 片段文本 */
  text: string;
  /** 链接指向的章节 id（纯文本段没有该字段） */
  chapterId?: string;
}

/** 行内链接语法：`[文案](#章节id)`（章节 id 与 GuideChapter.id 同口径） */
const CHAPTER_LINK_PATTERN = /\[([^\]]+)\]\(#([a-z0-9][a-z0-9-]*)\)/g;

/**
 * 把正文文本拆成文本段与章节链接段
 * @param text 原文（可含若干 `[文案](#章节id)` 标记）
 * @returns 按出现顺序的片段数组（顺序拼接等于原文）
 */
export function parseChapterLinks(text: string): ChapterLinkSegment[] {
  const segments: ChapterLinkSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(CHAPTER_LINK_PATTERN)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: match[1] ?? '', chapterId: match[2] ?? '' });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

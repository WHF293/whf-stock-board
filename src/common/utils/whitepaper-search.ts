/**
 * 白皮书关键字搜索的纯文本工具
 *
 * 只处理字符串，不感知白皮书的数据结构（索引构建与分组在视图侧完成），
 * 这样「分词 → 匹配 → 高亮 → 摘要」四段逻辑可以脱离 Vue 单独跑单测。
 */

/** 高亮片段：一段原文 + 是否为命中关键字 */
export interface HighlightSegment {
  /** 片段文本（保留原文大小写） */
  text: string;
  /** 是否为命中的关键字 */
  hit: boolean;
}

/** 正则元字符转义（用户可能输入 `(`、`*`、`\|` 等） */
const REGEXP_META = /[.*+?^${}()|[\]\\]/g;

/**
 * 转义正则元字符
 * @param raw 原始字符串
 * @returns 可安全嵌入正则的字符串
 */
const escapeRegExp = (raw: string): string => raw.replace(REGEXP_META, '\\$&');

/**
 * 把输入串切成词条：空白分词、去空、小写化、按输入顺序去重
 * @param raw 用户输入
 * @returns 词条数组（全部小写；无有效词条时为 []）
 */
export function parseQuery(raw: string): string[] {
  const terms: string[] = [];
  for (const piece of raw.toLowerCase().split(/\s+/)) {
    if (piece.length > 0 && !terms.includes(piece)) terms.push(piece);
  }
  return terms;
}

/**
 * 文本是否命中全部词条（大小写不敏感，多词条为「与」关系）
 * @param text 待检文本
 * @param terms 词条（parseQuery 的结果）
 * @returns 命中为 true；词条为空时恒为 false
 */
export function matchAll(text: string, terms: string[]): boolean {
  if (terms.length === 0) return false;
  const lower = text.toLowerCase();
  return terms.every((term) => lower.includes(term));
}

/**
 * 按词条把文本切成高亮片段（用于模板逐段渲染，避免 v-html 注入）
 * @param text 原文
 * @param terms 词条
 * @returns 片段数组；无命中时返回单个非高亮片段
 */
export function splitHighlight(text: string, terms: string[]): HighlightSegment[] {
  if (terms.length === 0 || text.length === 0) return [{ text, hit: false }];
  const pattern = new RegExp(terms.map(escapeRegExp).join('|'), 'gi');
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) segments.push({ text: text.slice(cursor, start), hit: false });
    segments.push({ text: match[0], hit: true });
    cursor = start + match[0].length;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments.length > 0 ? segments : [{ text, hit: false }];
}

/**
 * 生成命中摘要：命中位置尽量靠前居中，超长时两端补省略号
 * @param text 完整原文
 * @param terms 词条
 * @param maxLength 摘要最大字符数（默认 96）
 * @returns 高亮片段数组（首尾可能带 `…`）
 */
export function buildSnippet(text: string, terms: string[], maxLength = 96): HighlightSegment[] {
  if (text.length <= maxLength) return splitHighlight(text, terms);

  // 取最早出现的词条位置作为窗口中心；命中在尾部时窗口仍要贴住末尾
  const lower = text.toLowerCase();
  let firstHit = -1;
  for (const term of terms) {
    const index = lower.indexOf(term);
    if (index >= 0 && (firstHit < 0 || index < firstHit)) firstHit = index;
  }
  const desired = firstHit < 0 ? 0 : Math.max(0, firstHit - Math.floor(maxLength / 3));
  const start = Math.min(desired, Math.max(0, text.length - maxLength));

  const segments = splitHighlight(text.slice(start, start + maxLength), terms);
  if (start > 0) segments.unshift({ text: '…', hit: false });
  if (start + maxLength < text.length) segments.push({ text: '…', hit: false });
  return segments;
}

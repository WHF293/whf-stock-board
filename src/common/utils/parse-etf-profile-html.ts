import type { EtfProfileRecord } from '../types/etf.types.ts';

/**
 * 天天基金 f10「基金概况」页（jbgk_<code>.html）HTML 解析
 *
 * 页面主体是 `<table class="info ...">` 里的 `<th>字段名</th><td>字段值</td>` 序列
 * （上游有 `<td>` 未闭合直接跟 `<th>` 的脏 HTML，故按 `<th>` 切段取值而非逐对匹配）；
 * 「投资目标」在表格外的 `.boxitem` 块中，单独按 label 定位
 */

/** HTML 实体解码表（概况页出现的有限几种） */
const ENTITY_MAP: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

/** 概况表字段名 → 记录键的映射（键序即展示顺序参考，实际展示由组件字段组决定） */
const LABEL_KEY_MAP: readonly (readonly [label: string, key: keyof EtfProfileRecord])[] = [
  ['基金全称', 'fullName'],
  ['基金类型', 'fundType'],
  ['发行日期', 'issueDate'],
  ['成立日期/规模', 'setupInfo'],
  ['净资产规模', 'netAssetScale'],
  ['份额规模', 'shareScale'],
  ['基金管理人', 'manager'],
  ['基金托管人', 'custodian'],
  ['基金经理人', 'fundManager'],
  ['成立来分红', 'dividend'],
  ['管理费率', 'mgmtFeeRate'],
  ['托管费率', 'custodyFeeRate'],
  ['销售服务费率', 'salesServiceFeeRate'],
  ['最高认购费率', 'maxSubscribeFeeRate'],
  ['最高申购费率', 'maxPurchaseFeeRate'],
  ['最高赎回费率', 'maxRedeemFeeRate'],
  ['业绩比较基准', 'benchmark'],
  ['跟踪标的', 'trackingTarget'],
];

/**
 * 去标签 + 实体解码 + 压缩空白（概况值都是纯文本）
 * @param html 原始 HTML 片段
 * @returns 纯文本（空白压缩、实体已解码）
 */
const toText = (html: string): string =>
  html
    .replaceAll(/<[^>]*>/g, '')
    .replace(/&(nbsp|amp|lt|gt|quot|#39);/g, (entity) => ENTITY_MAP[entity] ?? entity)
    .replaceAll(/\s+/g, ' ')
    .trim();

/**
 * 解析基金概况页 HTML
 * @param raw 页面原文（UTF-8 解码后）
 * @returns 除 code/fetchedAt 外的概况字段（缺失字段为 null）
 * @throws Error 页面上找不到概况表时抛出（非基金页 / 上游限频）
 */
export const parseEtfProfileHtml = (raw: string): Omit<EtfProfileRecord, 'code' | 'fetchedAt'> => {
  const tableMatch = raw.match(/<table class="info[^"]*"[^>]*>([\s\S]*?)<\/table>/);
  if (!tableMatch) {
    throw new Error('未解析到基金概况表（可能非场内基金或上游限频）');
  }
  const table = tableMatch[1];

  // 按 <th> 切段：每个 th 的值 = 该 </th> 之后到下一个 <th 之前的文本
  const marks: { label: string; start: number }[] = [];
  const thPattern = /<th[^>]*>([\s\S]*?)<\/th>/g;
  let match: RegExpExecArray | null;
  while ((match = thPattern.exec(table)) !== null) {
    marks.push({ label: toText(match[1]), start: match.index + match[0].length });
  }
  const valueByLabel = new Map<string, string | null>();
  for (const [index, mark] of marks.entries()) {
    const nextThAt = table.indexOf('<th', mark.start);
    const end = index + 1 < marks.length && nextThAt >= 0 ? nextThAt : table.length;
    const text = toText(table.slice(mark.start, Math.max(end, mark.start)));
    valueByLabel.set(mark.label, text === '' ? null : text);
  }

  // 投资目标：表格外的 boxitem 长文本块
  const objectiveMatch = raw.match(/投资目标<\/label>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/);
  const objective = objectiveMatch ? toText(objectiveMatch[1]) : null;

  const result: Record<string, string | null> = { objective };
  for (const [label, key] of LABEL_KEY_MAP) {
    result[key] = valueByLabel.get(label) ?? null;
  }
  return result as Omit<EtfProfileRecord, 'code' | 'fetchedAt'>;
};

/**
 * HTML 源码 → 纯文本（正则剥除，无 DOM 依赖，node 环境可跑）
 *
 * 处理链：剥 script / style / noscript / iframe / svg / 注释 → 剥全部标签 →
 * 解码常见 HTML 实体（含数字实体）→ 压缩空白。
 * 供「无 DOM 解析可用时的兜底抽取」与「站点噪声文本参考」使用；
 * 有 DOM 时优先用 extract-news-body（容器级抽取更干净）
 */

/** 需整块剥除的元素与注释（重复内容零价值，先于标签剥除） */
const NOISE_BLOCK_PATTERN =
  /<(script|style|noscript|iframe|svg)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;

/** 全部标签 */
const TAG_PATTERN = /<[^>]+>/g;

/** 常见命名实体映射（小写键） */
const NAMED_ENTITIES: Record<string, string> = {
  nbsp: ' ',
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  ldquo: '「',
  rdquo: '」',
  lsquo: '『',
  rsquo: '』',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  middot: '·',
  copy: '©',
};

/** 命名实体（解码查表，未知实体原样保留） */
const NAMED_ENTITY_PATTERN = /&([a-z]+);/gi;

/** 十进制 / 十六进制数字实体 */
const NUMERIC_ENTITY_PATTERN = /&#(\d+|x[0-9a-f]+);/gi;

/**
 * 解码单个数字实体
 * @param code 十六进制（x 前缀）或十进制码点文本
 * @returns 对应字符；非法码点返回空串
 */
const decodeNumericEntity = (code: string): string => {
  const point = code.startsWith('x') || code.startsWith('X')
    ? Number.parseInt(code.slice(1), 16)
    : Number.parseInt(code, 10);
  if (!Number.isInteger(point) || point < 0 || point > 0x10ffff) return '';
  try {
    return String.fromCodePoint(point);
  } catch {
    return '';
  }
};

/**
 * HTML 源码转纯文本
 * @param html 新闻正文页 HTML 源码
 * @returns 压缩过空白与实体的纯文本（可能含导航噪声；空 HTML 返回空串）
 */
export const htmlToText = (html: string): string =>
  html
    .replace(NOISE_BLOCK_PATTERN, ' ')
    .replace(TAG_PATTERN, ' ')
    .replace(NAMED_ENTITY_PATTERN, (match, name: string) =>
      NAMED_ENTITIES[name.toLowerCase()] ?? match,
    )
    .replace(NUMERIC_ENTITY_PATTERN, (_, code: string) => decodeNumericEntity(code.toLowerCase()))
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 上游数据源识别规则（调试网络面板等处把请求 URL 标注为「腾讯 / 东财 / 同花顺…」）
 *
 * 按主机名后缀匹配（`host === pattern` 或 `host.endsWith('.' + pattern)`），
 * 先命中先得；新增数据源域名时在对应源条目里补 pattern 即可。
 * 域名清单来源：根目录 SERVER_API.md。
 */

/** 单条识别规则：pattern 为可匹配的域名后缀，label 为展示名 */
export interface ApiSourceRule {
  /** 域名后缀（不带点，如 `gtimg.cn`） */
  pattern: string;
  /** 数据源展示名 */
  label: string;
}

/** 识别规则表（顺序即优先级，无交叉域名的场景下顺序无感） */
export const API_SOURCE_RULES: readonly ApiSourceRule[] = [
  { pattern: 'gtimg.cn', label: '腾讯' },
  { pattern: 'qq.com', label: '腾讯' },
  { pattern: 'eastmoney.com', label: '东财' },
  { pattern: 'dfcfw.com', label: '东财' },
  { pattern: '10jqka.com.cn', label: '同花顺' },
  { pattern: 'sina.com.cn', label: '新浪' },
  { pattern: 'sina.cn', label: '新浪' },
  { pattern: 'sinajs.cn', label: '新浪' },
  { pattern: 'cls.cn', label: '财联社' },
  { pattern: 'thepaper.cn', label: '澎湃' },
  { pattern: 'tdx.com.cn', label: '通达信' },
  { pattern: 'xueqiu.com', label: '雪球' },
  { pattern: 'jisilu.cn', label: '集思录' },
  { pattern: 'wsj.com', label: '华尔街见闻' },
  { pattern: 'dj.com', label: '华尔街见闻' },
  { pattern: 'github.com', label: 'GitHub' },
  { pattern: 'githubusercontent.com', label: 'GitHub' },
];

/** 未命中任何规则时的兜底展示名 */
export const API_SOURCE_FALLBACK_LABEL = '其他';

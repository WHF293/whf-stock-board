/**
 * 新闻正文抓取（AI 分析带正文 / Agent fetch_news_content 工具共用）
 */

/** 单条正文抓取超时（毫秒；正文页一次一发，超时即视为抓取失败走标题回退） */
export const NEWS_CONTENT_FETCH_TIMEOUT_MS = 8_000;

/** 抓取结果缓存上限（条；正文发布后不变，会话内按 url 缓存，超出淘汰最旧） */
export const NEWS_CONTENT_CACHE_MAX_ENTRIES = 300;

/** 有效正文最小字符数（低于此值视为没有正文——SPA 空壳 / 反爬拦截页等） */
export const NEWS_CONTENT_MIN_CHARS = 40;

/** 缓存的正文最大字符数（截断防内存膨胀；分析侧再按需截更短） */
export const NEWS_CONTENT_MAX_CHARS = 1_200;

/** 正文解码乱码判定阈值：替换符（U+FFFD）占比超过它视为字符集误码，按失败处理 */
export const NEWS_CONTENT_REPLACEMENT_MAX_RATIO = 0.05;

/** 批量抓正文的并发上限（跨新闻站 HTML 页，与信号扫描同一红线口径） */
export const NEWS_BODY_FETCH_CONCURRENCY = 3;

/** 批量抓正文的相邻请求间隔（毫秒；错峰防新闻站封禁） */
export const NEWS_BODY_FETCH_INTERVAL_MS = 300;

/**
 * 不抓正文的 URL 前缀：这些链接不是原文页（东财快讯上游无 url，
 * 是站内搜索页拼接），抓了也只有搜索页壳，直接按标题 + 摘要分析
 */
export const NEWS_BODY_UNFETCHABLE_URL_PREFIXES: readonly string[] = [
  'https://so.eastmoney.com/news/s',
];

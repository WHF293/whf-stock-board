/**
 * 标的搜索配置
 */
export const SEARCH_DEBOUNCE_MS = 300;
/** 触发搜索的最小关键词长度，避免上游被无效请求轰炸 */
export const SEARCH_MIN_KEYWORD_LENGTH = 2;
/** 「上次搜索」最多保留的标的数量（确认选中时去重前置顶，超出丢弃最旧一条） */
export const SEARCH_HISTORY_MAX = 5;
/** 搜索弹窗：上次搜索分组标题 */
export const SEARCH_HISTORY_TITLE = '上次搜索';

/**
 * 搜索结果市场标识 → 展示文案（Tag）
 *
 * 只登记非 A 股市场（A股 sh/sz/bj 不展示 Tag，保持历史视觉不变）；
 * SearchResult.market 为 SDK 原值（sh / sz / bj / hk / us…）
 */
export const SEARCH_MARKET_LABELS = {
  hk: '港股',
  us: '美股',
} as const;

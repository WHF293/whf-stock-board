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

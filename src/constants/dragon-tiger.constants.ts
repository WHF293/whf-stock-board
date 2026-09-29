/**
 * 龙虎榜 / 大宗交易常量
 */

/** 龙虎榜明细查询区间（自然日） */
export const DRAGON_TIGER_RANGE_DAYS = 7;

/** 大宗交易明细查询区间（自然日） */
export const BLOCK_TRADE_RANGE_DAYS = 7;

// ---------- 大宗交易同花顺源（data.10jqka.com.cn/market/dzjy） ----------

/** 同花顺大宗交易主页地址（GBK HTML，服务端渲染第一页全表） */
export const THS_BLOCK_TRADE_PAGE_URL = 'https://data.10jqka.com.cn/market/dzjy/';

/** 同花顺大宗交易 ajax 翻页地址前缀（后拼 `/page/{n}/ajax/1/free/1/`，按交易日期降序） */
export const THS_BLOCK_TRADE_AJAX_URL =
  'https://data.10jqka.com.cn/market/dzjy/field/enddate/order/desc';

/** 翻页上限（页）：覆盖 7 日通常 3~6 页，留出数倍余量防日期分布异常时打满上游 */
export const THS_BLOCK_TRADE_MAX_PAGES = 30;

/** 同花顺翻页串行请求间隔（毫秒）：同上游错峰，遵守请求频率红线 */
export const THS_REQUEST_GAP_MS = 500;


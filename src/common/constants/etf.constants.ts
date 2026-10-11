/**
 * ETF 持仓股相关的魔法值集中地
 */

/** 天天基金 f10「基金持仓」接口（`FundArchivesDatas.aspx?type=jjcc`，需带站内 Referer） */
export const ETF_JJCC_URL = 'https://fundf10.eastmoney.com/FundArchivesDatas.aspx';

/** jjcc 请求 Referer（缺省时上游 404） */
export const ETF_JJCC_REFERER = 'https://fundf10.eastmoney.com/ccmx.html';

/** 单表持仓行数上限（指数 ETF 全量披露常超 100 行，100 一次拿全） */
export const ETF_JJCC_TOPLINE = 100;

/** 场内基金代码前缀（沪市 5 开头：ETF/LOF/封基；深市 15/16/18：ETF/LOF/分级） */
export const ETF_CODE_PREFIXES = ['5', '15', '16', '18'] as const;

/** 本地缓存自动刷新阈值（毫秒）：持仓按季度披露，超过约一个季度才自动重新抓取 */
export const ETF_HOLDINGS_TTL_MS = 100 * 24 * 60 * 60 * 1000;

/** jjcc 响应体的 JS 变量声明壳前缀（`var apidata={ content:"` …） */
export const ETF_JJCC_CONTENT_PREFIX = 'var apidata={ content:"';

/** jjcc 响应体收尾（`",arryear:` …） */
export const ETF_JJCC_CONTENT_SUFFIX = '",arryear:';

/** 上游数值占位（`-` / 空串统一按缺失处理） */
export const ETF_VALUE_PLACEHOLDER = '-' as const;

/** 涨跌幅/占比的百分比换算基数 */
export const ETF_PERCENT_BASE = 100;

/** 持仓股展示的占比门槛（%）：仅展示占净值比例高于该值重仓股（缓存仍存全量） */
export const ETF_HOLDINGS_MIN_RATIO = 1;

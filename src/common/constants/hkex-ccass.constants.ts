/**
 * 港交所披露易 CCASS 沪深股通持股纪录常量（北向资金流向估算数据源）
 *
 * 2026-11-06 实测：东财自 2024-08 停采北向日度持股后，港交所披露易的
 * 「滬港通及深港通持股紀錄查詢服務」仍在逐日披露全市场北向持股
 * （CCASS 参与者日终合计），这是北向流向估算唯一存活的全市场日度来源：
 * - 查询页：https://www3.hkexnews.hk/sdw/search/mutualmarket.aspx?t=sh|sz（ASP.NET 回发页）
 * - 英文版每行名称内嵌 A 股代码（如 "FORTIOR ... (A #688279)"），免去繁简名映射；
 *   沪市 9xxxx 内部码另有规律（9 + A 股代码后四位 → 60xxxx）作兜底
 * - 纪录仅保留最近 12 个月
 */

/** CCASS 查询页地址（t=sh 沪股通 / t=sz 深股通） */
export const HKEX_CCASS_PAGE_URL = 'https://www3.hkexnews.hk/sdw/search/mutualmarket.aspx';

/** CCASS 日期参数格式（YYYY/MM/DD，页面表单口径） */
export const HKEX_CCASS_DATE_FORMAT_SLASH = '/';

/** CCASS 查询页 ViewState 缓存时长（毫秒；同一页可反复回发不同日期，1 小时足够） */
export const HKEX_CCASS_VIEWSTATE_TTL_MS = 60 * 60 * 1000;

/** 最新交易日探测回退天数（今天起逐日回退找有纪录的日期；周末 / 假日 / 披露延迟兜底） */
export const HKEX_CCASS_LATEST_PROBE_BACK_DAYS = 7;

/** 季末候选日（月-日段，按季度枚举；基线 = 最近一个已过季末） */
export const HKEX_CCASS_QUARTER_END_MONTH_DAYS = ['03-31', '06-30', '09-30', '12-31'] as const;

/** 基线季末无纪录时向前回退的天数上限（季末逢周末 / 节假日顺延） */
export const HKEX_CCASS_BASELINE_FALLBACK_DAYS = 7;

/** 本地快照滚存结构版本（不兼容升级时递增，旧包弃置重建） */
export const HKEX_CCASS_STORE_VERSION = 1;

/** 本地快照滚存日期数上限（季末基线 + 近期交易日；单份快照约 4400 键，控在 localStorage 配额内） */
export const HKEX_CCASS_STORE_MAX_DATES = 8;

/** 估算榜（增持 / 减持）展示条数 */
export const HKEX_CCASS_TOP_MOVER_COUNT = 5;

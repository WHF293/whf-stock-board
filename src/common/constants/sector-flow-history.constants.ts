/**
 * 板块历史净流入（市场榜单-板块净流入 · 历史详情页）常量
 *
 * 数据策略：曲线视图已选行业（勾选，上限 SECTOR_CURVE_MAX_COUNT）的逐日主力净流入
 * 落本地存储渐进累积——盘中进入页签拉新合并，盘后 / 非交易日直接读本地，
 * 首次（板块无历史）一次拉全量（含近五日）。避免每日重复全量请求触发上游封禁。
 */

/** 每板块保留的最大交易日数（约一年；防历史无限膨胀，超出截掉最旧的） */
export const SECTOR_FLOW_HISTORY_MAX_DAYS = 250;

/** 盘中拉新的最小间隔（ms；同日内重复进页 5 分钟内不重复请求，防高频触发风控） */
export const SECTOR_FLOW_HISTORY_MIN_REFRESH_MS = 5 * 60 * 1000;

/** 存储结构版本（结构不兼容变更时递增并做迁移/弃置） */
export const SECTOR_FLOW_HISTORY_STORE_VERSION = 1;

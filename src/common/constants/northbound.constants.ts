/**
 * 沪深港通（北向/南向）资金模块常量
 *
 * 上游口径（2026-10-30 实测，实施期验证点）：
 * - summary / minute 金额单位为**万元**（SDK d.ts 标注「元」有误）；北向净额自
 *   2024-08 起停止实时披露（上游恒回 0），南向净额照常有值
 * - 资金历史走 datacenter `RPT_MUTUAL_DEAL_HISTORY`（stock-sdk 内置过滤列
 *   `BOARD_TYPE` 已被上游移除，SDK history 方法失效，需自行调取）：
 *   金额单位为**百万元**；`MUTUAL_TYPE` 001 沪股通 / 002 港股通(沪) /
 *   003 深股通 / 004 港股通(深) / 005 北向合计
 * - 北向持股明细已改季度披露（`RPT_MUTUAL_HOLDSTOCKNORTH_STA`），排行按最新
 *   一期快照展示，区间增持估计字段不再提供
 * - 北向每日净买额已无公开数据来源（2026-10-30 二次实测：日度持股明细
 *   `RPT_MUTUAL_HOLD_DET` 北向部分停更于 2024-08-16；日度持股排行
 *   `RPT_MUTUAL_STOCK_HOLDRANKS` 仅南向行；估算接口 kamt.gz / kamt.khf 已 404），
 *   页面 UI 收窄为南向口径；北向仅保留季度持股排行与 API / MCP 历史查询
 */

/** 万元 → 元换算系数（summary / minute 上游单位） */
export const NORTHBOUND_WAN_TO_YUAN = 10_000;

/** 百万元 → 元换算系数（资金历史表上游单位） */
export const NORTHBOUND_MILLION_TO_YUAN = 1_000_000;

/** 亿元换算系数（展示分档阈值） */
export const NORTHBOUND_YI_YUAN = 100_000_000;

/** summary + minute 共用轮询间隔（毫秒）：合计 ≤2 req/min，远低于东财红线 */
export const NORTHBOUND_POLLING_INTERVAL_MS = 60_000;

/** 北向持股排行每批展示条数（加载更多） */
export const NORTHBOUND_RANK_PAGE_SIZE = 50;

/** 北向持股排行分页拉取页数上限（每页 500，全市场最新一期约 5000+ 行） */
export const NORTHBOUND_RANK_MAX_PAGES = 12;

/** 北向净买额停止披露日期（MCP 工具口径说明用） */
export const NORTHBOUND_HISTORY_DISCONTINUED_DATE = '2024-08-19';

/** 分时卡空态提示文案（南向非交易时段无数据） */
export const NORTHBOUND_MINUTE_EMPTY_NOTICE = '暂无分时净流入数据';

/** 北向持股季度披露提示文案（排行卡 / 持仓抽屉共用） */
export const NORTHBOUND_RANK_QUARTERLY_NOTICE = '北向持股明细已改为季度披露，此处展示最新一期快照';

/** 历史卡时间范围选项 */
export const NORTHBOUND_HISTORY_RANGE_OPTIONS = [
  { label: '近30日', value: '30d' },
  { label: '近60日', value: '60d' },
  { label: '近120日', value: '120d' },
] as const;

/** 排行卡市场筛选选项 */
export const NORTHBOUND_RANK_MARKET_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '沪市', value: 'shanghai' },
  { label: '深市', value: 'shenzhen' },
] as const;

/** 历史卡范围 → 自然日回溯天数（api 层再 ×1.7 覆盖节假日） */
export const NORTHBOUND_HISTORY_RANGE_DAYS = {
  '30d': 30,
  '60d': 60,
  '120d': 120,
} as const;

import { BOARD_SCORE_BUCKET } from './board-calendar.constants';
import { TREND_COLOR_LEVEL } from './stock-colors.constants';

/**
 * 板块日历详情页（板块成分股 × 交易日 涨跌幅矩阵）常量集中管理
 *
 * 上游：腾讯前复权日 K（`BOARD_CALENDAR_URL.TENCENT_KLINE`，与成交额模块同源）。
 * 为什么不用新浪（`fetchSinaKline`）：新浪日 K **不复权**，除权日相邻收盘价差会被算成
 * 假涨跌幅（10 送 10 那天会显示 -50%）；前复权相邻收盘比 == 交易所口径涨跌幅，
 * 且该比值在前复权基准整体平移时不变，故历史值稳定。
 *
 * 矩阵几何（列宽 / 行高 / 虚拟化参数）同板块日历页，视觉上保持同一套语言。
 */

/* ---------------------------------- 范围 ---------------------------------- */

/**
 * 详情页展示范围（交易日列数）
 *
 * 比板块日历页少了 180 / 全部：矩阵一行一只票、一列一天，请求量 = 成分股数 × 1，
 * 单票一次取满 `BOARD_DETAIL_FETCH_BARS` 根即可覆盖最大档，不再需要更长窗口。
 */
export const BOARD_DETAIL_RANGE = {
  D10: '10',
  D20: '20',
  D30: '30',
  D60: '60',
  D120: '120',
} as const;

/** 展示范围默认值（与板块日历页一致：最近 10 个交易日） */
export const BOARD_DETAIL_RANGE_DEFAULT = BOARD_DETAIL_RANGE.D10;

/** 展示范围选项（BaseTabs） */
export const BOARD_DETAIL_RANGE_OPTIONS = [
  { label: '10天', value: BOARD_DETAIL_RANGE.D10 },
  { label: '20天', value: BOARD_DETAIL_RANGE.D20 },
  { label: '30天', value: BOARD_DETAIL_RANGE.D30 },
  { label: '60天', value: BOARD_DETAIL_RANGE.D60 },
  { label: '120天', value: BOARD_DETAIL_RANGE.D120 },
] as const;

/**
 * 单票一次请求的日 K 根数
 *
 * = 最大档位 120 + 20 根缓冲：窗口内每一天的涨跌幅都要用到「前一根」收盘价，
 * 首日的前收盘必须落在同一次响应里；缓冲同时兜住长停牌（复牌首日的前收盘
 * 可能是一个月前的价）与节假日。
 */
export const BOARD_DETAIL_FETCH_BARS = 140;

/* ---------------------------------- 排序 ---------------------------------- */

/**
 * 排序基准
 *
 * - `date`：按**某一个交易日**的涨跌幅降序（默认取最新交易日，列头可点选其它日）
 * - `cumulative`：按窗口内累计涨跌幅降序
 *
 * 两种口径都满足需求里的「涨跌幅大的在上面，小的在下面」，方向恒为降序。
 */
export const BOARD_DETAIL_SORT = {
  DATE: 'date',
  CUMULATIVE: 'cumulative',
} as const;

/** 排序基准默认值：最新一个交易日 */
export const BOARD_DETAIL_SORT_DEFAULT = BOARD_DETAIL_SORT.DATE;

/** 排序基准选项（BaseTabs） */
export const BOARD_DETAIL_SORT_OPTIONS = [
  { label: '单日涨跌幅', value: BOARD_DETAIL_SORT.DATE },
  { label: '区间累计', value: BOARD_DETAIL_SORT.CUMULATIVE },
] as const;

/* ---------------------------------- 色阶 ---------------------------------- */

/**
 * 图例（7 档涨跌语义色，与矩阵同款）
 *
 * 阈值取自 `TREND_COLOR_LEVEL`（±2 / ±5），与板块热力图对**涨跌幅**的档位完全一致；
 * 与板块日历页的图例区别只在被映射的量（那边是得分率）。
 */
export const BOARD_DETAIL_LEGEND = [
  { bucket: BOARD_SCORE_BUCKET.UP_STRONG, label: '大涨', hint: `≥ +${TREND_COLOR_LEVEL.STRONG}%` },
  {
    bucket: BOARD_SCORE_BUCKET.UP,
    label: '上涨',
    hint: `+${TREND_COLOR_LEVEL.MEDIUM}% ~ +${TREND_COLOR_LEVEL.STRONG}%`,
  },
  { bucket: BOARD_SCORE_BUCKET.UP_LIGHT, label: '微涨', hint: `0 ~ +${TREND_COLOR_LEVEL.MEDIUM}%` },
  { bucket: BOARD_SCORE_BUCKET.FLAT, label: '平盘', hint: '= 0' },
  {
    bucket: BOARD_SCORE_BUCKET.DOWN_LIGHT,
    label: '微跌',
    hint: `-${TREND_COLOR_LEVEL.MEDIUM}% ~ 0`,
  },
  {
    bucket: BOARD_SCORE_BUCKET.DOWN,
    label: '下跌',
    hint: `-${TREND_COLOR_LEVEL.STRONG}% ~ -${TREND_COLOR_LEVEL.MEDIUM}%`,
  },
  { bucket: BOARD_SCORE_BUCKET.DOWN_STRONG, label: '大跌', hint: `≤ -${TREND_COLOR_LEVEL.STRONG}%` },
] as const;

/* ---------------------------------- 尺寸 ---------------------------------- */

/** 左侧个股列宽度（像素；含名称 + 代码） */
export const BOARD_DETAIL_NAME_COL_WIDTH = 180;

/** 日期列宽度（像素；单元格只放一个涨跌幅，比板块日历页窄） */
export const BOARD_DETAIL_COL_WIDTH = 78;

/** 数据行高度（像素；固定高度是横向虚拟化 + 行懒加载的前提） */
export const BOARD_DETAIL_ROW_HEIGHT = 30;

/** 表头行高度（像素；两行文案：日期 + 星期） */
export const BOARD_DETAIL_HEAD_HEIGHT = 44;

/** 横向虚拟化的列过扫描数量（视窗左右各多渲染几列，避免滚动白边） */
export const BOARD_DETAIL_COL_OVERSCAN = 4;

/** 行懒加载每批放行行数（大板块 500+ 只成分股，一次性渲染会卡首帧） */
export const BOARD_DETAIL_ROW_CHUNK = 80;

/**
 * 首列单击 / 双击合并窗口（毫秒）
 *
 * 与 `BaseTable` 的 `enableDblclickNav` 同一套语义：首列单击开侧栏、双击进详情整页，
 * 单击延迟这么多毫秒派发，窗口内收到双击就取消（否则双击会先弹一次侧栏再跳页）。
 */
export const BOARD_DETAIL_CLICK_MERGE_MS = 250;

/* -------------------------------- 取数参数 -------------------------------- */

/**
 * 逐票取数的并发上限
 *
 * 一个板块 20 ~ 500 只成分股 = 20 ~ 500 个请求，是本站最重的一次批量取数；
 * 6 是「单板块铺满 ~15s」与「不触发上游反爬」之间的折中（腾讯源比东财宽容）。
 */
export const BOARD_DETAIL_CONCURRENCY = 6;

/**
 * 涨跌幅序列的内存缓存有效期（毫秒）
 *
 * 仅作用于**窗口内含今天**的场景（今天盘中还在变）；
 * 窗口末位早于今天（收盘后 / 周末 / 看历史）时序列不再变化，缓存当天一直有效，
 * 见 `isSeriesUsable`。切板块、切范围都不再重复打上游。
 */
export const BOARD_DETAIL_SERIES_TTL_MS = 3 * 60 * 1_000;

/** 单个板块最多取多少只成分股（防御异常上游：正常板块 20 ~ 520 只） */
export const BOARD_DETAIL_MAX_CONSTITUENTS = 800;

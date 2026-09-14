import type {
  BOARD_CALENDAR_HEAT_BASIS,
  BOARD_CALENDAR_RANGE,
  BOARD_PROFIT_METRIC,
  BOARD_SCORE_BUCKET,
  BOARD_SYNC_STATE_KEY,
} from '../constants/board-calendar.constants';

/**
 * 热门口径（由 BOARD_CALENDAR_HEAT_BASIS const 对象派生）
 */
export type BoardCalendarHeatBasis =
  (typeof BOARD_CALENDAR_HEAT_BASIS)[keyof typeof BOARD_CALENDAR_HEAT_BASIS];

/**
 * 赚钱效应气泡图口径（由 BOARD_PROFIT_METRIC const 对象派生）
 */
export type BoardProfitMetric =
  (typeof BOARD_PROFIT_METRIC)[keyof typeof BOARD_PROFIT_METRIC];

/**
 * 展示范围（由 BOARD_CALENDAR_RANGE const 对象派生）
 */
export type BoardCalendarRange =
  (typeof BOARD_CALENDAR_RANGE)[keyof typeof BOARD_CALENDAR_RANGE];

/**
 * 得分档位（由 BOARD_SCORE_BUCKET const 对象派生）
 */
export type BoardScoreBucket =
  (typeof BOARD_SCORE_BUCKET)[keyof typeof BOARD_SCORE_BUCKET];

/**
 * 增量采集状态键（由 BOARD_SYNC_STATE_KEY const 对象派生）
 */
export type BoardSyncStateKey =
  (typeof BOARD_SYNC_STATE_KEY)[keyof typeof BOARD_SYNC_STATE_KEY];

/* --------------------------------- 落库实体 --------------------------------- */

/**
 * 板块静态档案（board_profile 行）
 */
export interface BoardProfile {
  /** 板块代码（BKxxxx） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 侧栏/行排序位（= SW_LEVEL1_BOARDS 声明顺序） */
  sortOrder: number;
  /** 成分股数（f104 + f105 + f106） */
  consCount: number;
  /** 更新时间戳（毫秒） */
  updatedAt: number;
}

/**
 * 个股 → 申万一级行业映射（board_constituent 行）
 */
export interface BoardConstituent {
  /** 所属一级行业板块代码 */
  boardCode: string;
  /** 6 位股票代码 */
  symbol: string;
  /** 股票名称 */
  stockName: string;
  /** 市场：0 = 深/北，1 = 沪 */
  market: number;
}

/**
 * 板块 × 交易日聚合（board_daily 行）
 */
export interface BoardDailyRow {
  /** 交易日 YYYY-MM-DD */
  tradeDate: string;
  /** 板块代码 */
  boardCode: string;
  /** 板块名称 */
  boardName: string;
  /** 板块涨跌幅（%） */
  changePercent: number | null;
  /** 成交额（元） */
  amount: number | null;
  /** 涨停家数 */
  limitUp: number;
  /** 跌停家数 */
  limitDown: number;
  /** 上涨家数（含涨停） */
  upCount: number;
  /** 下跌家数（含跌停） */
  downCount: number;
  /** 平盘家数 */
  flatCount: number;
  /** 成分股数 */
  consCount: number;
  /** 净额口径原始得分 */
  score: number;
  /** 得分率 = score ÷ consCount */
  scoreRate: number;
  /** 数据级别：1 = 完整快照，0 = 仅回补到涨跌停 */
  dataLevel: number;
  /** 采集时间戳（毫秒） */
  snapshotAt: number;
  /** 是否已定稿（15:00 后首次采集置 true） */
  isFinal: boolean;
}

/**
 * 涨跌停个股明细（board_limit_stock 行）
 */
export interface BoardLimitStock {
  /** 交易日 */
  tradeDate: string;
  /** 归属的一级行业板块代码 */
  boardCode: string;
  /** 6 位股票代码 */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 1 = 涨停，-1 = 跌停 */
  limitType: number;
  /** 涨跌幅（%） */
  changePercent: number | null;
  /** 现价（元；上游给分，已换算） */
  price: number | null;
  /** 成交额（元） */
  amount: number | null;
  /** 换手率（%） */
  turnoverRate: number | null;
  /** 首次封板时间（HHMMSS） */
  sealTime: string | null;
  /** 炸板次数 */
  openTimes: number | null;
  /** 连板数 */
  limitStreak: number | null;
}

/**
 * 采集台账（board_calendar_meta 行）
 */
export interface BoardCalendarMeta {
  /** 交易日 */
  tradeDate: string;
  /** 数据级别：1 = 完整快照，0 = 仅回补到涨跌停 */
  dataLevel: number;
  /** 是否已定稿 */
  isFinal: boolean;
  /** 当日全市场涨停家数 */
  limitUpCnt: number;
  /** 当日全市场跌停家数 */
  limitDownCnt: number;
  /** 成分股映射最近同步时间戳（毫秒，取全表最大值） */
  constituentSyncedAt: number;
  /** 更新时间戳（毫秒） */
  updatedAt: number;
}

/**
 * 交易日轴缓存（board_sync_state 的 `trade_dates` 项）
 *
 * 交易日轴是「今天是否交易日」的权威判据，但每个交易日只会新增一项，
 * 故入库后只在必要时重拉（见 TRADE_AXIS_CONFIRM_MINUTE / TRADE_AXIS_RETRY_MS）。
 */
export interface TradingDatesCache {
  /** 交易日（升序，最后一项为最近交易日） */
  dates: string[];
  /** 写入时间戳（毫秒） */
  updatedAt: number;
}

/* --------------------------------- 上游原始行 --------------------------------- */

/**
 * 板块列表上游行（已归一化）
 */
export interface BoardSnapshotItem {
  /** 板块代码 */
  code: string;
  /** 板块名称 */
  name: string;
  /** 涨跌幅（%） */
  changePercent: number;
  /** 成交额（元） */
  amount: number;
  /** 上涨家数 */
  upCount: number;
  /** 下跌家数 */
  downCount: number;
  /** 平盘家数 */
  flatCount: number;
}

/**
 * 涨跌停池上游行（已归一化）
 */
export interface LimitPoolStock {
  /** 6 位股票代码 */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 市场：0 = 深/北，1 = 沪 */
  market: number;
  /** 现价（元） */
  price: number | null;
  /** 涨跌幅（%） */
  changePercent: number | null;
  /** 成交额（元） */
  amount: number | null;
  /** 换手率（%） */
  turnoverRate: number | null;
  /** 首次封板时间（HHMMSS） */
  sealTime: string | null;
  /** 炸板次数 */
  openTimes: number | null;
  /** 连板数 */
  limitStreak: number | null;
  /** 1 = 涨停，-1 = 跌停 */
  limitType: number;
}

/**
 * 成分股映射的一条上游记录
 */
export interface ConstituentItem {
  /** 6 位股票代码 */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 市场：0 = 深/北，1 = 沪 */
  market: number;
}

/**
 * 成分股实时行情（弹窗「全部成分股」页签，仅当日可用）
 */
export interface BoardConstituentQuote {
  /** 6 位股票代码 */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 现价（元） */
  price: number | null;
  /** 涨跌幅（%） */
  changePercent: number | null;
  /** 换手率（%） */
  turnoverRate: number | null;
  /** 成交额（元） */
  amount: number | null;
}

/* ---------------------------------- 视图模型 ---------------------------------- */

/**
 * 矩阵单元格（视图模型：由 board_daily 行派生）
 */
export interface BoardCalendarCell {
  /** 交易日 */
  tradeDate: string;
  /** 涨停家数 */
  limitUp: number;
  /** 跌停家数 */
  limitDown: number;
  /** 上涨家数 */
  upCount: number;
  /** 下跌家数 */
  downCount: number;
  /** 成分股数 */
  consCount: number;
  /** 成交额（元；回补日为 null） */
  amount: number | null;
  /** 净额口径原始得分 */
  score: number;
  /** 得分率 */
  scoreRate: number;
  /** 数据级别：1 = 完整，0 = 仅涨跌停（不上背景色） */
  dataLevel: number;
  /** 是否已定稿 */
  isFinal: boolean;
  /** 色阶档位（data_level = 0 时为 none） */
  bucket: BoardScoreBucket;
}

/**
 * 矩阵行（视图模型）
 */
export interface BoardCalendarRow {
  /** 板块代码 */
  code: string;
  /** 板块名称 */
  name: string;
  /** 与 matrix.dates 一一对应；null 表示该日无快照 */
  cells: (BoardCalendarCell | null)[];
  /** 近 N 个交易日累计涨停家数（热门口径） */
  heatLimitUp: number;
  /** 最近一个交易日的成交额（元，热门口径回退用） */
  latestAmount: number;
}

/**
 * 矩阵数据（页面渲染单元）
 */
export interface BoardCalendarMatrix {
  /** 交易日（降序，最近的在左） */
  dates: string[];
  /** 板块行（已按自定义顺序或热门口径降序排列，未勾选的板块已剔除） */
  rows: BoardCalendarRow[];
}

/**
 * 板块过滤器确认结果（板块列的勾选与顺序）
 */
export interface BoardColumnSelection {
  /** 完整列顺序（31 个板块代码的排列，决定行序） */
  order: string[];
  /** 未勾选的板块代码（不在表格中渲染） */
  hidden: string[];
}

/**
 * 一次采集编排的结果（页面提示用）
 */
export interface BoardSyncResult {
  /** 本次是否重建了成分股映射 */
  constituentSynced: boolean;
  /** 成分股映射总条数 */
  constituentCount: number;
  /** 本次是否写入当日快照 */
  snapshotWritten: boolean;
  /** 本次新回补的交易日（升序） */
  backfilledDates: string[];
  /** 失败信息（null 表示无失败） */
  error: string | null;
}

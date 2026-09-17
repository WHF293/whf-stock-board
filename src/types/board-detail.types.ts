import type {
  BOARD_DETAIL_RANGE,
  BOARD_DETAIL_SORT,
} from '../constants/board-detail.constants';

/**
 * 板块日历详情页（板块成分股 × 交易日 涨跌幅矩阵）类型
 */

/**
 * 详情页展示范围（由 BOARD_DETAIL_RANGE const 对象派生）
 */
export type BoardDetailRange = (typeof BOARD_DETAIL_RANGE)[keyof typeof BOARD_DETAIL_RANGE];

/**
 * 详情页排序基准（由 BOARD_DETAIL_SORT const 对象派生）
 */
export type BoardDetailSortBasis =
  (typeof BOARD_DETAIL_SORT)[keyof typeof BOARD_DETAIL_SORT];

/**
 * 一支个股的某根日 K（前复权）
 */
export interface DailyCloseBar {
  /** 交易日 `YYYY-MM-DD` */
  tradeDate: string;
  /** 前复权收盘价 */
  close: number;
}

/**
 * 一支个股在窗口内的涨跌幅切片
 */
export interface StockWindowChange {
  /** 与请求的交易日数组一一对应；null 表示该日无行情（停牌 / 未上市） */
  cells: (number | null)[];
  /**
   * 窗口内累计涨跌幅（%）
   *
   * = 窗口内最后一个可得收盘 ÷ 窗口内第一个可得交易日的**前一根**收盘 − 1；
   * 前一根不可得（窗口从头就是序列首根）或窗口内无行情时为 null。
   */
  cumulative: number | null;
}

/**
 * 详情页矩阵的一行（一只成分股）
 */
export interface BoardDetailRow {
  /** 6 位股票代码 */
  symbol: string;
  /** 完整符号（`sh600519` 形态，打开个股详情用） */
  fullSymbol: string;
  /** 股票名称 */
  name: string;
  /** 与 matrix.dates 一一对应；null 表示该日无行情 */
  cells: (number | null)[];
  /** 最新一个可得交易日的涨跌幅（排序 / 摘要用；无行情为 null） */
  latest: number | null;
  /** 窗口内累计涨跌幅（%） */
  cumulative: number | null;
}

/**
 * 详情页矩阵（页面渲染单元）
 */
export interface BoardDetailMatrix {
  /** 交易日（降序，最近的在左） */
  dates: string[];
  /** 成分股行（已按当前排序基准排好） */
  rows: BoardDetailRow[];
}

/**
 * 一次取数的结果（失败只计数，不抛错：单票缺数据不该让整页失败）
 */
export interface BoardDetailLoadResult {
  /** 成分股行（未排序） */
  rows: BoardDetailRow[];
  /** 成分股总数 */
  total: number;
  /** 取数失败（无行情 / 请求报错）的票数 */
  failed: number;
  /**
   * 成分股来源
   *
   * - `db`：本地库 board_constituent（桌面端，成分已随采集周期同步）
   * - `upstream`：东财实时成分（浏览器端无本地库，或本地映射尚未建立）
   */
  source: 'db' | 'upstream';
}

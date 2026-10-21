/**
 * 题材轮动视图模型类型
 *
 * 由 `build-board-rotation.ts` 纯函数产出，BoardRotationPanel 只消费不再加工。
 */

/** 段内龙头（某板块某交易日的涨停股中连板数最大者） */
export interface RotationLeader {
  /** 6 位股票代码 */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 连板数（null 视为 1） */
  limitStreak: number;
  /** 首次封板时间（HHMMSS；并列判定用，展示时格式化） */
  sealTime: string | null;
}

/** 某交易日的单个上榜板块节点（bump 图上的一颗色点） */
export interface RotationDayPoint {
  /** 交易日 YYYY-MM-DD */
  tradeDate: string;
  /** 板块代码 */
  boardCode: string;
  /** 板块名称 */
  boardName: string;
  /** 当日名次（1 起） */
  rank: number;
  /** 涨停家数 */
  limitUp: number;
  /** 得分率（回补日不可比，展示层按 dataLevel 降级） */
  scoreRate: number;
  /** 当日龙头（该板块无涨停明细时为 null） */
  leader: RotationLeader | null;
}

/** 某交易日的行情概览 + 主线候选（bump 图 x 轴一列 + 详情区单日构成） */
export interface RotationDay {
  /** 交易日 YYYY-MM-DD */
  tradeDate: string;
  /** 全市场涨停家数（board_calendar_meta） */
  limitUpCnt: number;
  /** 全市场跌停家数 */
  limitDownCnt: number;
  /** 全市场上涨家数（31 个申万一级行业求和；回补日为 null → 展示「--」） */
  upCount: number | null;
  /** 全市场下跌家数（同上） */
  downCount: number | null;
  /** 是否完整快照（dataLevel = 1；回补日梯队统计降级） */
  isFullSnapshot: boolean;
  /** 是否已定稿（15:00 后；false → 详情区显示「盘中（实时刷新）」） */
  isFinal: boolean;
  /** 主线判定：Top1 涨停 ≥ 阈值（全市场缩量时恒为 false） */
  isMainline: boolean;
  /** 缩量日：全市场涨停 < 阈值 */
  isLowVolume: boolean;
  /** 当日 Top1 板块名（无候选时为 null） */
  topBoardName: string | null;
  /** 当日主线候选（TopN，按名次升序） */
  top: RotationDayPoint[];
}

/** 题材段：同一板块连续在榜的日子串成的一条 bump 线 */
export interface RotationSegment {
  /** 板块代码 */
  boardCode: string;
  /** 板块名称 */
  boardName: string;
  /** 线色（调色板按段序循环） */
  color: string;
  /** 段内各日的节点（按交易日升序，与 days 下标不直接对齐） */
  points: RotationDayPoint[];
  /** 段起点在 days 中的下标 */
  startIndex: number;
  /** 段终点在 days 中的下标 */
  endIndex: number;
  /** 是否进行中（终点 = 最新交易日） */
  isActive: boolean;
  /** 段内累计涨停家次（每日该板块涨停家数求和） */
  totalLimitUp: number;
  /** 段内最高连板龙头（整段最大 limitStreak 者） */
  topLeader: RotationLeader | null;
  /** 每日龙头变迁（与 points 对齐） */
  leaders: Array<RotationLeader | null>;
  /** 接棒题材：掉榜次日新进榜的板块名（进行中或无接棒为 null） */
  successorName: string | null;
  /** 段内成员股（去重取最高连板，降序，截断至常量上限） */
  members: RotationLeader[];
}

/** 题材轮动渲染模型（BoardRotationPanel 的唯一数据源） */
export interface RotationModel {
  /** 交易日（升序，左旧右新，即 bump 图 x 轴） */
  days: RotationDay[];
  /** 题材段列表（按段起点升序；一条 bump 线一个段） */
  segments: RotationSegment[];
}

/** buildBoardRotation 的可调口径（全部有默认值，取自 board-rotation.constants.ts） */
export interface RotationOptions {
  /** 主线宽度 TopN（默认 3） */
  topN?: number;
  /** 板块上榜涨停家数下限（默认 2） */
  minLimitUp?: number;
  /** 主线判定阈值（默认 5） */
  mainlineMin?: number;
  /** 全市场缩量阈值（默认 60） */
  lowVolumeLimit?: number;
}

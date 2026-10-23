/**
 * 风格跷跷板视图模型类型
 *
 * 由 `build-style-seesaw.ts` 纯函数产出，StyleSeesawPanel 只消费不再加工。
 */

/** 单日单桶的行业明细行（热度榜 / 领涨行业来源） */
export interface SeesawBoardRow {
  /** 申万一级行业代码（BKxxxx） */
  code: string;
  /** 行业名称 */
  name: string;
  /** 当日涨跌幅（%；null = 上游缺数） */
  changePercent: number | null;
  /** 当日成交额（元；null = 上游缺数） */
  amount: number | null;
  /** 当日涨停家数 */
  limitUp: number;
  /** 当日得分率（净额口径加权分 ÷ 成分股数） */
  scoreRate: number;
}

/** 单日单桶聚合（进攻端 = 当日抱团行业集合；防守端 = 红利桶行业集合） */
export interface SeesawBucketDay {
  /** 桶内行业当日涨跌幅的等权平均（%；null = 桶内全缺数） */
  changePercentAvg: number | null;
  /** 桶内行业当日成交额求和（元；null = 桶内全缺数） */
  amountSum: number | null;
  /** 桶内行业当日涨停家数求和 */
  limitUpSum: number;
  /** 累计涨跌幅（基期归零：首个交易日为 0，其后逐日累加当日等权涨跌幅；缺数日不累加） */
  cumulativeChange: number;
  /** 桶内行业明细（按当日涨跌幅降序） */
  boards: SeesawBoardRow[];
}

/** 风险偏好倾向（当日两端等权涨跌幅之差判定） */
export type SeesawBias = 'aggressive' | 'defensive' | 'balanced';

/** 单日跷跷板快照（模型数组的元素，x 轴一列） */
export interface SeesawDayPoint {
  /** 交易日 YYYY-MM-DD（升序） */
  tradeDate: string;
  /** 进攻端（高情绪抱团）；当日无达标主线行业时 boards 为空数组、均值为 null */
  aggressive: SeesawBucketDay;
  /** 防守端（高股息红利）；行业映射恒非空，仅在上游缺数时均值为 null */
  defensive: SeesawBucketDay;
  /** 当日风险偏好倾向（任一端均值缺数时为 null） */
  bias: SeesawBias | null;
}

/** 风格跷跷板渲染模型（StyleSeesawPanel 的唯一数据源） */
export interface SeesawModel {
  /** 交易日（升序，左旧右新，即剪刀差曲线 x 轴） */
  days: SeesawDayPoint[];
}

/** buildStyleSeesaw 的可调口径（全部有默认值，取自 style-seesaw.constants.ts） */
export interface SeesawOptions {
  /** 抱团候选 · 涨停家数下限（默认复用题材轮动 ROTATION_MIN_LIMIT_UP = 2） */
  minLimitUp?: number;
  /** 抱团候选 · 得分率下限（默认复用题材轮动 ROTATION_MIN_SCORE_RATE_DEFAULT = 5） */
  minScoreRate?: number;
  /** 风险偏好判定阈值（百分点，默认 SEESAW_BALANCE_THRESHOLD = 0.5） */
  balanceThreshold?: number;
  /** 防守端行业代码集合（默认 STYLE_DEFENSIVE_BOARD_CODES） */
  defensiveCodes?: ReadonlyArray<string>;
}

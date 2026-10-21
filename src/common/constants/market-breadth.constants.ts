/**
 * 市场宽度 · ARMS 常量（口径阈值 / 状态文案 / 本地积累参数）
 */

/** ARMS 强势上限（< 此值为强势，红档） */
export const ARMS_STRONG_MAX = 0.75;

/** ARMS 偏强上限（0.75 ~ 0.9 为偏强，红档） */
export const ARMS_FAVORABLE_MAX = 0.9;

/** ARMS 平衡上限（0.9 ~ 1.1 为平衡；1.1 ~ 1.3 为偏弱，绿档） */
export const ARMS_NEUTRAL_MAX = 1.1;

/** ARMS 偏弱上限（> 1.3 为弱势，绿档） */
export const ARMS_WEAK_MIN = 1.3;

/** ARMS 平衡参考线（y = 1 虚线基准） */
export const ARMS_NEUTRAL_LINE = 1;

/** ARMS 五档状态 key */
export const ARMS_STATE = {
  /** < 0.75 强势 */
  STRONG: 'strong',
  /** 0.75 ~ 0.9 偏强 */
  FAVORABLE: 'favorable',
  /** 0.9 ~ 1.1 平衡 */
  NEUTRAL: 'neutral',
  /** 1.1 ~ 1.3 偏弱 */
  UNFAVORABLE: 'unfavorable',
  /** > 1.3 弱势 */
  WEAK: 'weak',
} as const;

/** ARMS 状态 key 类型 */
export type ArmsStateKey = (typeof ARMS_STATE)[keyof typeof ARMS_STATE];

/** ARMS 状态文案（key → 中文标签） */
export const ARMS_STATE_LABEL: Record<ArmsStateKey, string> = {
  [ARMS_STATE.STRONG]: '强势',
  [ARMS_STATE.FAVORABLE]: '偏强',
  [ARMS_STATE.NEUTRAL]: '平衡',
  [ARMS_STATE.UNFAVORABLE]: '偏弱',
  [ARMS_STATE.WEAK]: '弱势',
};

/** 分时轴时间格式（分钟点 x 轴标签） */
export const ARMS_TIME_FORMAT = 'HH:mm';

/** 市场宽度卡视图 key（当日分时 / 近 30 日 / 近 60 日） */
export const BREADTH_VIEW = {
  INTRADAY: 'intraday',
  D30: 'd30',
  D60: 'd60',
} as const;

/** 市场宽度卡视图 key 类型 */
export type BreadthViewKey = (typeof BREADTH_VIEW)[keyof typeof BREADTH_VIEW];

/** 日线视图档位（视图 key → 交易日窗口天数） */
export const BREADTH_VIEW_DAYS: Record<Exclude<BreadthViewKey, typeof BREADTH_VIEW.INTRADAY>, number> = {
  [BREADTH_VIEW.D30]: 30,
  [BREADTH_VIEW.D60]: 60,
};

/** 市场宽度卡视图选项（BaseTabs 数据源） */
export const BREADTH_VIEW_OPTIONS: ReadonlyArray<{ label: string; value: BreadthViewKey }> = [
  { label: '当日分时', value: BREADTH_VIEW.INTRADAY },
  { label: '近 30 日', value: BREADTH_VIEW.D30 },
  { label: '近 60 日', value: BREADTH_VIEW.D60 },
];

/** 日 bar 滚存上限（约一年交易日） */
export const BREADTH_BAR_KEEP_DAYS = 250;

/** 分钟点按日滚存上限（仅保留最近 N 日，bar 落库后旧分时无用） */
export const BREADTH_DAY_SERIES_KEEP_DAYS = 3;

/** 分时序列落盘节流间隔（毫秒）——appStorage 为整包合并回写，防 30s 轮询高频全量写 */
export const BREADTH_PERSIST_THROTTLE_MS = 60_000;

/** 收盘分钟数（15:00，本地时区；此后快照定稿，聚合日 bar） */
export const BREADTH_BAR_CLOSE_MINUTE = 15 * 60;

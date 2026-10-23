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

/* ---- 市场广度指标页（ADL / ADR / OBOS / ARMS / MCO 五指标）参数 ----
 * 口径对齐通达信：ADR/OBOS N=10、OBOS 均线 6、ADL 均线 10、
 * ARMS 平滑均线 21、MCO EMA19/39 + 信号线 MA9 */

/** ADR 涨跌比率统计周期（N 日涨跌家数总和之比） */
export const BREADTH_ADR_PERIOD = 10;

/** ADR 超买阈值（> 此值行情过热） */
export const BREADTH_ADR_OVERBOUGHT = 1.5;

/** ADR 超卖阈值（< 此值恐慌杀跌） */
export const BREADTH_ADR_OVERSOLD = 0.5;

/** OBOS 超买超卖统计周期（N 日涨跌家数总和之差） */
export const BREADTH_OBOS_PERIOD = 10;

/** OBOS 均线周期（MA） */
export const BREADTH_OBOS_MA_PERIOD = 6;

/** ADL 腾落线均线周期（MA） */
export const BREADTH_ADL_MA_PERIOD = 10;

/** ARMS 日线平滑均线周期（MA，阿姆氏 4/21 日惯例取 21） */
export const BREADTH_ARMS_MA_PERIOD = 21;

/** MCO 麦克莱伦短周期 EMA */
export const BREADTH_MCO_FAST_PERIOD = 19;

/** MCO 麦克莱伦长周期 EMA */
export const BREADTH_MCO_SLOW_PERIOD = 39;

/** MCO 信号线 MA 周期（MAMCO） */
export const BREADTH_MCO_SIGNAL_PERIOD = 9;

/** MCO 超买阈值（> 此值进入超买区） */
export const BREADTH_MCO_OVERBOUGHT = 25;

/** MCO 超卖阈值（< 此值进入超卖区） */
export const BREADTH_MCO_OVERSOLD = -25;

/* ---- 活跃占比（第六张副图，换手率口径） ---- */

/** 活跃股换手率阈值（%：日换手率 > 此值计入活跃家数） */
export const BREADTH_ACTIVE_TURNOVER_THRESHOLD = 5;

/** 活跃占比过热阈值（%：≥ 此值交投过热，短线情绪亢奋） */
export const BREADTH_ACTIVE_OVERHEAT = 20;

/** 活跃占比冰点阈值（%：≤ 此值交投冰点，观望情绪浓） */
export const BREADTH_ACTIVE_COLD = 5;

/** 广度指标页视图 key（近 60 日 / 近 120 日 / 全部积累） */
export const BREADTH_INDICATOR_VIEW = {
  D60: 'd60',
  D120: 'd120',
  ALL: 'all',
} as const;

/** 广度指标页视图 key 类型 */
export type BreadthIndicatorViewKey =
  (typeof BREADTH_INDICATOR_VIEW)[keyof typeof BREADTH_INDICATOR_VIEW];

/** 广度指标页日线视图档位（视图 key → 交易日窗口天数；ALL 为 undefined 表示全量） */
export const BREADTH_INDICATOR_VIEW_DAYS: Partial<Record<BreadthIndicatorViewKey, number>> = {
  [BREADTH_INDICATOR_VIEW.D60]: 60,
  [BREADTH_INDICATOR_VIEW.D120]: 120,
};

/** 广度指标页视图选项（BaseTabs 数据源） */
export const BREADTH_INDICATOR_VIEW_OPTIONS: ReadonlyArray<{
  label: string;
  value: BreadthIndicatorViewKey;
}> = [
  { label: '近 60 日', value: BREADTH_INDICATOR_VIEW.D60 },
  { label: '近 120 日', value: BREADTH_INDICATOR_VIEW.D120 },
  { label: '全部', value: BREADTH_INDICATOR_VIEW.ALL },
];

/** 广度指标副图 kind（ADL / ADR / OBOS / ARMS / MCO / 活跃占比） */
export const BREADTH_INDICATOR_KIND = {
  ADL: 'adl',
  ADR: 'adr',
  OBOS: 'obos',
  ARMS: 'arms',
  MCO: 'mco',
  ACTIVE: 'active',
} as const;

/** 广度指标副图 kind 类型 */
export type BreadthIndicatorKind =
  (typeof BREADTH_INDICATOR_KIND)[keyof typeof BREADTH_INDICATOR_KIND];

/** 单个广度指标的说明（副图标题 icon hover 展示） */
export interface BreadthIndicatorInfo {
  /** 计算公式（\n 分行，气泡内 pre-line 渲染） */
  formula: string;
  /** 指标意义与判读口径 */
  meaning: string;
}

/**
 * 五大广度指标说明（公式口径对齐通达信；副图卡标题 icon hover 气泡数据源）
 */
export const BREADTH_INDICATOR_INFO: Record<BreadthIndicatorKind, BreadthIndicatorInfo> = {
  [BREADTH_INDICATOR_KIND.ADL]: {
    formula: 'ADL = Σ(上涨家数 − 下跌家数)，逐日累加\nMADL = MA(ADL, 10)',
    meaning:
      '市场广度趋势线，看广度的长期累积状态。指数新高且 ADL 同步新高：普涨健康，趋势延续；指数新高但 ADL 不创新高：顶背离，权重拉指数、小票走弱，风险预警；指数新低但 ADL 不创新低：底背离，抛压衰竭，底部信号。本页 ADL 起点为本地首条 bar（历史无法回填），仅具相对意义。',
  },
  [BREADTH_INDICATOR_KIND.ADR]: {
    formula: 'ADR = N日上涨家数总和 ÷ N日下跌家数总和（N = 10）',
    meaning:
      'N 日内涨跌股票数量比值，衡量多空数量对比。ADR > 1.5：超买，行情过热；ADR < 0.5：超卖，恐慌杀跌；0.7 ~ 1.3：多空均衡震荡。',
  },
  [BREADTH_INDICATOR_KIND.OBOS]: {
    formula: 'OBOS = N日上涨家数总和 − N日下跌家数总和（N = 10）\nMOBOS = MA(OBOS, 6)',
    meaning:
      'ADR 的差值版，直接看多空数量净差，更直观。大幅正值：上涨家数占绝对优势；大幅负值：下跌家数占绝对优势；同样重点看与指数的背离。',
  },
  [BREADTH_INDICATOR_KIND.ARMS]: {
    formula:
      'TRIN = (上涨家数 ÷ 下跌家数) ÷ (上涨成交量 ÷ 下跌成交量)\nARMS = MA(TRIN, 21)',
    meaning:
      '唯一同时叠加家数与成交量的广度指标，逆向情绪指标。TRIN = 1：多空均衡；< 1：多头更强，数值越低越狂热（超买，警惕见顶）；> 1：空头更强，数值越高越恐慌（超卖，短线反弹机会）。实战看均线平滑后的 ARMS，而非盘中瞬时值。',
  },
  [BREADTH_INDICATOR_KIND.MCO]: {
    formula:
      'DIF = 上涨家数 − 下跌家数\nMCO = EMA(DIF, 19) − EMA(DIF, 39)\nMAMCO = MA(MCO, 9)',
    meaning:
      '广度动量指标（ADL 的动量版），对广度拐点敏感，比 ADL 更早提示背离。MCO > 0：多头占优；MCO < 0：空头占优；+25 ~ +35 超买区、−25 ~ −35 超卖区；看 MCO 与指数的背离，以及 0 轴穿越（金叉死叉）。EMA 需预热，约 50 个交易日后趋稳。',
  },
  [BREADTH_INDICATOR_KIND.ACTIVE]: {
    formula:
      `活跃占比 = 换手率 > ${BREADTH_ACTIVE_TURNOVER_THRESHOLD}% 家数 ÷ 换手率有效（正常交易）家数 × 100%`,
    meaning:
      '市场交投活跃度的温度计，衡量有多少比例的股票被资金重点参与。占比持续走高：题材轮动加快、短线情绪升温；占比 ≥ 20%：交投过热，提防情绪退潮；占比 ≤ 5%：交投冰点，存量博弈。历史无法回填，自上线日起本地逐日积累。',
  },
};

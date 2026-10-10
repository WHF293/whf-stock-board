/**
 * 市场情绪速览类型（涨停 / 炸板 / 跌停 / 昨日涨停四池聚合口径）
 */

/** 连板梯队单档（板数 -> 家数） */
export interface SentimentLadderTier {
  /** 连板数（首板为 1） */
  board: number;
  /** 该板数家数 */
  count: number;
}

/** 市场情绪速览快照（总览情绪卡数据口径） */
export interface MarketSentiment {
  /** 涨停家数 */
  limitUpCount: number;
  /** 跌停家数 */
  limitDownCount: number;
  /** 炸板家数 */
  brokenCount: number;
  /** 炸板率（百分数原值）：炸板 / (涨停 + 炸板)；分母为 0 时为 null */
  brokenRate: number | null;
  /** 连板梯队（按板数降序） */
  ladder: SentimentLadderTier[];
  /** 连板高度（最高连板数；当日无涨停时为 0） */
  maxLadder: number;
  /** 连板家数（2 板及以上） */
  continuousCount: number;
  /** 昨日涨停池个股今日涨跌幅均值（百分数原值）：打板溢价口径；池空或无有效值时为 null */
  yesterdayZtAvgPct: number | null;
}

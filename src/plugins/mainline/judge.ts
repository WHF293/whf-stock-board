/**
 * 插件 dsh-mainline（股票主线）· 判定层（**纯函数**，可冒烟断言、可回测）
 *
 * 与技能 `a-share-huddle-mainline/scripts/huddle_judge.py` 同一定位：
 * 只吃数据、只吐结论，不碰网络与存储。规则对应技能 `references/phase-rules.md`
 * 里**可自动计算**的那部分（成交占比分位 / 量能倍数 / 价格分位），
 * 需要人工输入的（公募持仓分位、估值分位、业绩验证）本期不接入 ——
 * 判定层因此把置信度降档并在界面「本期未接入的输入」里明说，**不静默**。
 *
 * 三条铁律（技能原文，代码里落实）：
 * 1. 只输出阶段标签与风险提示，不出现任何买卖 / 仓位指令；
 * 2. 只有价格上涨、没有业绩验证 → 不判「确认抱团」，本层的「确认」仅代表
 *    「量价与拥挤度特征具备」，风险提示里明确写出「需连续两季业绩验证」；
 * 3. 必须把原始指标面板一并给出（`BoardMetrics` 原样透出，不做二次加工）。
 */
import {
  CANDIDATE_MIN_AMOUNT_RATIO,
  CANDIDATE_MIN_SHARE_PERCENTILE,
  COLLAPSE_MAX_CHANGE5,
  COLLAPSE_MIN_PRICE_PERCENTILE,
  COLLAPSE_MIN_SHARE_PERCENTILE,
  COLLAPSE_MIN_TURNOVER_SHARE,
  CONFIRMED_MIN_AMOUNT_RATIO,
  CONFIRMED_NEAR_HIGH_RATIO,
  GERMINATION_MAX_CHANGE5,
  GERMINATION_MAX_SHARE_PERCENTILE,
  GERMINATION_MIN_AMOUNT_RATIO,
  MAINLINE_CONFIDENCE_HIGH_DAYS,
  MAINLINE_CONFIDENCE_MEDIUM_DAYS,
  MAINLINE_LONG_WINDOW,
  MAINLINE_MIN_HISTORY_DAYS,
  MAINLINE_PHASE,
  MAINLINE_PHASE_DESC,
  MAINLINE_PHASE_LABEL,
  MAINLINE_PHASE_ORDER,
  MAINLINE_PHASE_WARNINGS,
  MAINLINE_PRICE_WINDOW,
  MAINLINE_SHORT_WINDOW,
  MANIA_MIN_CHANGE20,
  MANIA_MIN_PRICE_PERCENTILE,
  MANIA_MIN_SHARE_PERCENTILE,
  MANIA_MIN_TURNOVER_SHARE,
  PERCENT_BASE,
} from './constants';
import type { BoardMetrics, BoardSeries, MainlineVerdict, MarketTurnoverPoint } from './types';
import type { MainlineConfidence, MainlinePhase } from './constants';

/**
 * 计算某个值在一串历史值中的分位（0-100）
 *
 * 口径：`≤ 该值的历史样本数 ÷ 样本总数 × 100`，即「今天的水平在历史上压过多少天」。
 * @param history 历史值（可含当天）
 * @param value 待定位的值
 * @returns 分位（0-100）；历史为空时返回 null
 */
export const percentileRank = (history: readonly number[], value: number): number | null => {
  const usable = history.filter((item) => Number.isFinite(item));
  if (usable.length === 0 || !Number.isFinite(value)) return null;
  const below = usable.filter((item) => item <= value).length;
  return (below / usable.length) * PERCENT_BASE;
};

/**
 * 构建「交易日 → 沪深两市总成交额（元）」映射
 * @param market 沪深成交额序列
 * @returns 日期映射
 */
export const buildMarketMap = (
  market: readonly MarketTurnoverPoint[],
): Map<string, number> =>
  new Map(
    market
      .filter((point) => point.date && Number.isFinite(point.totalAmount) && point.totalAmount > 0)
      .map((point) => [point.date, point.totalAmount]),
  );

/**
 * 取序列尾部窗口的均值
 * @param values 数值序列
 * @param window 窗口长度
 * @returns 均值；序列为空返回 null
 */
const averageOfTail = (values: readonly number[], window: number): number | null => {
  const tail = values.slice(-window);
  if (tail.length === 0) return null;
  return tail.reduce((sum, item) => sum + item, 0) / tail.length;
};

/**
 * 近 N 个交易日累计涨跌幅（%）
 *
 * 用收盘价比值而非逐日涨跌幅相加：后者会忽略复利效应，长窗口下偏差可观。
 * 样本不足 N+1 天时退化为「可用区间的累计涨跌幅」。
 * @param series 板块序列（升序）
 * @param window 交易日窗口
 * @returns 累计涨跌幅（%）；样本不足 2 天返回 0
 */
const trailingChange = (series: BoardSeries['days'], window: number): number => {
  if (series.length < 2) return 0;
  const last = series[series.length - 1];
  const fromIndex = Math.max(0, series.length - 1 - window);
  const base = series[fromIndex];
  if (!last || !base || base.close <= 0) return 0;
  return ((last.close - base.close) / base.close) * PERCENT_BASE;
};

/**
 * 计算单板块的全部原始指标
 * @param series 板块日线序列（升序）
 * @param marketMap 交易日 → 沪深总成交额（元）
 * @returns 指标面板
 */
export const computeMetrics = (
  series: BoardSeries,
  marketMap: ReadonlyMap<string, number>,
): BoardMetrics => {
  const days = series.days;
  const last = days[days.length - 1];
  if (!last) {
    return {
      asOf: '',
      historyDays: 0,
      latestChange: 0,
      change5: 0,
      change20: 0,
      amount: null,
      turnoverShare: null,
      sharePercentile: null,
      amountRatio: null,
      pricePercentile: null,
    };
  }

  // 成交占比序列：仅保留「当日成交额与全市场成交额都有」的交易日
  const shares: number[] = [];
  for (const day of days) {
    const total = marketMap.get(day.date);
    if (!total || day.amount <= 0) continue;
    shares.push((day.amount / total) * PERCENT_BASE);
  }
  const latestTotal = marketMap.get(last.date);
  const turnoverShare = latestTotal && last.amount > 0 ? (last.amount / latestTotal) * PERCENT_BASE : null;

  const amounts = days.map((day) => day.amount).filter((amount) => amount > 0);
  const shortAverage = averageOfTail(amounts, MAINLINE_SHORT_WINDOW);
  const longAverage = averageOfTail(amounts, MAINLINE_LONG_WINDOW);
  const amountRatio =
    shortAverage !== null && longAverage !== null && longAverage > 0 ? shortAverage / longAverage : null;

  const closes = days.map((day) => day.close);
  const priceWindow = closes.slice(-MAINLINE_PRICE_WINDOW);
  const pricePercentile = percentileRank(priceWindow, last.close);

  return {
    asOf: last.date,
    historyDays: days.length,
    latestChange: last.changePercent,
    change5: trailingChange(days, MAINLINE_SHORT_WINDOW),
    change20: trailingChange(days, MAINLINE_LONG_WINDOW),
    amount: last.amount > 0 ? last.amount : null,
    turnoverShare,
    sharePercentile:
      turnoverShare !== null && shares.length > 0 ? percentileRank(shares, turnoverShare) : null,
    amountRatio,
    pricePercentile,
  };
};

/**
 * 由样本天数推置信度（样本不足 → 低档，界面据此提示）
 * @param historyDays 历史样本交易日数
 * @returns 置信度档位
 */
export const resolveConfidence = (historyDays: number): MainlineConfidence => {
  if (historyDays >= MAINLINE_CONFIDENCE_HIGH_DAYS) return 'high';
  if (historyDays >= MAINLINE_CONFIDENCE_MEDIUM_DAYS) return 'medium';
  return 'low';
};

/**
 * 阶段判定（按「先极端、后成型、再萌芽」的顺序短路）
 * @param metrics 指标面板
 * @returns 阶段
 */
export const resolvePhase = (metrics: BoardMetrics): MainlinePhase => {
  const {
    sharePercentile,
    turnoverShare,
    change5,
    change20,
    amountRatio,
    pricePercentile,
    historyDays,
  } = metrics;

  // 样本不足时不下结论 —— 缺样本 ≠ 状态正常
  if (historyDays < MAINLINE_MIN_HISTORY_DAYS || sharePercentile === null) {
    return MAINLINE_PHASE.UNKNOWN;
  }

  // 瓦解优先于狂热：两者都「拥挤 + 价格高位」，差别只在**是否已经转弱** ——
  // 已经从高位放量下跌的板块，先按瓦解定性（否则会被狂热的分支截胡）
  if (
    sharePercentile >= COLLAPSE_MIN_SHARE_PERCENTILE &&
    turnoverShare !== null &&
    turnoverShare >= COLLAPSE_MIN_TURNOVER_SHARE &&
    pricePercentile !== null &&
    pricePercentile >= COLLAPSE_MIN_PRICE_PERCENTILE &&
    change5 <= COLLAPSE_MAX_CHANGE5
  ) {
    return MAINLINE_PHASE.COLLAPSE;
  }

  // 狂热 = 拥挤到历史极值 + 赔率恶化（价格/中期涨幅处于高位），二者缺一不成立
  const crowded = sharePercentile >= MANIA_MIN_SHARE_PERCENTILE;
  const bigEnough = turnoverShare !== null && turnoverShare >= MANIA_MIN_TURNOVER_SHARE;
  const pricedHigh =
    (pricePercentile !== null && pricePercentile >= MANIA_MIN_PRICE_PERCENTILE) ||
    change20 >= MANIA_MIN_CHANGE20;
  if (crowded && bigEnough && pricedHigh) {
    return MAINLINE_PHASE.MANIA;
  }

  if (
    amountRatio !== null &&
    amountRatio >= CONFIRMED_MIN_AMOUNT_RATIO &&
    change5 > 0 &&
    pricePercentile !== null &&
    pricePercentile >= CONFIRMED_NEAR_HIGH_RATIO * PERCENT_BASE &&
    sharePercentile >= GERMINATION_MAX_SHARE_PERCENTILE
  ) {
    // 不设占比分位上限：占比已到极值但涨幅尚未加速的，仍属「确认后期」而非「未成主线」；
    // 真正的狂热要「拥挤 + 加速」同时成立（在上面的分支里判定）
    return MAINLINE_PHASE.CONFIRMED;
  }
  if (
    amountRatio !== null &&
    amountRatio >= GERMINATION_MIN_AMOUNT_RATIO &&
    sharePercentile < GERMINATION_MAX_SHARE_PERCENTILE &&
    change5 > 0 &&
    change5 <= GERMINATION_MAX_CHANGE5
  ) {
    return MAINLINE_PHASE.GERMINATION;
  }
  return MAINLINE_PHASE.NONE;
};

/**
 * 判定单个板块
 * @param series 板块日线序列
 * @param marketMap 交易日 → 沪深总成交额（元）
 * @returns 判定结论（阶段 + 风险提示 + 原始指标面板）
 */
export const judgeBoard = (
  series: BoardSeries,
  marketMap: ReadonlyMap<string, number>,
): MainlineVerdict => {
  const metrics = computeMetrics(series, marketMap);
  const phase = resolvePhase(metrics);
  const candidate =
    (metrics.sharePercentile !== null &&
      metrics.sharePercentile >= CANDIDATE_MIN_SHARE_PERCENTILE) ||
    (metrics.amountRatio !== null && metrics.amountRatio >= CANDIDATE_MIN_AMOUNT_RATIO);

  return {
    code: series.code,
    name: series.name,
    phase,
    phaseLabel: MAINLINE_PHASE_LABEL[phase],
    phaseDesc: MAINLINE_PHASE_DESC[phase],
    candidate,
    confidence: resolveConfidence(metrics.historyDays),
    warnings: MAINLINE_PHASE_WARNINGS[phase],
    metrics,
  };
};

/**
 * 判定全部板块并排序（阶段严重度优先，同阶段按成交占比分位降序）
 * @param boards 全部板块序列
 * @param market 沪深成交额序列
 * @returns 判定结论数组
 */
export const judgeAll = (
  boards: readonly BoardSeries[],
  market: readonly MarketTurnoverPoint[],
): MainlineVerdict[] => {
  const marketMap = buildMarketMap(market);
  return boards
    .map((series) => judgeBoard(series, marketMap))
    .sort((a, b) => {
      const byPhase = MAINLINE_PHASE_ORDER[a.phase] - MAINLINE_PHASE_ORDER[b.phase];
      if (byPhase !== 0) return byPhase;
      return (b.metrics.sharePercentile ?? -1) - (a.metrics.sharePercentile ?? -1);
    });
};

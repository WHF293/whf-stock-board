import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import type { TzzbClearedPosition, TzzbStockTrade } from '../types/tzzb.types.ts';
import { QFQ_MAX_LOOKBACK_DAYS } from './compute-trade-contribution';

/**
 * 处置效应 + 买卖点评分（纯函数，方案 §4.2）
 *
 * - **处置比率** = 盈利单平均持有天数 ÷ 亏损单平均持有天数（<1 = 拿不住盈利、
 *   死扛亏损，散户经典画像；行为金融「处置效应」的量化）；
 * - **买卖点分位**：每笔成交价在窗口 [成交日−20 交易日, 成交日+20 交易日]
 *   （后窗不足 5 交易日不计分）qfq 高低区间里的位置
 *   pct = (price − winLow) ÷ (winHigh − winLow)。买入 ≥70 记追高、≤30 记低吸，
 *   卖出反向解读（卖在低位 = 割在地板上）；
 * - **复权折算**：成交价是真实价、窗口是 qfq 序列——按成交日折算
 *   c = qfqClose(成交日) ÷ rawClose(成交日)，price × c 换算进 qfq 口径
 *   （rawClose 缺失时按 c = 1 处理：近三个月内通常无除权，误差可忽略）；
 * - **追涨指数** = 买入金额中分位 ≥70 的占比（分母含未计分买入）；
 * - **低吸占比** = 分位 ≤30 的买入笔数 ÷ 已计分买入笔数。
 */

/** 评分窗口前 / 后各取的交易日数 */
export const BEHAVIOR_WINDOW_BARS = 20;

/** 后窗最少交易日数（不足则该笔不计分） */
export const BEHAVIOR_MIN_FORWARD_BARS = 5;

/** 分位直方图桶数（0-10 / 10-20 / … / 90-100） */
export const BEHAVIOR_HIST_BINS = 10;

/** 已计分成交（供聚焦高亮等消费） */
export interface BehaviorScoredTrade {
  code: string;
  name: string;
  date: string;
  /** 'buy' | 'sell' */
  side: 'buy' | 'sell';
  /** 分位 0~100 */
  percentile: number;
  amount: number;
}

/** 行为诊断结果 */
export interface BehaviorResult {
  /** 处置比率（盈利组持有均值 ÷ 亏损组持有均值）；任一组为空为 null */
  disposalRatio: number | null;
  /** 盈利单平均持有天数 */
  avgHoldWin: number | null;
  /** 亏损单平均持有天数 */
  avgHoldLoss: number | null;
  /** 买入分位直方图（10 桶计数） */
  buyHist: number[];
  /** 卖出分位直方图（10 桶计数） */
  sellHist: number[];
  /** 追涨指数（0~1，买入金额中分位 ≥70 占比）；无买入为 null */
  chaseIndex: number | null;
  /** 低吸占比（0~1，已计分买入中分位 ≤30 笔数占比）；无已计分买入为 null */
  dipRatio: number | null;
  /** 已计分买入笔数 */
  scoredBuys: number;
  /** 已计分卖出笔数 */
  scoredSells: number;
  /** 未计分笔数（K 线覆盖不足 / 停牌） */
  unscored: number;
  /** 已计分明细（时间升序） */
  scored: BehaviorScoredTrade[];
}

/**
 * 计算行为诊断
 * @param input 入参
 * @param input.trades 区间内股票逐笔流水
 * @param input.cleared 清仓记录（处置比率用已清仓周期）
 * @param input.klines code → qfq 日 K（fetchKlineCached，时间升序）
 * @param input.rawCloses code → yyyy-MM-dd → 不复权收盘（折算系数分母；可缺票缺日）
 * @returns 行为诊断结果
 */
export const computeBehavior = (input: {
  trades: TzzbStockTrade[];
  cleared: TzzbClearedPosition[];
  klines: Map<string, KLineData[]>;
  rawCloses: Map<string, Map<string, number>>;
}): BehaviorResult => {
  const { trades, cleared, klines, rawCloses } = input;

  /* ---- 处置比率（已清仓周期分组） ---- */
  const closedCycles = cleared.filter((r) => r.closeDate !== null);
  const winCycles = closedCycles.filter((r) => r.profit > 0);
  const lossCycles = closedCycles.filter((r) => r.profit < 0);
  const avg = (rows: TzzbClearedPosition[]): number | null =>
    rows.length === 0 ? null : rows.reduce((s, r) => s + r.holdDays, 0) / rows.length;
  const avgHoldWin = avg(winCycles);
  const avgHoldLoss = avg(lossCycles);
  const disposalRatio =
    avgHoldWin !== null && avgHoldLoss !== null && avgHoldLoss > 0 ? avgHoldWin / avgHoldLoss : null;

  /* ---- 买卖点分位 ---- */
  const buyHist = new Array<number>(BEHAVIOR_HIST_BINS).fill(0);
  const sellHist = new Array<number>(BEHAVIOR_HIST_BINS).fill(0);
  const scored: BehaviorScoredTrade[] = [];
  let scoredBuys = 0;
  let scoredSells = 0;
  let unscored = 0;
  let chaseAmount = 0;
  let totalBuyAmount = 0;
  let dipCount = 0;

  for (const t of trades) {
    const isBuy = t.action.includes('买');
    const isSell = !isBuy && t.action.includes('卖');
    if (!isBuy && !isSell) continue;
    const amount = Math.abs(t.amount);
    if (isBuy) totalBuyAmount += amount;

    const bars = klines.get(t.code);
    if (!bars || bars.length === 0) {
      unscored += 1;
      continue;
    }
    // 定位成交日 bar（≤ 成交日的最近一根，容忍停牌回看）
    const tTs = dayjs(t.date).valueOf();
    let idx = -1;
    {
      let lo = 0;
      let hi = bars.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].timestamp <= tTs) {
          idx = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
    }
    if (idx === -1 || dayjs(t.date).diff(dayjs(bars[idx].timestamp), 'day') > QFQ_MAX_LOOKBACK_DAYS) {
      unscored += 1;
      continue;
    }
    const hiIdx = Math.min(bars.length - 1, idx + BEHAVIOR_WINDOW_BARS);
    if (hiIdx - idx < BEHAVIOR_MIN_FORWARD_BARS) {
      unscored += 1;
      continue;
    }
    const loIdx = Math.max(0, idx - BEHAVIOR_WINDOW_BARS);

    // 复权折算：c = qfqClose(成交日) ÷ rawClose(成交日)；raw 缺失按 c = 1
    const qfqClose = bars[idx].close;
    const rawClose = rawCloses.get(t.code)?.get(t.date);
    const c = rawClose !== undefined && rawClose > 0 ? qfqClose / rawClose : 1;
    const priceQ = t.price * c;

    // 窗口高低区间（qfq 口径）
    let winHigh = -Infinity;
    let winLow = Infinity;
    for (let i = loIdx; i <= hiIdx; i++) {
      if (bars[i].high > winHigh) winHigh = bars[i].high;
      if (bars[i].low < winLow) winLow = bars[i].low;
    }
    const percentile =
      winHigh > winLow
        ? Math.min(100, Math.max(0, ((priceQ - winLow) / (winHigh - winLow)) * 100))
        : 50;
    const bucket = Math.min(BEHAVIOR_HIST_BINS - 1, Math.floor(percentile / 10));

    scored.push({ code: t.code, name: t.name, date: t.date, side: isBuy ? 'buy' : 'sell', percentile, amount });
    if (isBuy) {
      buyHist[bucket] += 1;
      scoredBuys += 1;
      if (percentile >= 70) chaseAmount += amount;
      if (percentile <= 30) dipCount += 1;
    } else {
      sellHist[bucket] += 1;
      scoredSells += 1;
    }
  }
  scored.sort((a, b) => a.date.localeCompare(b.date));

  return {
    disposalRatio,
    avgHoldWin,
    avgHoldLoss,
    buyHist,
    sellHist,
    chaseIndex: totalBuyAmount > 0 ? chaseAmount / totalBuyAmount : null,
    dipRatio: scoredBuys > 0 ? dipCount / scoredBuys : null,
    scoredBuys,
    scoredSells,
    unscored,
    scored,
  };
};

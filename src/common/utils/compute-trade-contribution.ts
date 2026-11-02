import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import type { TzzbClearedPosition, TzzbStockTrade } from '../types/tzzb.types.ts';

/**
 * 操作贡献度拆解（纯函数，方案 §4.3）
 *
 * 核心问题：「你的操作到底帮你在赚钱还是在亏钱？」
 * - **实际盈亏** = Σ清仓回合 profit（官方 queryClearedPosition 口径，含费；
 *   持有中回合为其已实现部分。在持票浮动盈亏数据源缺，一期不计入，UI 注明覆盖范围）；
 * - **反事实（买入持有）** = 区间内每笔买入按买入日 qfq 收盘价买入、持有到该票
 *   K 线末日的假想盈亏：Σ amount × (qfqClose(end) ÷ qfqClose(buy) − 1)。
 *   qfq 序列天然消化分红除权，口径自洽；
 * - **操作贡献** = 实际 − 反事实（>0 = 波段操作增值，<0 = 做飞了）。
 *
 * 日期匹配容忍停牌：目标日无 bar 时向前回看最多 MAX_LOOKBACK_DAYS 自然日。
 */

/** 单票 qfq 收盘序列（从 KLineData 提炼的轻量形态，供本模块与行为诊断共用） */
export interface QfqCloseSeries {
  /** yyyy-MM-dd → qfq 收盘价 */
  closes: Map<string, number>;
  /** 日期升序数组（二分查找用） */
  dates: string[];
}

/** 逐票贡献行 */
export interface ContributionStockRow {
  code: string;
  name: string;
  /** 实际盈亏（Σ清仓回合 profit，官方含费口径） */
  actual: number;
  /** 反事实盈亏（买入持有到序列末日） */
  counterfactual: number;
  /** 操作贡献 = 实际 − 反事实 */
  contribution: number;
  /** 区间买入笔数 */
  buyCount: number;
  /** 区间买入金额合计（元） */
  buyAmount: number;
  /** 买卖回合数（清仓记录口径） */
  rounds: number;
}

/** 贡献度计算结果 */
export interface ContributionResult {
  /** 实际盈亏合计 */
  actualTotal: number;
  /** 反事实盈亏合计 */
  counterfactualTotal: number;
  /** 操作贡献合计 = 实际 − 反事实 */
  contributionTotal: number;
  /** 逐票行（按贡献降序） */
  rows: ContributionStockRow[];
  /** 因日期超出 K 线覆盖（>3.2 年）或长期停牌无法计分的买入笔数 */
  unscoredBuys: number;
}

/** 日期查找最大回看自然日（停牌 / 节假日容忍） */
export const QFQ_MAX_LOOKBACK_DAYS = 12;

/**
 * 从 klinecharts KLineData 提炼收盘序列
 * @param bars 日 K 序列（时间升序，fetchKlineCached 返回）
 * @returns 收盘序列（空入空出）
 */
export const toQfqCloseSeries = (bars: KLineData[]): QfqCloseSeries => {
  const closes = new Map<string, number>();
  const dates: string[] = [];
  for (const bar of bars) {
    const date = dayjs(bar.timestamp).format('YYYY-MM-DD');
    if (!closes.has(date)) dates.push(date);
    closes.set(date, bar.close);
  }
  return { closes, dates };
};

/**
 * 查找「≤ date 且回看不超限」的最近收盘
 * @param series 收盘序列
 * @param date 目标日期 yyyy-MM-dd
 * @returns 日期与收盘价；序列为空或超出回看窗口时为 null
 */
export const findCloseOnOrBefore = (
  series: QfqCloseSeries,
  date: string,
): { date: string; close: number } | null => {
  const { dates, closes } = series;
  if (dates.length === 0) return null;
  // 二分找最后一个 ≤ date 的下标
  let lo = 0;
  let hi = dates.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (dates[mid] <= date) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx === -1) return null;
  if (dayjs(date).diff(dayjs(dates[idx]), 'day') > QFQ_MAX_LOOKBACK_DAYS) return null;
  return { date: dates[idx], close: closes.get(dates[idx]) ?? 0 };
};

/**
 * 计算操作贡献度
 * @param trades 区间内股票逐笔流水
 * @param cleared 清仓记录（含持有中回合；actual 按官方 profit 口径直接累加）
 * @param seriesById code → qfq 收盘序列（无该票 ⇒ 该票买入全部无法计分）
 * @returns 贡献度结果（rows 按贡献降序）
 */
export const computeTradeContribution = (
  trades: TzzbStockTrade[],
  cleared: TzzbClearedPosition[],
  seriesById: Map<string, QfqCloseSeries>,
): ContributionResult => {
  const rows = new Map<string, ContributionStockRow>();
  const ensure = (code: string, name: string): ContributionStockRow => {
    const hit = rows.get(code);
    if (hit) return hit;
    const row: ContributionStockRow = {
      code,
      name,
      actual: 0,
      counterfactual: 0,
      contribution: 0,
      buyCount: 0,
      buyAmount: 0,
      rounds: 0,
    };
    rows.set(code, row);
    return row;
  };

  // 实际盈亏：清仓回合官方 profit 直接累加（closed + 持有中回合的已实现部分）
  for (const c of cleared) {
    const row = ensure(c.code, c.name);
    row.actual += c.profit;
    row.rounds += c.rounds;
  }

  // 反事实：逐笔买入 ×（末日 ÷ 买入日 − 1）
  let unscoredBuys = 0;
  for (const t of trades) {
    if (!t.action.includes('买')) continue;
    const row = ensure(t.code, t.name);
    row.buyCount += 1;
    const amount = Math.abs(t.amount);
    row.buyAmount += amount;
    const series = seriesById.get(t.code);
    if (!series || series.dates.length === 0) {
      unscoredBuys += 1;
      continue;
    }
    const buy = findCloseOnOrBefore(series, t.date);
    if (buy === null || buy.close <= 0) {
      unscoredBuys += 1;
      continue;
    }
    const lastDate = series.dates[series.dates.length - 1];
    const endClose = series.closes.get(lastDate) ?? 0;
    if (endClose <= 0) {
      unscoredBuys += 1;
      continue;
    }
    row.counterfactual += amount * (endClose / buy.close - 1);
  }

  const list = [...rows.values()];
  for (const row of list) row.contribution = row.actual - row.counterfactual;
  list.sort((a, b) => b.contribution - a.contribution);

  return {
    actualTotal: list.reduce((s, r) => s + r.actual, 0),
    counterfactualTotal: list.reduce((s, r) => s + r.counterfactual, 0),
    contributionTotal: list.reduce((s, r) => s + r.contribution, 0),
    rows: list,
    unscoredBuys,
  };
};

import dayjs from 'dayjs';
import { backtest, screen, normalizeSymbol, toTencentSymbol } from 'stock-sdk';
import type { BacktestReport } from '../types/screener.types';
import type { HistoryKline, KlineWithIndicators } from '../types/kline.types';
import type { FullQuote } from '../types/stock-quote.types';
import {
  BACKTEST_FEE,
  BACKTEST_RANGE_DAYS,
  BACKTEST_INITIAL_CAPITAL,
} from '../constants/screener.constants';
import { KLINE_ADJUST, KLINE_PERIOD } from '../constants/kline.constants';
import { fetchAllMarketQuotes } from './quotes.api';
import { sdk } from './sdk';

/**
 * 选股条件（区间为闭区间；字段缺省表示不过滤）
 */
export interface ScreenerFilters {
  /** 涨跌幅下限（%） */
  changeMin?: number;
  /** 涨跌幅上限（%） */
  changeMax?: number;
  /** 换手率下限（%） */
  turnoverMin?: number;
  /** 换手率上限（%） */
  turnoverMax?: number;
  /** 量比下限 */
  volumeRatioMin?: number;
  /** 市盈率 TTM 上限 */
  peMax?: number;
}

/**
 * 运行选股：全市场快照（小并发分页）+ SDK 链式筛选，按成交额降序取前 N
 *
 ⚠️ 重接口（全市场快照）：由用户点击触发，不做轮询
 * @param filters 筛选条件
 * @param topN 结果条数
 * @returns 筛选结果（FullQuote 列表）
 */
export const runScreener = async (
  filters: ScreenerFilters,
  topN: number,
): Promise<FullQuote[]> => {
  const quotes = await fetchAllMarketQuotes();
  return screen(quotes)
    .where((quote) => filters.changeMin === undefined || quote.changePercent >= filters.changeMin)
    .where((quote) => filters.changeMax === undefined || quote.changePercent <= filters.changeMax)
    .where(
      (quote) =>
        filters.turnoverMin === undefined ||
        (quote.turnoverRate !== null && quote.turnoverRate >= filters.turnoverMin),
    )
    .where(
      (quote) =>
        filters.turnoverMax === undefined ||
        (quote.turnoverRate !== null && quote.turnoverRate <= filters.turnoverMax),
    )
    .where(
      (quote) =>
        filters.volumeRatioMin === undefined ||
        (quote.volumeRatio !== null && quote.volumeRatio >= filters.volumeRatioMin),
    )
    .where(
      (quote) => filters.peMax === undefined || (quote.pe !== null && quote.pe <= filters.peMax),
    )
    .sortBy((quote) => quote.amount)
    .top(topN);
};

/**
 * MA 金叉死叉策略：快线上穿慢线买入、下穿卖出（读 SDK 预计算指标，不引入前视）
 * @param bar 当前 K 线（含 ma 指标）
 * @param index 当前下标
 * @param series 完整 K 线序列
 * @returns 买卖信号
 */
const maCrossStrategy = (
  bar: KlineWithIndicators<HistoryKline>,
  index: number,
  series: readonly KlineWithIndicators<HistoryKline>[],
): 'buy' | 'sell' | 'hold' => {
  const prev = series[index - 1];
  const fastNow = bar.ma?.ma5 ?? null;
  const slowNow = bar.ma?.ma20 ?? null;
  const fastPrev = prev?.ma?.ma5 ?? null;
  const slowPrev = prev?.ma?.ma20 ?? null;
  if (fastNow === null || slowNow === null || fastPrev === null || slowPrev === null) {
    return 'hold';
  }
  if (fastPrev <= slowPrev && fastNow > slowNow) {
    return 'buy';
  }
  if (fastPrev >= slowPrev && fastNow < slowNow) {
    return 'sell';
  }
  return 'hold';
};

/** 回测结果：报告 + 权益曲线数据（供图表渲染） */
export interface BacktestResult {
  /** SDK 回测报告（含买入持有基准） */
  report: BacktestReport;
  /** 日期序列（与权益曲线对齐） */
  dates: string[];
  /** 策略权益曲线（元） */
  equityCurve: number[];
  /** 买入持有基准权益曲线（元，不含费） */
  buyHoldCurve: number[];
}

/**
 * 运行 MA 金叉死叉回测（近一年日 K，前复权）
 *
 ⚠️ 重接口（K 线）：由用户点击触发，不做轮询
 * @param rawSymbol 用户输入符号（600519 / sh600519 均可）
 * @returns 回测报告与权益曲线
 */
export const runMaCrossBacktest = async (rawSymbol: string): Promise<BacktestResult> => {
  const symbol = toTencentSymbol(normalizeSymbol(rawSymbol.trim()));
  const bars = await sdk.kline.withIndicators(symbol, {
    period: KLINE_PERIOD.DAILY,
    adjust: KLINE_ADJUST.QFQ,
    startDate: dayjs().subtract(BACKTEST_RANGE_DAYS, 'day').format('YYYYMMDD'),
    indicators: { ma: [5, 20] },
  }) as KlineWithIndicators<HistoryKline>[];

  const report = backtest({
    klines: bars,
    strategy: maCrossStrategy,
    initialCapital: BACKTEST_INITIAL_CAPITAL,
    fee: { ...BACKTEST_FEE },
    getDate: (bar) => bar.date,
  });

  // 买入持有基准曲线：initial * close[i] / close[0]（首个有效收盘）
  const firstClose = bars.find((bar) => bar.close !== null)?.close ?? 1;
  const dates = bars.map((bar) => bar.date);
  const equityCurve = report.equityCurve;
  const buyHoldCurve = bars.map((bar) =>
    bar.close === null ? BACKTEST_INITIAL_CAPITAL : (bar.close / firstClose) * BACKTEST_INITIAL_CAPITAL,
  );

  return { report, dates, equityCurve, buyHoldCurve };
};

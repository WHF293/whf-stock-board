import dayjs from 'dayjs';
import { backtest, calcMA, screen } from 'stock-sdk';
import type { BacktestReport } from '../types/screener.types';
import type { FullQuote } from '../types/stock-quote.types';
import {
  BACKTEST_FEE,
  BACKTEST_RANGE_DAYS,
  BACKTEST_INITIAL_CAPITAL,
} from '../constants/screener.constants';
import { fetchKlineCached } from './kline-cache.api';
import { fetchAllMarketQuotes } from './quotes.api';
import { toFullSymbol } from '../utils/to-full-symbol';

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

/** 回测 K 线项（新浪日 K 截取近一年窗口 + MA 指标） */
interface BacktestBar {
  /** 交易日（YYYY-MM-DD） */
  date: string;
  /** 收盘价（不复权） */
  close: number;
  /** MA 指标（ma5 / ma20） */
  ma: Record<string, number | null>;
}

/**
 * MA 金叉死叉策略：快线上穿慢线买入、下穿卖出（读预计算指标，不引入前视）
 * @param bar 当前 K 线（含 ma 指标）
 * @param index 当前下标
 * @param series 完整 K 线序列
 * @returns 买卖信号
 */
const maCrossStrategy = (
  bar: BacktestBar,
  index: number,
  series: readonly BacktestBar[],
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
 * 运行 MA 金叉死叉回测（近一年日 K）
 *
 * ⚠️ 东财行情域（push2his）本机被封，`sdk.kline.withIndicators` 不可用，
 * 改走新浪 `fetchSinaKline`（数据源更换可行性报告 · 方案 A）。
 * ⚠️ 新浪日 K 为不复权：除权日附近会产生虚假跳空，回测结果为近似口径（R1 已知限制）。
 * @param rawSymbol 用户输入符号（600519 / sh600519 均可）
 * @returns 回测报告与权益曲线
 */
export const runMaCrossBacktest = async (rawSymbol: string): Promise<BacktestResult> => {
  // ⚠️ 必须用 toFullSymbol：normalizeSymbol 返回 NormalizedSymbol 对象，
  // String() 会得到 "[object Object]"，新浪取数恒空（回测曾因此全部失败）
  const symbol = toFullSymbol(rawSymbol);
  // 单票回测（用户指定标的）⇒ 走本地缓存：首次落库、之后只补缺口，本地截取近一年窗口
  const allBars = await fetchKlineCached(symbol, 'daily');
  const startTs = dayjs().subtract(BACKTEST_RANGE_DAYS, 'day').startOf('day').valueOf();
  const bars = allBars.filter((bar) => bar.timestamp >= startTs);
  if (bars.length < 40) {
    throw new Error(`日 K 数据不足（仅 ${bars.length} 根），无法回测`);
  }

  const maRows = calcMA(
    bars.map((bar) => bar.close),
    { periods: [5, 20] },
  );
  const backtestBars: BacktestBar[] = bars.map((bar, index) => ({
    date: dayjs(bar.timestamp).format('YYYY-MM-DD'),
    close: bar.close,
    ma: maRows[index],
  }));

  const report = backtest<BacktestBar>({
    klines: backtestBars,
    strategy: maCrossStrategy,
    initialCapital: BACKTEST_INITIAL_CAPITAL,
    fee: { ...BACKTEST_FEE },
    getDate: (bar) => bar.date,
  });

  // 买入持有基准曲线：initial * close[i] / close[0]（首个有效收盘）
  const firstClose = backtestBars.find((bar) => bar.close > 0)?.close ?? 1;
  const dates = backtestBars.map((bar) => bar.date);
  const equityCurve = report.equityCurve;
  const buyHoldCurve = backtestBars.map((bar) =>
    (bar.close / firstClose) * BACKTEST_INITIAL_CAPITAL,
  );

  return { report, dates, equityCurve, buyHoldCurve };
};

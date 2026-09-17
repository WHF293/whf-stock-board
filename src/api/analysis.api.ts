import { calcBOLL, calcMA, calcMACD, calcRSI } from 'stock-sdk';
import type {
  AnalysisProgress,
  EodFilters,
  EodStock,
  ScanSignalResult,
  ScannerPoolItem,
  SignalKey,
} from '../types/analysis.types';
import type { FullQuote } from '../types/stock-quote.types';
import type { TodayTimelineResponse } from '../types/kline.types';
import { SCAN_CONCURRENCY, EOD_TIMELINE_CONCURRENCY, SCAN_KLINE_BARS } from '../constants/analysis.constants';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { fetchKlineCached } from './kline-cache.api';
import { fetchAllMarketQuotes } from './quotes.api';
import { sdk } from './sdk';

/**
 * 选股分析 api：技术信号扫描 + 尾盘选股（逻辑参考 stock-dashboard 实现）
 *
 * 信号扫描：对股票池逐票拉新浪日 K（SDK 纯函数按需算指标），判定 MA/MACD/RSI/BOLL 八种信号；
 * 尾盘选股：全市场快照做基础过滤（市值/量比/涨幅/换手/ST），再按分时强度
 * （分时价位于均价上方的时间占比）精筛
 */

/** 信号扫描 K 线数据项（含按需启用的指标） */
interface ScanKlineBar {
  close: number | null;
  ma?: Record<string, number | null>;
  macd?: { dif?: number | null; dea?: number | null; macd?: number | null };
  rsi?: Record<string, number | null>;
  boll?: { upper?: number | null; mid?: number | null; lower?: number | null };
}

/** 进度回调 */
type ProgressCallback = (progress: AnalysisProgress) => void;

/** 信号扫描按需指标开关 */
interface ScanIndicatorFlags {
  /** MA（ma5 / ma10） */
  ma?: boolean;
  /** MACD（dif / dea / macd） */
  macd?: boolean;
  /** RSI（rsi6 / rsi12） */
  rsi?: boolean;
  /** BOLL（upper / mid / lower） */
  boll?: boolean;
}

/** 扫描选项 */
interface ScanOptions {
  /** 中断信号（取消扫描） */
  signal?: AbortSignal;
  /** 进度回调 */
  onProgress?: ProgressCallback;
  /** 每命中一只票即时回调（边扫边出结果） */
  onResult?: (result: ScanSignalResult) => void;
}

/**
 * 判定单票 K 线最新两根 bar 命中的信号标签
 * @param bars 日 K 序列（升序，含按需指标）
 * @param signals 启用的信号 key
 * @returns 命中的信号标签（如 ['MA金叉']）
 */
const detectSignals = (bars: ScanKlineBar[], signals: SignalKey[]): string[] => {
  const detected: string[] = [];
  if (bars.length < 3) {
    return detected;
  }
  const latest = bars.at(-1)!;
  const prev = bars.at(-2)!;
  const maKeyFast = 'ma5';
  const maKeySlow = 'ma10';

  if (
    (signals.includes('ma_golden') || signals.includes('ma_death')) &&
    latest.ma &&
    prev.ma
  ) {
    const latestFast = latest.ma[maKeyFast];
    const latestSlow = latest.ma[maKeySlow];
    const prevFast = prev.ma[maKeyFast];
    const prevSlow = prev.ma[maKeySlow];
    if (
      latestFast !== null &&
      latestFast !== undefined &&
      latestSlow !== null &&
      latestSlow !== undefined &&
      prevFast !== null &&
      prevFast !== undefined &&
      prevSlow !== null &&
      prevSlow !== undefined
    ) {
      if (signals.includes('ma_golden') && latestFast > latestSlow && prevFast <= prevSlow) {
        detected.push('MA金叉');
      }
      if (signals.includes('ma_death') && latestFast < latestSlow && prevFast >= prevSlow) {
        detected.push('MA死叉');
      }
    }
  }

  if (
    (signals.includes('macd_golden') || signals.includes('macd_death')) &&
    latest.macd &&
    prev.macd
  ) {
    const latestDif = latest.macd.dif ?? 0;
    const latestDea = latest.macd.dea ?? 0;
    const prevDif = prev.macd.dif ?? 0;
    const prevDea = prev.macd.dea ?? 0;
    if (signals.includes('macd_golden') && latestDif > latestDea && prevDif <= prevDea) {
      detected.push('MACD金叉');
    }
    if (signals.includes('macd_death') && latestDif < latestDea && prevDif >= prevDea) {
      detected.push('MACD死叉');
    }
  }

  if (signals.includes('rsi_oversold') && latest.rsi) {
    const rsi6 = latest.rsi['rsi6'] ?? Number.POSITIVE_INFINITY;
    const rsi12 = latest.rsi['rsi12'] ?? Number.POSITIVE_INFINITY;
    if (rsi6 < 30 || rsi12 < 30) {
      detected.push('RSI超卖');
    }
  }

  if (signals.includes('rsi_overbought') && latest.rsi) {
    const rsi6 = latest.rsi['rsi6'] ?? Number.NEGATIVE_INFINITY;
    const rsi12 = latest.rsi['rsi12'] ?? Number.NEGATIVE_INFINITY;
    if (rsi6 > 70 || rsi12 > 70) {
      detected.push('RSI超买');
    }
  }

  if (signals.includes('boll_upper') && latest.boll) {
    const upper = latest.boll.upper;
    if (upper !== null && upper !== undefined && (latest.close ?? 0) > upper) {
      detected.push('BOLL突破上轨');
    }
  }

  if (signals.includes('boll_lower') && latest.boll) {
    const lower = latest.boll.lower;
    if (lower !== null && lower !== undefined && (latest.close ?? 0) < lower) {
      detected.push('BOLL跌破下轨');
    }
  }

  return detected;
};

/**
 * 拉取单票日 K 并按需计算指标（新浪源 + SDK 纯函数）
 *
 * ⚠️ 东财行情域（push2his）本机被封，`sdk.kline.withIndicators` 不可用，
 * 改走新浪 `fetchSinaKline`（数据源更换可行性报告 · 方案 A）。
 * ⚠️ 新浪日 K 为不复权：除权日附近指标可能失真（方案报告 R1 已知限制）。
 * ⚠️ 整池逐票扫描必须 `write: false`：否则点一次扫描就会把整个股票池的日 K 写进本地库
 * （本地缓存只服务「用户真的在看某只票」的场景，见 api/kline-cache.api.ts）。
 * @param symbol 完整符号（sh/sz 前缀；北交所新浪源不支持，由调用方跳过）
 * @param flags 按需启用的指标（减少无谓计算）
 * @returns 含指标的 K 线序列（升序）
 * @throws 上游返回为空或请求失败时抛错
 */
const fetchScanBars = async (
  symbol: string,
  flags: ScanIndicatorFlags,
): Promise<ScanKlineBar[]> => {
  const bars = await fetchKlineCached(symbol, 'daily', {
    write: false,
    barLimit: SCAN_KLINE_BARS,
  });
  if (bars.length === 0) {
    throw new Error(`新浪日K返回为空：${symbol}`);
  }
  const closes: (number | null)[] = bars.map((bar) => bar.close);
  const maRows = flags.ma ? calcMA(closes, { periods: [5, 10] }) : null;
  const macdRows = flags.macd ? calcMACD(closes) : null;
  const rsiRows = flags.rsi ? calcRSI(closes, { periods: [6, 12] }) : null;
  const bollRows = flags.boll ? calcBOLL(closes) : null;
  return bars.map((bar, index) => ({
    close: bar.close,
    ...(maRows ? { ma: maRows[index] } : {}),
    ...(macdRows ? { macd: macdRows[index] } : {}),
    ...(rsiRows ? { rsi: rsiRows[index] } : {}),
    ...(bollRows ? { boll: bollRows[index] } : {}),
  }));
};

/**
 * 技术信号扫描：对股票池逐票拉新浪日 K（按需指标）并判定命中
 *
 * 单票取数失败仅跳过该票（记 console.error），不中断整场扫描
 * @param pool 股票池
 * @param signals 启用的信号 key（决定计算哪些指标）
 * @param options 中断 / 进度 / 即时结果回调
 * @returns 命中信号的结果列表
 */
export const scanSignalPool = async (
  pool: readonly ScannerPoolItem[],
  signals: readonly SignalKey[],
  options?: ScanOptions,
): Promise<ScanSignalResult[]> => {
  if (pool.length === 0 || signals.length === 0) {
    return [];
  }

  // 指标按需启用，减少无谓计算
  const flags: ScanIndicatorFlags = {
    ma: signals.some((key) => key.startsWith('ma_')),
    macd: signals.some((key) => key.startsWith('macd_')),
    rsi: signals.some((key) => key.startsWith('rsi_')),
    boll: signals.some((key) => key.startsWith('boll_')),
  };

  return mapWithConcurrency(
    pool,
    async (stock): Promise<ScanSignalResult | null> => {
      try {
        const bars = await fetchScanBars(stock.symbol, flags);
        const matchedLabels = detectSignals(bars, [...signals]);
        if (matchedLabels.length === 0) {
          return null;
        }
        const result: ScanSignalResult = {
          code: stock.code,
          symbol: stock.symbol,
          name: stock.name,
          matchedLabels,
        };
        options?.onResult?.(result);
        return result;
      } catch (error) {
        console.error(`[signal-scan] ${stock.symbol} 日K取数/指标失败，跳过`, error);
        return null;
      }
    },
    {
      concurrency: SCAN_CONCURRENCY,
      signal: options?.signal,
      onProgress: (completed, total) => {
        options?.onProgress?.({ stage: '技术信号扫描', completed, total });
      },
    },
  ).then((results) => results.filter((item): item is ScanSignalResult => item !== null));
};

/**
 * 计算分时强度：分时价位于均价上方的时间占比（%）
 * @param timeline 当日分时数据
 * @returns 强度占比（0~100）；无数据为 0
 */
export const calculateTimelineStrength = (timeline: TodayTimelineResponse): number => {
  if (!timeline.data || timeline.data.length === 0) {
    return 0;
  }
  const aboveCount = timeline.data.filter(
    (item: { price?: number | null; avgPrice?: number | null }) =>
      (item.price ?? 0) >= (item.avgPrice ?? Number.POSITIVE_INFINITY),
  ).length;
  return (aboveCount / timeline.data.length) * 100;
};

/**
 * 尾盘选股基础过滤（全市场快照 -> 市值/量比/涨幅/换手/ST 条件）
 * @param quotes 全市场报价
 * @param filters 过滤条件（流通市值单位为亿）
 * @returns 过滤后的列表（按涨跌幅降序）
 */
const filterEodQuotes = (quotes: readonly FullQuote[], filters: EodFilters): FullQuote[] =>
  quotes
    .filter((quote) => {
      if (filters.excludeST && (quote.name.includes('ST') || quote.name.includes('*ST'))) {
        return false;
      }
      const marketCapYi = quote.circulatingMarketCap;
      if (
        marketCapYi === null ||
        marketCapYi < filters.marketCapMin ||
        (filters.marketCapMax !== null && marketCapYi > filters.marketCapMax)
      ) {
        return false;
      }
      const changePercent = quote.changePercent ?? -Infinity;
      if (
        changePercent < filters.changePercentMin ||
        (filters.changePercentMax !== null && changePercent > filters.changePercentMax)
      ) {
        return false;
      }
      const turnoverRate = quote.turnoverRate;
      if (
        turnoverRate === null ||
        turnoverRate < filters.turnoverRateMin ||
        (filters.turnoverRateMax !== null && turnoverRate > filters.turnoverRateMax)
      ) {
        return false;
      }
      const volumeRatio = quote.volumeRatio;
      return volumeRatio !== null && volumeRatio >= filters.volumeRatioMin;
    })
    .sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));

/**
 * 尾盘选股：全市场快照基础过滤后，逐票拉分时按「分时强度」精筛
 * @param filters 过滤条件
 * @param options 中断 / 进度回调
 * @param options.signal
 * @param options.onProgress
 * @returns 按分时强度降序的结果列表
 */
export const analyzeEodStocks = async (
  filters: EodFilters,
  options?: {
    signal?: AbortSignal;
    onProgress?: ProgressCallback;
  },
): Promise<EodStock[]> => {
  options?.onProgress?.({ stage: '获取行情数据', completed: 0, total: 0 });

  // 治理过的全市场快照（小并发分页，避免触发上游反爬）
  const quotes = await fetchAllMarketQuotes();
  const candidates = filterEodQuotes(quotes, filters);

  if (candidates.length === 0) {
    return [];
  }

  options?.onProgress?.({
    stage: '分时结构筛选',
    completed: 0,
    total: candidates.length,
  });

  const results = await mapWithConcurrency(
    candidates,
    async (quote): Promise<EodStock | null> => {
      // FullQuote.code 实测为 sz000002 完整符号形态，可直接消费
      const symbol = quote.code;
      // 单票分时失败（北交所不支持 / 停牌无数据 / 偶发网络错误）仅跳过，不中断整场筛选
      let ratio: number;
      try {
        const timeline = await sdk.quotes.timeline(symbol);
        ratio = calculateTimelineStrength(timeline);
      } catch (error) {
        console.error(`[eod-picker] ${symbol} 分时拉取失败，跳过`, error);
        return null;
      }
      if (ratio < filters.timelineAboveAvgRatioMin) {
        return null;
      }
      return {
        code: symbol.replace(/^(sh|sz|bj)/, ''),
        symbol,
        name: quote.name,
        price: quote.price ?? 0,
        changePercent: quote.changePercent ?? 0,
        turnoverRate: quote.turnoverRate,
        volumeRatio: quote.volumeRatio,
        circulatingMarketCap: quote.circulatingMarketCap,
        timelineAboveAvgRatio: Math.round(ratio * 100) / 100,
      };
    },
    {
      concurrency: EOD_TIMELINE_CONCURRENCY,
      signal: options?.signal,
      onProgress: (completed, total) => {
        options?.onProgress?.({ stage: '分时结构筛选', completed, total });
      },
    },
  );

  return results
    .filter((item): item is EodStock => item !== null)
    .sort((a, b) => b.timelineAboveAvgRatio - a.timelineAboveAvgRatio);
};

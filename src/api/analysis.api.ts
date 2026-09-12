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
import { SCAN_CONCURRENCY, EOD_TIMELINE_CONCURRENCY } from '../constants/analysis.constants';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { fetchAllMarketQuotes } from './quotes.api';
import { sdk } from './sdk';

/**
 * 选股分析 api：技术信号扫描 + 尾盘选股（逻辑参考 stock-dashboard 实现）
 *
 * 信号扫描：对股票池逐票拉「日线前复权 + 按需指标」K 线，判定 MA/MACD/RSI/BOLL 八种信号；
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
 * 技术信号扫描：对股票池逐票拉日线前复权 K 线（按需指标）并判定命中
 * @param pool 股票池
 * @param signals 启用的信号 key（决定拉取哪些指标）
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
  const indicators = {
    ...(signals.some((key) => key.startsWith('ma_')) ? { ma: [5, 10] } : {}),
    ...(signals.some((key) => key.startsWith('macd_')) ? { macd: {} } : {}),
    ...(signals.some((key) => key.startsWith('rsi_')) ? { rsi: [6, 12] } : {}),
    ...(signals.some((key) => key.startsWith('boll_')) ? { boll: {} } : {}),
  };

  return mapWithConcurrency(
    pool,
    async (stock): Promise<ScanSignalResult | null> => {
      const bars = (await sdk.kline.withIndicators(stock.symbol, {
        period: 'daily',
        adjust: 'qfq',
        indicators,
      })) as unknown as ScanKlineBar[];

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

  // 治理过的全市场快照（串行分页，避免触发上游反爬）
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
      const timeline = await sdk.quotes.timeline(symbol);
      const ratio = calculateTimelineStrength(timeline);
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

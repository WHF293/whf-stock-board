import dayjs from 'dayjs';
import { calcChipDistribution, normalizeSymbol } from 'stock-sdk';
import {
  KLINE_RANGE_DAYS,
  MA_FAST_PERIOD,
  MA_SLOW_PERIOD,
} from '../constants/kline.constants';
import type {
  ChipDistributionItem,
  HistoryKline,
  KlineSignal,
  KlineWithIndicators,
  KlinePeriod,
  KlineAdjust,
  TodayTimelineResponse,
} from '../types/kline.types';
import { fetchSinaKline } from './sina-kline.api';
import { sdk } from './sdk';

/**
 * 拉取当日分时（腾讯源，JSONP 直连）
 * @param symbol 完整符号（sh600519 形态）
 * @returns 当日分时响应（含昨收与逐分钟价格 / 均价）
 */
export const fetchTodayTimeline = async (symbol: string): Promise<TodayTimelineResponse> =>
  sdk.quotes.timeline(symbol);

/**
 * 计算近一年 K 窗口的起始日期（YYYYMMDD）
 * @returns 起始日期字符串
 */
const buildKlineStartDate = (): string =>
  dayjs().subtract(KLINE_RANGE_DAYS, 'day').format('YYYYMMDD');

/**
 * 拉取带指标的日 / 周 K 线（东财源 + 本地指标计算）
 *
 * 指标口径固定 MA[5,20] + MACD，与信号识别（fetchKlineSignals）一致
 * @param symbol 完整符号
 * @param period K 线周期
 * @param adjust 复权方式
 * @returns 附加 ma / macd 字段的 K 线序列（按时间升序）
 */
export const fetchKlineWithIndicators = async (
  symbol: string,
  period: KlinePeriod,
  adjust: KlineAdjust,
): Promise<KlineWithIndicators<HistoryKline>[]> =>
  sdk.kline.withIndicators(symbol, {
    period,
    adjust,
    startDate: buildKlineStartDate(),
    indicators: { ma: [MA_FAST_PERIOD, MA_SLOW_PERIOD], macd: true },
  }) as Promise<KlineWithIndicators<HistoryKline>[]>;

/**
 * 拉取技术信号（MA / MACD 金叉死叉等 14 种，近一年窗口）
 * @param symbol 完整符号
 * @param period K 线周期
 * @param adjust 复权方式
 * @returns 信号列表（含日期与收盘价）
 */
export const fetchKlineSignals = async (
  symbol: string,
  period: KlinePeriod,
  adjust: KlineAdjust,
): Promise<KlineSignal[]> =>
  sdk.kline.signals(symbol, {
    period,
    adjust,
    startDate: buildKlineStartDate(),
    maFast: MA_FAST_PERIOD,
    maSlow: MA_SLOW_PERIOD,
  });

/**
 * 计算筹码分布（本地推演）：
 * - 数据源：新浪日 K（与主图口径一致，不复权）
 * - 计算：stock-sdk `calcChipDistribution`，以近 120 日窗口、东财默认 6 位小数舍入；
 *   换手率（turnoverRate）上游未提供，暂以 0 传入（沿用东财 `hsl/100 || 0` 语义），
 *   即按等权推演各日成本，最终分布仅用于形态展示，与真实换手率加权存在偏差
 * @param symbol 完整符号（sh600519 形态）
 * @returns 逐日筹码统计序列；仅最后一行附带当前筹码峰直方图
 */
export const fetchChipDistribution = async (
  symbol: string,
): Promise<ChipDistributionItem[]> => {
  const bars = await fetchSinaKline(String(normalizeSymbol(symbol)), 'daily');
  const klines = bars.map((bar) => ({
    date: dayjs(bar.timestamp).format('YYYY-MM-DD'),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    turnoverRate: 0,
  }));
  // 倒序输入可让最近日的累积窗口先满；函数本身对顺序无要求
  return calcChipDistribution(klines, {
    range: 120,
    includeHistogram: 'last',
    tail: 1,
  });
};

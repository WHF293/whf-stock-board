import dayjs from 'dayjs';
import {
  KLINE_RANGE_DAYS,
  MA_FAST_PERIOD,
  MA_SLOW_PERIOD,
} from '../constants/kline.constants';
import type {
  HistoryKline,
  KlineSignal,
  KlineWithIndicators,
  KlinePeriod,
  KlineAdjust,
  TodayTimelineResponse,
} from '../types/kline.types';
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


import { SUPPORTED_MARKET } from '../constants/market-status.constants';
import type { MarketStatus } from '../types/market-status.types';
import { sdk } from './sdk';

/**
 * 判断今天是否 A 股交易日（异步；首次调用拉取并缓存交易日历，后续命中实例缓存）
 * @returns true 表示今天为交易日
 */
export const fetchIsTradingDay = async (): Promise<boolean> => sdk.calendar.isTradingDay();

/**
 * 读取当前 A 股市场状态（同步方法，不发请求）
 *
 * 注意：仅按交易时段判断、不识别法定假日；
 * 需要精确判断时应先 await fetchIsTradingDay() 保证日历就绪
 * @returns 当前市场状态（盘前/交易中/午休/盘后/休市）
 */
export const getMarketStatus = (): MarketStatus => sdk.calendar.marketStatus(SUPPORTED_MARKET.A);

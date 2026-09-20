import type {
  BoardChangeItem,
  StockChangeItem,
  ZTPoolItem,
  ZTPoolType,
} from '../types/event.types';
import { sdk } from './sdk';

/**
 * 拉取涨停/跌停等股池（东财源，经同源代理转发）
 *
 * `date` 用于取**指定交易日**的池子（实测上游支持，但只覆盖近端：一个月前的日期返回空池）。
 * 不传即取当日。
 * @param type 池子类型（涨停/昨日涨停/强势/次新/炸板/跌停）
 * @param date 交易日 `YYYY-MM-DD` / `YYYYMMDD`；缺省为当日
 * @returns 股池成员列表
 */
export const fetchZtPool = async (type: ZTPoolType, date?: string): Promise<ZTPoolItem[]> =>
  sdk.marketEvent.ztPool(type, date);

/**
 * 拉取全市场盘口异动（东财源，滚动时间轴）
 * @returns 盘口异动列表（time 升序，取上游原序）
 */
export const fetchStockChanges = async (): Promise<StockChangeItem[]> =>
  sdk.marketEvent.stockChanges('all');

/**
 * 拉取板块异动汇总（东财源）
 * @returns 板块异动列表（异动次数 / 主力净流入 / 最频繁个股）
 */
export const fetchBoardChanges = async (): Promise<BoardChangeItem[]> =>
  sdk.marketEvent.boardChanges();

import type {
  BoardChangeItem,
  StockChangeItem,
  ZTPoolItem,
  ZTPoolType,
} from '../types/event.types';
import { sdk } from './sdk';

/**
 * 拉取涨停/跌停等股池（东财源，经同源代理转发）
 * @param type 池子类型（涨停/昨日涨停/强势/次新/炸板/跌停）
 * @returns 股池成员列表
 */
export const fetchZtPool = async (type: ZTPoolType): Promise<ZTPoolItem[]> =>
  sdk.marketEvent.ztPool(type);

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

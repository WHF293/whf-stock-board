import dayjs from 'dayjs';
import {
  BLOCK_TRADE_RANGE_DAYS,
  DRAGON_TIGER_RANGE_DAYS,
} from '../constants/dragon-tiger.constants';
import type { BlockTradeDetailItem, DragonTigerDetailItem } from '../types/dragon-tiger.types';
import { sdk } from './sdk';

/**
 * 拉取龙虎榜明细（东财源，近 N 日区间）
 *
 ⚠️ 重接口：仅在进入页面或切换日期时拉取，不参与轮询
 * @returns 龙虎榜上榜明细（多日，按 date 字段区分）
 */
export const fetchDragonTigerDetail = async (): Promise<DragonTigerDetailItem[]> =>
  sdk.dragonTiger.detail({
    startDate: dayjs().subtract(DRAGON_TIGER_RANGE_DAYS, 'day').format('YYYYMMDD'),
    endDate: dayjs().format('YYYYMMDD'),
  });

/**
 * 拉取大宗交易明细（东财源，近 N 日区间）
 *
 ⚠️ 重接口：仅在进入页面或切换日期时拉取，不参与轮询
 * @returns 大宗交易成交明细（多日，按 date 字段区分）
 */
export const fetchBlockTradeDetail = async (): Promise<BlockTradeDetailItem[]> =>
  sdk.blockTrade.detail({
    startDate: dayjs().subtract(BLOCK_TRADE_RANGE_DAYS, 'day').format('YYYYMMDD'),
    endDate: dayjs().format('YYYYMMDD'),
  });

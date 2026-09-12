import type {
  FundFlowRankItem,
  MarketFundFlow,
  NorthboundHoldingRankItem,
  SectorFundFlowItem,
  StockFundFlowDaily,
} from '../types/flow.types';
import { sdk } from './sdk';

/**
 * 拉取大盘资金流向历史（东财源，按日返回；最新一条即当日）
 * @returns 大盘资金流序列（主力 / 超大单 / 大中小单净流入）
 */
export const fetchMarketFundFlow = async (): Promise<MarketFundFlow[]> =>
  sdk.fundFlow.market();

/**
 * 拉取个股资金流向历史（东财源，按日返回）
 *
 * ⚠️ 重接口：仅在进入详情页或切换参数时调用一次，不参与轮询
 * @param symbol 完整符号（sh600519 形态）
 * @returns 个股逐日资金流序列（主力 / 超大单 / 大中小单净流入，单位元）
 */
export const fetchIndividualFundFlow = async (symbol: string): Promise<StockFundFlowDaily[]> =>
  sdk.fundFlow.individual(symbol);

/**
 * 拉取个股主力资金流排名（东财源）
 *
 ⚠️ 重接口：仅在进入资金动向页时拉取，不参与轮询
 * @returns 主力净流入排名（当日口径）
 */
export const fetchFundFlowRank = async (): Promise<FundFlowRankItem[]> =>
  sdk.fundFlow.rank({ indicator: 'today' });

/**
 * 拉取板块资金流排名（东财源）
 *
 ⚠️ 重接口：仅在进入资金动向页时拉取，不参与轮询
 * @returns 行业板块主力净流入排名
 */
export const fetchSectorFundFlowRank = async (): Promise<SectorFundFlowItem[]> =>
  sdk.fundFlow.sectorRank({ sectorType: 'industry' });

/**
 * 拉取北向持股排名（东财源）
 *
 ⚠️ 重接口：仅在进入资金动向页时拉取，不参与轮询
 * @returns 北向持股市值排名（当日口径）
 */
export const fetchNorthboundHoldingRank = async (): Promise<NorthboundHoldingRankItem[]> =>
  sdk.northbound.holdingRank({ market: 'all', period: 'today' });

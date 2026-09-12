import type {
  ConceptBoard,
  ConceptBoardConstituent,
  IndustryBoard,
  IndustryBoardConstituent,
} from '../types/board.types';
import { sdk } from './sdk';

/**
 * 拉取行业板块列表（东财源，经同源代理转发）
 * @returns 全部行业板块（含涨跌幅 / 总市值 / 上涨下跌家数）
 */
export const fetchIndustryBoards = async (): Promise<IndustryBoard[]> =>
  sdk.board.industry.list();

/**
 * 拉取概念板块列表（东财源，经同源代理转发；结构与行业板块一致）
 * @returns 全部概念板块
 */
export const fetchConceptBoards = async (): Promise<ConceptBoard[]> =>
  sdk.board.concept.list();

/**
 * 拉取行业板块成分股（东财源）
 *
 ⚠️ 重接口：仅在用户点击板块行时按需拉取，不参与轮询
 * @param symbol 板块符号（BK1027 形态，来自 IndustryBoard.code）
 * @returns 成分股列表（code 为 6 位纯代码形态）
 */
export const fetchIndustryConstituents = async (symbol: string): Promise<IndustryBoardConstituent[]> =>
  sdk.board.industry.constituents(symbol);

/**
 * 拉取概念板块成分股（东财源）
 *
 ⚠️ 重接口：仅在用户点击板块行 / 选股器选板块时按需拉取，不参与轮询
 * @param symbol 板块符号（BKxxxx 形态，来自 ConceptBoard.code）
 * @returns 成分股列表（code 为 6 位纯代码形态）
 */
export const fetchConceptConstituents = async (symbol: string): Promise<ConceptBoardConstituent[]> =>
  sdk.board.concept.constituents(symbol);

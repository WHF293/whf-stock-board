import type { SearchResult } from '../types/stock-quote.types';
import { sdk } from './sdk';

/**
 * 模糊搜索标的（代码 / 名称 / 拼音；腾讯搜索源，浏览器直连）
 * @param keyword 搜索关键词（建议 >= 2 字符，由调用方防抖控制）
 * @returns 搜索结果列表（code 为 sh600519 完整形态）
 */
export const searchStocks = async (keyword: string): Promise<SearchResult[]> =>
  sdk.search(keyword);

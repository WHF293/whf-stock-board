import { toBareCode } from './to-bare-code';
import type { FullQuote } from '../types/stock-quote.types';

/**
 * 按本地符号在报价映射里查报价（兼容上游返回的裸代码键）
 *
 * 报价映射由 `Object.fromEntries(list.map((q) => [q.code, q]))` 构建，
 * 而腾讯源返回的 `q.code` 是裸代码（`300339`）；本地存储的符号是完整形态
 * （`sz300339`）——只按原始符号查会永远取不到值（自选盯盘曾因此整列不刷新）。
 * @param quotesMap 报价映射（键可能是裸代码或完整符号）
 * @param symbol 本地符号（完整形态）
 * @returns 匹配到的报价；两种键形态都没有时返回 undefined
 */
export const findQuoteBySymbol = (
  quotesMap: Record<string, FullQuote>,
  symbol: string,
): FullQuote | undefined => quotesMap[symbol] ?? quotesMap[toBareCode(symbol)];

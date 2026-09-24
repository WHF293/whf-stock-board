import { findQuoteBySymbol } from './find-quote-by-symbol';
import type { FullQuote } from '../types/stock-quote.types';
import type { BatchAddResolveResult, BatchSymbolCandidate } from '../types/watchlist.types';

/**
 * 用行情结果判定候选代码是否真实存在，并取出真实名称
 *
 * ⚠️ 上游（腾讯 `qt.gtimg.cn`）对**不存在**的代码是**静默丢弃**：返回体里根本不出现那一行
 * （只有整批都不存在时才回一条 `v_pv_none_match="1"`），既不报错也不给空字段。
 * 实测 `fetchFullQuotes(['sz300033','sz999999','sh600519','sz888888'])` 只回 2 条。
 * 所以判定口径只能是「返回的报价里能否匹配到这一条」，匹配不到即视为查不到 —— 不能靠抛错。
 * @param candidates 解析出的候选（完整符号形态，见 parse-batch-symbols）
 * @param quotes 上游返回的报价（`code` 为裸代码，由 findQuoteBySymbol 兼容双形态）
 * @returns items 可入库标的（保序，名称取上游）；missing 查不到的原始输入（保序）
 */
export const matchBatchQuotes = (
  candidates: readonly BatchSymbolCandidate[],
  quotes: readonly FullQuote[],
): BatchAddResolveResult => {
  const quotesMap: Record<string, FullQuote> = {};
  for (const quote of quotes) {
    quotesMap[quote.code] = quote;
  }

  const items: BatchAddResolveResult['items'] = [];
  const missing: string[] = [];

  for (const candidate of candidates) {
    const quote = findQuoteBySymbol(quotesMap, candidate.symbol);
    if (quote) {
      items.push({
        input: candidate.input,
        symbol: candidate.symbol,
        // 上游偶发不返回名称时退化用符号，避免入库空名（表格会显示空白行）
        name: quote.name || candidate.symbol,
      });
    } else {
      missing.push(candidate.input);
    }
  }

  return { items, missing };
};

import { sdk } from './sdk';
import { fetchFullQuotes } from './quotes.api.ts';

/**
 * 行业龙头报价取数
 *
 * 龙头清单以完整符号（sh600519 / hk01801）维护，A 股走腾讯批量报价、
 * 港股走 `sdk.quotes.hk` 补齐（清单内仅 4 只港股），两端结果合并成一张
 * 「完整符号 → 轻报价」映射供卡片消费
 */

/** 龙头卡片轻报价 */
export interface LeaderQuote {
  /** 股票名称（报价源为准） */
  name: string;
  /** 当前价格 */
  price: number | null;
  /** 涨跌幅（%） */
  changePercent: number | null;
}

/**
 * 批量拉取龙头标的报价
 * @param symbols 完整符号列表（sh600519 / sz300274 / bj872808 / hk01801）
 * @returns 完整符号 → 轻报价映射（取不到行情的符号不在 Map 中，展示层按 `--` 兜底）
 */
export const fetchLeaderQuotes = async (
  symbols: readonly string[],
): Promise<Map<string, LeaderQuote>> => {
  const aShareSymbols = symbols.filter((symbol) => !symbol.startsWith('hk'));
  const hkSymbols = symbols.filter((symbol) => symbol.startsWith('hk'));

  const [aShareQuotes, hkQuotes] = await Promise.all([
    aShareSymbols.length > 0 ? fetchFullQuotes(aShareSymbols) : Promise.resolve([]),
    hkSymbols.length > 0
      ? sdk.quotes.hk(hkSymbols.map((symbol) => symbol.slice(2)))
      : Promise.resolve([]),
  ]);

  const map = new Map<string, LeaderQuote>();
  // FullQuote / HKQuote 的 code 都是裸代码：按「完整符号以裸代码结尾」回填请求顺序的符号键
  for (const symbol of symbols) {
    const bare = symbol.replace(/^(sh|sz|bj|hk)/, '');
    const hit =
      aShareQuotes.find((quote) => quote.code === bare) ??
      hkQuotes.find((quote) => quote.code === bare);
    if (hit) {
      map.set(symbol, {
        name: hit.name,
        price: hit.price,
        changePercent: hit.changePercent,
      });
    }
  }
  return map;
};

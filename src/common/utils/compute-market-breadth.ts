/**
 * 全市场快照 → 市场宽度统计（宽度家数 + 涨跌分组成交量 + ARMS，纯函数）
 *
 * 口径：涨跌幅非有限数值（停牌/异常）的标的剔除，不计家数不计量；
 * ARMS = (上涨家数 ÷ 下跌家数) ÷ (上涨成交量 ÷ 下跌成交量)，成交量取 volume（手），
 * 与通达信主流口径一致；分母为 0 时 ARMS/A/D 为 null（展示「--」）
 */
import type { FullQuote } from '../types/stock-quote.types.ts';
import type { MarketBreadth } from '../types/market-breadth.types.ts';

/**
 * 从全市场快照计算市场宽度统计
 * @param quotes 全市场完整报价列表（fetchAllMarketQuotes 结果）
 * @returns 市场宽度统计（arms / ad 无法计算时为 null）
 */
export const computeMarketBreadth = (quotes: readonly FullQuote[]): MarketBreadth => {
  let upCount = 0;
  let downCount = 0;
  let flatCount = 0;
  let upVol = 0;
  let downVol = 0;
  for (const quote of quotes) {
    const pct = quote.changePercent;
    if (typeof pct !== 'number' || !Number.isFinite(pct)) continue;
    const vol = quote.volume ?? 0;
    if (pct > 0) {
      upCount += 1;
      upVol += vol;
    } else if (pct < 0) {
      downCount += 1;
      downVol += vol;
    } else {
      flatCount += 1;
    }
  }
  const ad = downCount > 0 ? upCount / downCount : null;
  const arms =
    downCount > 0 && downVol > 0 ? upCount / downCount / (upVol / downVol) : null;
  return { upCount, downCount, flatCount, upVol, downVol, ad, arms };
};

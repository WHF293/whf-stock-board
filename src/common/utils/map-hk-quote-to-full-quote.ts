import dayjs from 'dayjs';
import type { HKQuote, HkMappedQuote } from '../types/stock-quote.types.ts';

/**
 * 港股报价 → 全量报价映射（纯函数）
 *
 * 量纲对齐 A 股 FullQuote 口径（全站消费方零改动）：
 * - volume：腾讯港股快照单位为**股**（实测 2026-10-30：腾讯控股 volume=922.5 万股 ×
 *   均价 382 港元 ≈ 成交额 35.2 亿），÷100 转「手」——与 A 股报价 volume 同口径，
 *   K 线悬停 use-crosshair-quote 的「股→手」÷100 换算对港股分钟线同样成立；
 * - amount：腾讯港股快照单位为**港元（元）**，÷10000 转「万」——与 A 股报价 amount 同口径；
 * - 市值：腾讯直出「亿港元」，与 FullQuote 同口径直取。
 *
 * 缺失字段（五档 / 换手 / 市盈 / 振幅 / 均价 / 涨跌停 / 52周 / 股本）：上游不返回，
 * 全部置 null / 空态，报价头网格对 null 已有「--」兜底。
 *
 * timestamp：SDK 对港股行情时间串解析为 null（实测），此处按本地时区补解析——
 * 港股时区 Asia/Hong_Kong 与北京同为 UTC+8，本地解析无损
 * @param quote SDK 港股报价
 * @param fullSymbol 完整符号（`hk00700` 形态；SDK 返回的 code 为 5 位裸码，需还原前缀）
 * @returns 全量报价（缺维字段为 null，由 UI 展示「--」；market 携带真实值 'HK'）
 */
export const mapHkQuoteToFullQuote = (
  quote: HKQuote,
  fullSymbol: string,
): HkMappedQuote => ({
  marketId: quote.marketId,
  name: quote.name,
  code: fullSymbol,
  price: quote.price,
  prevClose: quote.prevClose,
  open: quote.open,
  volume: quote.volume / 100,
  outerVolume: 0,
  innerVolume: 0,
  bid: [],
  ask: [],
  time: quote.time,
  timestamp:
    quote.timestamp ??
    (() => {
      const parsed = dayjs(quote.time.replace(/\//g, '-'));
      return parsed.isValid() ? parsed.valueOf() : null;
    })(),
  tz: quote.tz,
  change: quote.change,
  changePercent: quote.changePercent,
  high: quote.high,
  low: quote.low,
  volume2: quote.volume / 100,
  amount: quote.amount / 10_000,
  turnoverRate: null,
  pe: null,
  amplitude: null,
  circulatingMarketCap: quote.circulatingMarketCap,
  totalMarketCap: quote.totalMarketCap,
  pb: null,
  limitUp: null,
  limitDown: null,
  volumeRatio: null,
  avgPrice: null,
  peStatic: null,
  peDynamic: null,
  high52w: null,
  low52w: null,
  circulatingShares: null,
  totalShares: null,
  market: 'HK',
  assetType: 'stock',
  source: 'tencent',
});

/**
 * 从腾讯港股符号提取 5 位裸码（`hk00700` → `00700`，用于对齐 SDK 返回的 code）
 * @param fullSymbol 完整符号
 * @returns 5 位裸码
 */
const toBareCode = (fullSymbol: string): string => fullSymbol.replace(/^hk/i, '');

/**
 * 批量港股报价 → 全量报价映射（保持与入参一致的顺序）
 * @param fullSymbols 完整符号列表（`hk00700` 形态，与传入 sdk.quotes.hk 的入参同序）
 * @param quotes SDK 港股报价列表
 * @returns 全量报价列表（缺失的标的跳过；market 为真实值 'HK'，见 HkMappedQuote）
 */
export const mapHkQuotesToFullQuotes = (
  fullSymbols: readonly string[],
  quotes: HKQuote[],
): HkMappedQuote[] => {
  const quoteByCode = new Map(quotes.map((quote) => [quote.code, quote]));
  const result: HkMappedQuote[] = [];
  for (const fullSymbol of fullSymbols) {
    const bare = toBareCode(fullSymbol);
    const quote = quoteByCode.get(bare) ?? quoteByCode.get(fullSymbol);
    if (quote) {
      result.push(mapHkQuoteToFullQuote(quote, fullSymbol));
    }
  }
  return result;
};

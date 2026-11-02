import dayjs from 'dayjs';
import type { KLineData } from 'klinecharts';
import type { FullQuote } from '../types/stock-quote.types.ts';

/**
 * 向日 K 序列拼接「当日实时柱」（2026-11-02 王总反馈：日K图缺少当日的K线柱子）
 *
 * 背景：新浪日 K（scale=240）盘中**不含当日未走完的柱子**，最新只到上一交易日；
 * 当日行情由 4s 轮询的实时报价（FullQuote）拼出 OHLCV 补进序列：
 * - 库内最新 bar 早于报价所属日 ⇒ 追加当日柱；
 * - 库内最新 bar 就是当日（收盘后上游已含真数据）⇒ 用报价覆盖刷新；
 * - 报价所属日早于库内最新 bar（陈旧快照，如周末开市前）⇒ 原样返回不拼。
 *
 * 量纲换算：K 线 volume = 股（新浪口径）↔ 报价 volume = 手 ⇒ ×100；
 * K 线 turnover = 元 ↔ 报价 amount = 万 ⇒ ×1e4。
 *
 * 调用时机：仅在日 K 装载（打开 / 切票 / 切周期 / 报价首次就位）时拼接一次，
 * **不做盘中逐 tick 刷新**——klinecharts v10 数据只能经 loader 整图重载，
 * 每 4s 重载会重置视角与十字光标；收盘后上游真柱自然覆盖。
 * 拼接结果不得写入本地缓存 / 快照（缓存只存上游真数据）。
 *
 * @param bars 日 K 序列（时间升序，不复权）
 * @param quote 实时报价；null 或无有效价格时原样返回
 * @returns 拼接后的新序列（不改入参数组）
 */
export const spliceTodayBar = (bars: KLineData[], quote: FullQuote | null): KLineData[] => {
  if (!quote || bars.length === 0) return bars;
  const price = quote.price;
  if (price === null || price <= 0) return bars;

  const todayKey = dayjs(quote.timestamp ?? Date.now()).format('YYYY-MM-DD');
  const lastKey = dayjs(bars[bars.length - 1].timestamp).format('YYYY-MM-DD');
  if (todayKey < lastKey) return bars;

  const todayBar: KLineData = {
    timestamp: dayjs(todayKey).valueOf(),
    open: quote.open > 0 ? quote.open : price,
    high: Math.max(quote.high > 0 ? quote.high : price, price),
    low: quote.low > 0 ? Math.min(quote.low, price) : price,
    close: price,
    volume: (quote.volume ?? 0) * 100,
    turnover: (quote.amount ?? 0) * 1e4,
  };
  if (todayKey === lastKey) {
    return [...bars.slice(0, -1), todayBar];
  }
  return [...bars, todayBar];
};

import type { FullQuote } from '../types/stock-quote.types.ts';
import { isHkSymbol } from '../utils/is-hk-symbol';
import { mapHkQuotesToFullQuotes } from '../utils/map-hk-quote-to-full-quote';
import { sdk } from './sdk';

/**
 * 全市场快照请求治理：小并发分页拉取
 *
 * 2026-09-12 的血泪教训是「并发 7 + 每 60s 一轮」的**持续高频轮询**，而非并发本身；
 * 本项目其余重接口（信号扫描并发 3、成分股映射并发 3）长期稳定 → 此处对齐取 3。
 */
const MARKET_SNAPSHOT_OPTIONS = {
  /** 每页标的数（上游 clist 单页上限约 500） */
  batchSize: 500,
  /**
   * 并发页数：3（约 11 页 → 4 轮）
   *
   * ⚠️ 不要调回 SDK 默认 7：并发过高会重新触发东财反爬（见 `.ai/项目资源/数据接口说明.md` §5）。
   */
  concurrency: 3,
} as const;

/**
 * 拉取批量实时行情（codes 为 sh600519 / hk00700 完整形态，SDK 内部本身即为批量请求）
 *
 * 按市场分组分流（2026-10-30 港股支持）：SDK 的 quotes.cn 会把非 A 股符号**静默丢弃**，
 * 故港股符号（hk 前缀）单独走 sdk.quotes.hk（腾讯港股布局），经 mapHkQuoteToFullQuote
 * 映射为 A 股同口径 FullQuote（量纲换算见该函数注释）；两路并行请求后按入参顺序合并。
 * 签名与返回顺序与纯 A 股时期完全一致，既有调用方零改动
 * @param codes 标的符号列表
 * @returns 完整报价列表（顺序与入参一致；单路失败会整体抛错，由调用方进错误态）
 */
export const fetchFullQuotes = async (codes: readonly string[]): Promise<FullQuote[]> => {
  const cnCodes: string[] = [];
  const hkCodes: string[] = [];
  for (const code of codes) {
    (isHkSymbol(code) ? hkCodes : cnCodes).push(code);
  }
  const [cnQuotes, hkQuotes] = await Promise.all([
    cnCodes.length > 0 ? sdk.quotes.cn(cnCodes) : Promise.resolve([] as FullQuote[]),
    hkCodes.length > 0
      ? sdk.quotes.hk(hkCodes).then((quotes) =>
          // 受控断言：HkMappedQuote.market 为真实值 'HK'，SDK 的 FullQuote 判别值只覆盖
          // A 股（'CN'）；全站消费方均不判别 market 字段，市场判别依据是符号本身（is-hk-symbol）
          mapHkQuotesToFullQuotes(hkCodes, quotes) as unknown as FullQuote[],
        )
      : Promise.resolve([] as FullQuote[]),
  ]);
  if (hkCodes.length === 0) {
    return cnQuotes;
  }
  if (cnCodes.length === 0) {
    return hkQuotes;
  }
  // 按入参顺序双指针合并（mapHkQuotesToFullQuotes 已按入参序；调用方依赖顺序下标）
  const cnQueue = [...cnQuotes];
  const hkQueue = [...hkQuotes];
  return codes.map((code) => (isHkSymbol(code) ? hkQueue.shift()! : cnQueue.shift()!));
};

/**
 * 拉取全市场 A 股快照（东财源，经同源代理转发；用于涨跌分布等市场宽度统计）
 *
 * 小并发分页拉取（并发 3，约 11 页 → 4 轮），对上游保持克制，防止 IP 被反爬封禁
 * @see MARKET_SNAPSHOT_OPTIONS
 * @returns 全市场完整报价列表
 */
export const fetchAllMarketQuotes = async (): Promise<FullQuote[]> =>
  sdk.batch.cn({ ...MARKET_SNAPSHOT_OPTIONS });

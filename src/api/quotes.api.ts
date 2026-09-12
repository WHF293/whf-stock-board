import type { FullQuote } from '../types/stock-quote.types';
import { sdk } from './sdk';

/** 全市场快照请求治理：串行分页拉取，避免高并发触发上游反爬 */
const MARKET_SNAPSHOT_OPTIONS = {
  /** 每页标的数（上游 clist 单页上限约 500） */
  batchSize: 500,
  /** 并发数压为 1：分页请求串行发出 */
  concurrency: 1,
} as const;

/**
 * 拉取批量实时行情（腾讯源，codes 为 sh600519 完整形态，SDK 内部本身即为批量请求）
 * @param codes 标的符号列表
 * @returns 完整报价列表（顺序与入参一致）
 */
export const fetchFullQuotes = async (codes: readonly string[]): Promise<FullQuote[]> =>
  sdk.quotes.cn([...codes]);

/**
 * 拉取全市场 A 股快照（东财源，经同源代理转发；用于涨跌分布等市场宽度统计）
 *
 * 串行分页拉取（约 11 页），对上游保持克制，防止 IP 被反爬封禁
 * @returns 全市场完整报价列表
 */
export const fetchAllMarketQuotes = async (): Promise<FullQuote[]> =>
  sdk.batch.cn({ ...MARKET_SNAPSHOT_OPTIONS });

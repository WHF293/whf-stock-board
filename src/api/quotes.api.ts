import type { FullQuote } from '../types/stock-quote.types';
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
 * 拉取批量实时行情（腾讯源，codes 为 sh600519 完整形态，SDK 内部本身即为批量请求）
 * @param codes 标的符号列表
 * @returns 完整报价列表（顺序与入参一致）
 */
export const fetchFullQuotes = async (codes: readonly string[]): Promise<FullQuote[]> =>
  sdk.quotes.cn([...codes]);

/**
 * 拉取全市场 A 股快照（东财源，经同源代理转发；用于涨跌分布等市场宽度统计）
 *
 * 小并发分页拉取（并发 3，约 11 页 → 4 轮），对上游保持克制，防止 IP 被反爬封禁
 * @see MARKET_SNAPSHOT_OPTIONS
 * @returns 全市场完整报价列表
 */
export const fetchAllMarketQuotes = async (): Promise<FullQuote[]> =>
  sdk.batch.cn({ ...MARKET_SNAPSHOT_OPTIONS });

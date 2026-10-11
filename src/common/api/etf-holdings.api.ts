import {
  ETF_HOLDINGS_TTL_MS,
  ETF_JJCC_REFERER,
  ETF_JJCC_TOPLINE,
  ETF_JJCC_URL,
} from '../constants/etf.constants.ts';
import { EASTMONEY_USER_AGENT } from '../constants/board-calendar.constants.ts';
import type { EtfHoldingsRecord } from '../types/etf.types.ts';
import { proxyFetch } from './proxy-fetch';
import { loadEtfHoldingsCache, saveEtfHoldingsCache } from './etf-holdings-cache.api.ts';
import { parseEtfHoldingsHtml } from '../utils/parse-etf-holdings-html';

/**
 * ETF 持仓股取数（天天基金 f10，季度披露口径）
 *
 * 持仓一个季度才更新一次，读走本地缓存（缺失或超过 TTL 才回源），
 * 用户点「刷新」时 force 跳过缓存强制回源
 */

/** 6 位纯代码提取（sh512760 → 512760） */
const BARE_CODE_RE = /^(?:sh|sz|bj)?(\d{6})$/i;

/** 上游解码：页面虽声明 charset=gb2312，实测响应体（含 content 内中文）是 **UTF-8** 字节，
 * 按 GBK 解会整屏乱码（2026-09-29 实测）；与腾讯源的 GBK 口径相反，勿混淆 */
const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * 从任意形态符号提取 6 位纯代码
 * @param symbol 完整符号或 6 位代码
 * @returns 6 位代码（不合法为 null）
 */
const toBareCode = (symbol: string): string | null =>
  BARE_CODE_RE.exec(symbol.trim())?.[1] ?? null;

/**
 * 抓取一只 ETF 的最新持仓（仅回源，不做缓存判断）
 * @param symbol ETF 符号（sh512760 / 512760）
 * @returns 持仓记录
 * @throws Error 上游 HTTP 非 200、解析不到数据行时抛出
 */
const fetchEtfHoldingsRemote = async (symbol: string): Promise<EtfHoldingsRecord> => {
  const code = toBareCode(symbol);
  if (!code) throw new Error(`非法的 ETF 代码：${symbol}`);
  const params = new URLSearchParams({
    type: 'jjcc',
    code,
    topline: String(ETF_JJCC_TOPLINE),
    year: '',
    month: '',
  });
  const response = await proxyFetch(`${ETF_JJCC_URL}?${params.toString()}`, {
    headers: { 'User-Agent': EASTMONEY_USER_AGENT, Referer: ETF_JJCC_REFERER },
  });
  if (!response.ok) {
    throw new Error(`天天基金持仓接口 HTTP ${response.status}`);
  }
  const raw = UTF8_DECODER.decode(await response.arrayBuffer());
  const parsed = parseEtfHoldingsHtml(raw);
  if (parsed.holdings.length === 0) {
    throw new Error('未解析到持仓数据（可能非场内基金或上游限频）');
  }
  return { code, reportDate: parsed.reportDate, fetchedAt: Date.now(), holdings: parsed.holdings };
};

/**
 * 读取 ETF 持仓：优先本地缓存，缺失 / 超过 TTL 或 force 时回源并写缓存
 * @param symbol ETF 符号（sh512760 / 512760）
 * @param force 是否跳过缓存强制回源（用户点「刷新」）
 * @returns 持仓记录
 * @throws Error 回源失败且无可用缓存时抛出
 */
export const getEtfHoldings = async (symbol: string, force = false): Promise<EtfHoldingsRecord> => {
  const code = toBareCode(symbol) ?? symbol.trim();
  if (!force) {
    const cached = loadEtfHoldingsCache(code);
    if (cached && Date.now() - cached.fetchedAt < ETF_HOLDINGS_TTL_MS) {
      return cached;
    }
  }
  const record = await fetchEtfHoldingsRemote(symbol);
  saveEtfHoldingsCache(record);
  return record;
};

import {
  ETF_JBGK_REFERER,
  ETF_JBGK_URL_TEMPLATE,
  ETF_PROFILE_TTL_MS,
} from '../constants/etf.constants.ts';
import { EASTMONEY_USER_AGENT } from '../constants/board-calendar.constants.ts';
import type { EtfProfileRecord } from '../types/etf.types.ts';
import { proxyFetch } from './proxy-fetch';
import { loadEtfProfileCache, saveEtfProfileCache } from './etf-profile-cache.api.ts';
import { parseEtfProfileHtml } from '../utils/parse-etf-profile-html';

/**
 * ETF 基金概况取数（天天基金 f10「基金概况」页）
 *
 * 概况数据（规模/费率/管理人）变动频率极低，读走本地缓存（缺失或超过 TTL 才回源），
 * 用户点「刷新」时 force 跳过缓存强制回源；结构与持仓取数（etf-holdings.api）对齐
 */

/** 6 位纯代码提取（sh510300 → 510300） */
const BARE_CODE_RE = /^(?:sh|sz|bj)?(\d{6})$/i;

/** 上游页面为 UTF-8 字节（与持仓接口同源口径，勿按 GBK 解） */
const UTF8_DECODER = new TextDecoder('utf-8');

/**
 * 从任意形态符号提取 6 位纯代码
 * @param symbol 完整符号或 6 位代码
 * @returns 6 位代码（不合法为 null）
 */
const toBareCode = (symbol: string): string | null =>
  BARE_CODE_RE.exec(symbol.trim())?.[1] ?? null;

/**
 * 抓取一只 ETF 的最新概况（仅回源，不做缓存判断）
 * @param symbol ETF 符号（sh510300 / 510300）
 * @returns 概况记录
 * @throws Error 上游 HTTP 非 200 或解析不到概况表时抛出
 */
const fetchEtfProfileRemote = async (symbol: string): Promise<EtfProfileRecord> => {
  const code = toBareCode(symbol);
  if (!code) throw new Error(`非法的 ETF 代码：${symbol}`);
  const response = await proxyFetch(ETF_JBGK_URL_TEMPLATE.replace('{code}', code), {
    headers: { 'User-Agent': EASTMONEY_USER_AGENT, Referer: ETF_JBGK_REFERER },
  });
  if (!response.ok) {
    throw new Error(`天天基金概况页 HTTP ${response.status}`);
  }
  const raw = UTF8_DECODER.decode(await response.arrayBuffer());
  return { code, fetchedAt: Date.now(), ...parseEtfProfileHtml(raw) };
};

/**
 * 读取 ETF 基金概况：优先本地缓存，缺失 / 超过 TTL 或 force 时回源并写缓存
 * @param symbol ETF 符号（sh510300 / 510300）
 * @param force 是否跳过缓存强制回源（用户点「刷新」）
 * @returns 概况记录
 * @throws Error 回源失败且无可用缓存时抛出
 */
export const getEtfProfile = async (symbol: string, force = false): Promise<EtfProfileRecord> => {
  const code = toBareCode(symbol) ?? symbol.trim();
  if (!force) {
    const cached = loadEtfProfileCache(code);
    if (cached && Date.now() - cached.fetchedAt < ETF_PROFILE_TTL_MS) {
      return cached;
    }
  }
  const record = await fetchEtfProfileRemote(symbol);
  saveEtfProfileCache(record);
  return record;
};

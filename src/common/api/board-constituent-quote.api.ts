import { BOARD_REQUEST_GAP_MS, EASTMONEY_USER_AGENT } from '../constants/board-calendar.constants.ts';
import type { BoardConstituentQuote } from '../types/board-calendar.types.ts';
import { delay } from '../utils/delay';
import { proxyFetch } from './proxy-fetch';
import { push2Fetch } from './push2-fetch';

/**
 * 成分股行情多通道取数（2026-10-30 板块分析页面改造新增）
 *
 * 背景：成分股实时行情原本压在东财 `clist/get` 单通道上，该路径在本机被 TCP 层
 * 封禁（push2delay / push2 / push2his 全镜像实测不可达）且无任何兜底，扩展行
 * 成分股因此拿不到行情。本文件提供结构性多通道：
 * ① 腾讯 `qt.gtimg.cn` 批量报价（60 只/批，GBK 解码）——主通道，长期稳定；
 * ② 东财 `ulist.np/get` 按 secids 批量（100 只/批，push2Fetch 域回落维持现状）——备通道；
 * 两条通道都按 symbol 定向查询，不再依赖「板块 → 成分」翻页语义。
 *
 * 频率红线遵守：批间 300ms 错峰、并发 1；行情按会话短 TTL 缓存，
 * 扩展行反复展开不重复打上游。
 */

/** 腾讯批量报价单批只数（URL 长度留足余量；60 只 ≈ 800 字符） */
const TENCENT_QUOTE_BATCH_SIZE = 60;

/** 东财 ulist 单批 secids 只数（与 BOARD_LIST_PAGE_SIZE 同量级） */
const ULIST_QUOTE_BATCH_SIZE = 100;

/** 行情会话缓存 TTL（毫秒）：与页面轮询节奏一致，扩展行反复展开不重复请求 */
const QUOTE_CACHE_TTL_MS = 30_000;

/** 腾讯批量报价字段分隔符（`v_sh600519="1~贵州茅台~..."`） */
const TENCENT_FIELD_SEP = '~';

/** 东财 ulist 响应体（data.diff 结构与 clist 一致） */
interface UlistResponse {
  data?: { diff?: Record<string, unknown>[] | null } | null;
}

/** 会话缓存（symbol → 行情 + 写入时刻） */
const quoteCache = new Map<string, { quote: BoardConstituentQuote; at: number }>();

/**
 * 由 6 位代码推断腾讯市场前缀（sh = 沪，sz = 深/北）
 * @param symbol 6 位股票代码
 * @returns `sh` / `sz`
 */
const tencentPrefixOf = (symbol: string): string =>
  symbol.startsWith('6') || symbol.startsWith('9') ? 'sh' : 'sz';

/**
 * 由 6 位代码推断东财市场编号（1 = 沪，0 = 深/北）
 * @param symbol 6 位股票代码
 * @returns 市场编号
 */
const emMarketOf = (symbol: string): number =>
  symbol.startsWith('6') || symbol.startsWith('9') ? 1 : 0;

/**
 * 宽松数值转换（上游 `'-'` / null / 非数值统一按 null）
 * @param value 上游原始值
 * @returns 数值或 null
 */
const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '-') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 腾讯行情行解析：`v_sh600519="1~贵州茅台~600519~..."` → 行情
 *
 * 字段序（~ 分隔）：1 名称 / 3 现价 / 32 涨跌幅% / 37 成交额（万元） / 38 换手率%；
 * 停牌股现价为 0 → 按无行情处理（price 置 null，扩展行显示 `--`）。
 * @param symbol 6 位股票代码
 * @param fields 分隔后的字段数组
 * @returns 行情（字段缺失按 null）
 */
const parseTencentQuote = (symbol: string, fields: string[]): BoardConstituentQuote => {
  const price = toNumberOrNull(fields[3]);
  const amountWan = toNumberOrNull(fields[37]);
  return {
    symbol,
    name: fields[1] ?? '',
    price: price !== null && price > 0 ? price : null,
    changePercent: toNumberOrNull(fields[32]),
    turnoverRate: toNumberOrNull(fields[38]),
    amount: amountWan === null ? null : amountWan * 10_000,
  };
};

/**
 * 腾讯批量报价单批（GBK 解码）
 * @param symbols 本批 6 位代码（≤ TENCENT_QUOTE_BATCH_SIZE）
 * @returns symbol → 行情（上游未返回的代码不在 Map 中）
 */
const fetchTencentQuoteBatch = async (
  symbols: string[],
): Promise<Map<string, BoardConstituentQuote>> => {
  const query = symbols.map((symbol) => `${tencentPrefixOf(symbol)}${symbol}`).join(',');
  const response = await proxyFetch(`https://qt.gtimg.cn/q=${query}`);
  if (!response.ok) {
    throw new Error(`腾讯批量报价 HTTP ${response.status}`);
  }
  // 腾讯行情域为 GBK 字节，必须按 gbk 解（与 dragon-tiger.api 同款）
  const text = new TextDecoder('gbk').decode(await response.arrayBuffer());
  const result = new Map<string, BoardConstituentQuote>();
  for (const line of text.split('\n')) {
    const match = /v_(?:sh|sz|bj)?(\d{6})="([^"]*)"/.exec(line);
    if (!match) continue;
    const symbol = match[1] ?? '';
    if (!symbols.includes(symbol)) continue;
    result.set(symbol, parseTencentQuote(symbol, (match[2] ?? '').split(TENCENT_FIELD_SEP)));
  }
  if (result.size === 0) {
    throw new Error('腾讯批量报价返回空数据');
  }
  return result;
};

/**
 * 东财 ulist 单批行情（secids 定向查询，push2delay → push2 域回落见 push2-fetch）
 * @param symbols 本批 6 位代码（≤ ULIST_QUOTE_BATCH_SIZE）
 * @returns symbol → 行情
 */
const fetchUlistQuoteBatch = async (
  symbols: string[],
): Promise<Map<string, BoardConstituentQuote>> => {
  const secids = symbols.map((symbol) => `${emMarketOf(symbol)}.${symbol}`).join(',');
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    fields: 'f12,f14,f2,f3,f8,f6',
    secids,
  });
  const response = await push2Fetch(
    `https://push2delay.eastmoney.com/api/qt/ulist.np/get?${params.toString()}`,
    { headers: { 'User-Agent': EASTMONEY_USER_AGENT } },
  );
  if (!response.ok) {
    throw new Error(`东财 ulist 行情 HTTP ${response.status}`);
  }
  const body = (await response.json()) as UlistResponse;
  const diff = body.data?.diff;
  // ⚠️ 上游限频 / 异常时返回 200 + data:null，必须显式判空
  if (!Array.isArray(diff) || diff.length === 0) {
    throw new Error('东财 ulist 行情返回空数据（上游限频或异常）');
  }
  const result = new Map<string, BoardConstituentQuote>();
  for (const row of diff) {
    const symbol = typeof row.f12 === 'string' ? row.f12 : String(row.f12 ?? '');
    if (!/^\d{6}$/.test(symbol)) continue;
    result.set(symbol, {
      symbol,
      name: typeof row.f14 === 'string' ? row.f14 : '',
      price: toNumberOrNull(row.f2),
      changePercent: toNumberOrNull(row.f3),
      turnoverRate: toNumberOrNull(row.f8),
      amount: toNumberOrNull(row.f6),
    });
  }
  if (result.size === 0) {
    throw new Error('东财 ulist 行情未命中任何代码');
  }
  return result;
};

/**
 * 批量拉取成分股实时行情（腾讯主通道 → 东财 ulist 备通道）
 *
 * 会话级 30s 缓存：命中直接返回（扩展行反复展开不重复打上游）；
 * 主通道失败逐批回落备通道，两通道都失败的代码**不写入结果**（调用方按
 * 「名称可得、行情置 null」兜底展示，不整体失败）。
 * @param symbols 6 位股票代码列表（去重由调用方保证或内部处理均可）
 * @returns symbol → 行情
 */
export const fetchConstituentQuotesBatch = async (
  symbols: string[],
): Promise<Map<string, BoardConstituentQuote>> => {
  const now = Date.now();
  const result = new Map<string, BoardConstituentQuote>();
  const pending: string[] = [];
  for (const symbol of symbols) {
    const cached = quoteCache.get(symbol);
    if (cached && now - cached.at < QUOTE_CACHE_TTL_MS) {
      result.set(symbol, cached.quote);
    } else {
      pending.push(symbol);
    }
  }
  if (pending.length === 0) {
    return result;
  }

  // 主通道：腾讯分批；整通道失败（首批即抛）才整体切备通道
  const missed: string[] = [];
  let tencentBroken = false;
  for (let index = 0; index < pending.length; index += TENCENT_QUOTE_BATCH_SIZE) {
    const batch = pending.slice(index, index + TENCENT_QUOTE_BATCH_SIZE);
    if (tencentBroken) {
      missed.push(...batch);
      continue;
    }
    try {
      const quotes = await fetchTencentQuoteBatch(batch);
      const at = Date.now();
      for (const [symbol, quote] of quotes) {
        result.set(symbol, quote);
        quoteCache.set(symbol, { quote, at });
      }
      for (const symbol of batch) {
        if (!quotes.has(symbol)) missed.push(symbol);
      }
    } catch (error) {
      console.warn('[board-constituent-quote] 腾讯批量报价失败，本批回落东财 ulist', error);
      tencentBroken = true;
      missed.push(...batch);
    }
    if (index + TENCENT_QUOTE_BATCH_SIZE < pending.length) {
      await delay(BOARD_REQUEST_GAP_MS);
    }
  }

  // 备通道：东财 ulist 分批；仍失败的代码放弃（调用方按名称 + null 行情兜底）
  if (missed.length > 0) {
    for (let index = 0; index < missed.length; index += ULIST_QUOTE_BATCH_SIZE) {
      const batch = missed.slice(index, index + ULIST_QUOTE_BATCH_SIZE);
      try {
        const quotes = await fetchUlistQuoteBatch(batch);
        const at = Date.now();
        for (const [symbol, quote] of quotes) {
          result.set(symbol, quote);
          quoteCache.set(symbol, { quote, at });
        }
      } catch (error) {
        console.warn('[board-constituent-quote] 东财 ulist 行情失败，本批代码无实时行情', error);
      }
      if (index + ULIST_QUOTE_BATCH_SIZE < missed.length) {
        await delay(BOARD_REQUEST_GAP_MS);
      }
    }
  }
  return result;
};

/**
 * 板块成分股行情：清单 + 批量行情合成（板块分析扩展行 / 板块详情页共用）
 *
 * 行情缺失的成员保留清单行（price 等置 null），保证成分列表在封禁窗口内也可见。
 * @param constituents 板块成分清单（symbol / stockName，来自本地库 board_constituent）
 * @returns 行情列表（按涨跌幅降序，null 恒排末尾）
 */
export const fetchConstituentQuotesByList = async (
  constituents: Array<{ symbol: string; stockName: string }>,
): Promise<BoardConstituentQuote[]> => {
  if (constituents.length === 0) {
    return [];
  }
  const quotes = await fetchConstituentQuotesBatch(constituents.map((item) => item.symbol));
  return constituents
    .map(({ symbol, stockName }) => {
      const quote = quotes.get(symbol);
      return {
        symbol,
        name: quote?.name || stockName,
        price: quote?.price ?? null,
        changePercent: quote?.changePercent ?? null,
        turnoverRate: quote?.turnoverRate ?? null,
        amount: quote?.amount ?? null,
      } satisfies BoardConstituentQuote;
    })
    .sort((a, b) => (b.changePercent ?? Number.NEGATIVE_INFINITY) - (a.changePercent ?? Number.NEGATIVE_INFINITY));
};

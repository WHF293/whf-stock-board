import { proxyFetch } from './proxy-fetch.ts';
import {
  GOLD_BRAND_CODES,
  GOLD_BASIS_CODE,
  GOLD_SPOT_XAU_CODE,
  GOLD_PRICE_REALTIME_URL,
  GOLD_PRICE_HISTORY_URL,
  GOLD_PRICE_REFERER,
  GOLD_FX_SINA_URL,
  GOLD_FX_SINA_REFERER,
  TROY_OUNCE_TO_GRAM,
  GOLD_FX_BID_INDEX,
  GOLD_FX_ASK_INDEX,
} from '../constants/gold-price.constants.ts';
import type { GoldBrandQuote, GoldDashboardData, GoldHistoryPoint, GoldSpotSummary } from '../types/gold-price.types.ts';

/**
 * 当日金价数据接口层（2026-11-07 新增，总览「当日金价」卡）
 *
 * 数据源金投网行情中心（api.jijinhao.com）：品牌金店挂牌价聚合源，实时接口
 * 一次请求并取全部 codes（品牌足金/金条 + 国内基准 + 伦敦金）；历史接口单 code
 * 分页取日线。金投响应为 `var quote_json = {...}` 脚本包装（截取首尾大括号解析），
 * 且必须携带金投站内 Referer（proxyFetch 的 headers.Referer 在浏览器侧自动转
 * `/stock-proxy?r=`、Tauri 侧直传请求头）。折合人民币用新浪在岸汇率中间价。
 */

/** 金投 quote 单条原始结构（数值字段以数字或字符串形态返回，统一按可空数值消费） */
interface JijinhaoQuoteRaw {
  /** 最新价（金店 code 的挂牌价；伦敦金为现价） */
  q63?: number | string;
  /** 开盘价（金店 code 恒为 0，伦敦金有值；q63 缺席时的兜底取价） */
  q1?: number | string;
  /** 涨跌幅（%） */
  q80?: number | string;
  /** 涨跌额 */
  q70?: number | string;
  /** 报价单位（元/克 / 美元/盎司） */
  unit?: string;
  /** 展示名（黄金价格 / 现货黄金 等） */
  showName?: string;
  /** 报价时间戳（毫秒） */
  time?: number;
}

/** 金投历史接口单条日线 */
interface JijinhaoHistoryRaw {
  /** 当日价 */
  q1?: number | string;
  /** 较前一交易日涨跌额 */
  q70?: number | string;
  /** 当日零点时间戳（毫秒） */
  time?: number;
}

/**
 * 可空数值归一（金投/新浪缺行字段为 0、空串或缺失，统一归 null）
 * @param value 原始字段
 * @returns 数值或 null
 */
const toNumberOrNull = (value: number | string | undefined): number | null => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 剥离金投脚手架前缀并解析 JSON（`var quote_json = {...}`）
 * @param raw 响应原文
 * @returns 解析后的对象（结构不符时抛错，由调用方走快照兜底）
 */
const parseJijinhaoPayload = <T>(raw: string): T => {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) {
    throw new Error('[gold-price] 金投响应缺少 JSON 主体');
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
};

/**
 * 取 code 的展示价格（q63 优先，金店 code 的 q1 恒为 0 不回退）
 * @param quote 金投 quote 原始条目
 * @returns 价格数值（缺行为 null）
 */
const pickQuotePrice = (quote: JijinhaoQuoteRaw | undefined): number | null => {
  if (!quote) return null;
  const latest = toNumberOrNull(quote.q63);
  if (latest !== null && latest > 0) return latest;
  const open = toNumberOrNull(quote.q1);
  return open !== null && open > 0 ? open : null;
};

/**
 * 拉取美元兑人民币在岸汇率（新浪外汇，GBK 编码，买/卖中间价）
 * @returns 汇率数值（失败返回 null，卡片折合栏显示 `--` 不影响主数据）
 */
const fetchUsdCnyRate = async (): Promise<number | null> => {
  try {
    const response = await proxyFetch(GOLD_FX_SINA_URL, {
      headers: { Referer: GOLD_FX_SINA_REFERER },
    });
    // 新浪外汇固定 GBK 编码（js 变量带中文「在岸人民币」），按字节解码
    const raw = new TextDecoder('gbk').decode(await response.arrayBuffer());
    const match = /"(.*?)"/.exec(raw);
    if (!match) return null;
    const fields = match[1].split(',');
    const bid = toNumberOrNull(fields[GOLD_FX_BID_INDEX]);
    const ask = toNumberOrNull(fields[GOLD_FX_ASK_INDEX]);
    if (bid === null || ask === null || bid <= 0 || ask <= 0) return null;
    return (bid + ask) / 2;
  } catch (error) {
    console.error('[gold-price] 汇率拉取失败', error);
    return null;
  }
};

/**
 * 拉取总览「当日金价」卡的完整快照（品牌报价 + 摘要行）
 *
 * 实时行情与汇率分属不同上游，并行发出互不错峰；
 * 任一品牌 code 缺行时该格为 null（展示 `--`），不影响其余品牌。
 * @returns 品牌报价列表（GOLD_BRAND_CODES 声明序）与摘要行
 */
export const fetchGoldDashboard = async (): Promise<GoldDashboardData> => {
  const codes = [
    ...GOLD_BRAND_CODES.flatMap((brand) => [brand.ornament, brand.bar]),
    GOLD_BASIS_CODE,
    GOLD_SPOT_XAU_CODE,
  ]
    .filter((code): code is string => Boolean(code))
    .join(',');
  const requestUrl = `${GOLD_PRICE_REALTIME_URL}?codes=${codes}&_=${Date.now()}`;

  const [quotesResponse, usdCny] = await Promise.all([
    proxyFetch(requestUrl, { headers: { Referer: GOLD_PRICE_REFERER } }),
    fetchUsdCnyRate(),
  ]);
  const payload = parseJijinhaoPayload<Record<string, JijinhaoQuoteRaw | boolean | unknown[]>>(
    await quotesResponse.text(),
  );
  const rawQuoteOf = (code: string): JijinhaoQuoteRaw | undefined => {
    const entry = payload[code];
    return entry && typeof entry === 'object' && !Array.isArray(entry)
      ? (entry as JijinhaoQuoteRaw)
      : undefined;
  };

  const brands: GoldBrandQuote[] = GOLD_BRAND_CODES.map((brand) => {
    const ornament = rawQuoteOf(brand.ornament);
    const bar = brand.bar ? rawQuoteOf(brand.bar) : undefined;
    return {
      key: brand.key,
      label: brand.label,
      ornamentPrice: pickQuotePrice(ornament),
      barPrice: brand.bar ? pickQuotePrice(bar) : null,
      changePercent: toNumberOrNull(ornament?.q80),
    };
  });

  const xauQuote = rawQuoteOf(GOLD_SPOT_XAU_CODE);
  const basisQuote = rawQuoteOf(GOLD_BASIS_CODE);
  const xauUsd = pickQuotePrice(xauQuote);
  const times = [
    ...GOLD_BRAND_CODES.map((brand) => rawQuoteOf(brand.ornament)?.time ?? 0),
    basisQuote?.time ?? 0,
  ].filter((time) => time > 0);
  const spot: GoldSpotSummary = {
    xauUsd,
    xauChangePercent: toNumberOrNull(xauQuote?.q80),
    xauCnyPerGram:
      xauUsd !== null && usdCny !== null ? (xauUsd * usdCny) / TROY_OUNCE_TO_GRAM : null,
    basisPrice: pickQuotePrice(basisQuote),
    quotedAt: times.length > 0 ? Math.max(...times) : null,
  };

  return { brands, spot };
};

/**
 * 拉取单品牌足金饰品价的近 N 个交易日日线（单品牌走势图）
 * @param ornamentCode 品牌足金饰品行情 code（GOLD_BRAND_CODES 的 ornament）
 * @param days 天数（pageSize 上限内；缺行日由上游自然缺条）
 * @returns 按时间升序的历史点列表（解析失败抛错，由调用方兜底）
 */
export const fetchGoldBrandHistory = async (
  ornamentCode: string,
  days: number,
): Promise<GoldHistoryPoint[]> => {
  const requestUrl =
    `${GOLD_PRICE_HISTORY_URL}?code=${ornamentCode}&style=3&pageSize=${days}` +
    `&needField=128,129,70&currentPage=1&_=${Date.now()}`;
  const response = await proxyFetch(requestUrl, { headers: { Referer: GOLD_PRICE_REFERER } });
  const payload = parseJijinhaoPayload<{ data?: JijinhaoHistoryRaw[] }>(await response.text());
  return (payload.data ?? [])
    .map((item) => ({
      price: toNumberOrNull(item.q1) ?? 0,
      change: toNumberOrNull(item.q70) ?? 0,
      time: item.time ?? 0,
    }))
    .filter((point) => point.price > 0 && point.time > 0)
    .sort((a, b) => a.time - b.time);
};

import {
  ETF_BOARD_ITEM_LIMIT,
  ETF_BOARD_REFERER,
  ETF_DATAHUB_URL,
  ETF_DATA_KEY_REBOUND,
  ETF_DATA_KEY_T0,
  ETF_HOT_LIST_URL,
  ETF_INDEX_ATTENTION,
  ETF_INDEX_CHANGE_60D,
  ETF_INDEX_CHANGE_PCT,
  ETF_INDEX_NAME,
  ETF_MARKET_PREFIXES,
  ETF_SELECTED_LIST_URL,
  type EtfBoardKey,
} from '../constants/etf-hot.constants.ts';
import { fetchFullQuotes } from './quotes.api.ts';
import { proxyFetch } from './proxy-fetch';
import type { HotBoardItem } from '../types/hot-board.types.ts';

/**
 * 「ETF 热榜」取数层：同花顺四榜单 → 统一 HotBoardItem
 *
 * 各榜单口径（2026-10-22 实测）：
 * - 热度榜 / 自选榜：eq.10jqka 开放接口免鉴权，只返回 6 位代码 + 市场段 +
 *   名称 + 热度值（无价格涨跌幅），行情经腾讯源批量报价补齐；
 * - 补涨榜 / T+0 榜：fund.10jqka datahub specific_data（POST JSON 免鉴权），
 *   响应为「indexes 列定义 + data 行值」的稀疏表，按 index_id 归位；
 * - 市场段映射：20 = 沪（sh）/ 36 = 深（sz），直接落完整符号，
 *   不走 normalizeAShareCode（ETF 的 5/1 开头段会被它误判为北交所）；
 * - 报价补齐失败不整榜报错（保留名称行、价格置 null），只影响当次展示
 */

/** 热度数值的「万」口径阈值（≥1 万换算为「N.N万」，与同花顺页面文案一致） */
const HEAT_WAN_THRESHOLD = 10_000;

/**
 * 格式化热度数值为页面同款文案（如「2167.3万热度」「15.1万人」）
 * @param heat 热度原始数值
 * @param unit 单位后缀（热度 / 人）
 * @returns 展示文案
 */
const formatHeatLabel = (heat: number, unit: string): string => {
  const text =
    heat >= HEAT_WAN_THRESHOLD
      ? `${(heat / HEAT_WAN_THRESHOLD).toFixed(1)}万`
      : String(Math.round(heat));
  return `${text}${unit}`;
};

/**
 * 把可能缺失的字符串转数字（空串 / 非法值返回 null）
 * @param raw 原始值
 * @returns 数值或 null
 */
const toNumberOrNull = (raw: string | number | undefined | null): number | null => {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
};

/**
 * 由同花顺市场段 + 6 位代码拼完整符号（ETF 专用，不经 normalizeAShareCode）
 * @param market 同花顺市场段（20 = 沪 / 36 = 深）
 * @param code 6 位纯代码
 * @returns 完整符号（sh588060 形态）；未知市场段返回空串
 */
const toEtfSymbol = (market: string, code: string): string => {
  const prefix = ETF_MARKET_PREFIXES[market];
  return prefix !== undefined && /^\d{6}$/.test(code) ? `${prefix}${code}` : '';
};

/**
 * 批量补齐价格与当日涨跌幅（腾讯源；ETF 代码 sh51/sz15 段为合法报价标的）
 * @param symbols 完整符号列表
 * @returns code（6 位裸代码）→ 报价的映射；失败返回空映射
 */
const fetchQuoteByCode = async (
  symbols: readonly string[],
): Promise<Map<string, { name: string; price: number; changePercent: number }>> => {
  if (symbols.length === 0) return new Map();
  try {
    const quotes = await fetchFullQuotes(symbols);
    // FullQuote.code 为 6 位裸代码（腾讯源对不存在的代码静默丢弃）
    return new Map(
      quotes.map((quote) => [
        quote.code,
        { name: quote.name, price: quote.price, changePercent: quote.changePercent },
      ]),
    );
  } catch (error) {
    console.error('[etf-hot] 行情补齐失败', error);
    return new Map();
  }
};

// ---------- 热度榜 / 自选榜（eq.10jqka 开放接口） ----------

/** 同花顺 ETF 开放接口的单条原始行 */
interface EtfOpenRaw {
  /** 6 位纯代码 */
  code: string;
  /** 同花顺市场段（20 = 沪 / 36 = 深） */
  market: string;
  name: string;
  /** 热度值（热度榜 = 搜索访问热度；自选榜 = 近 7 天加自选人数） */
  rate: number;
}

/** 同花顺 ETF 开放接口响应壳 */
interface EtfOpenResponse {
  status_code?: number;
  data?: { list?: EtfOpenRaw[] };
}

/**
 * 拉取热度榜 / 自选榜（同壳接口，仅热度单位不同）
 * @param url 榜单接口地址
 * @param heatUnit 热度单位后缀（热度 / 人）
 * @returns 归一化条目（按上游顺序 = 名次升序）
 */
const fetchEtfOpenBoard = async (
  url: string,
  heatUnit: string,
): Promise<HotBoardItem[]> => {
  const response = await proxyFetch(url, { headers: { Referer: ETF_BOARD_REFERER } });
  if (!response.ok) {
    throw new Error(`同花顺 ETF 榜单请求失败：${response.status}`);
  }
  const payload = (await response.json()) as EtfOpenResponse;
  const list = payload.data?.list ?? [];
  const rows = list.slice(0, ETF_BOARD_ITEM_LIMIT);
  const quoteByCode = await fetchQuoteByCode(
    rows
      .map((item) => toEtfSymbol(item.market, item.code))
      .filter((symbol) => symbol !== ''),
  );
  return rows.map((item, index) => {
    const symbol = toEtfSymbol(item.market, item.code);
    const quote = quoteByCode.get(item.code);
    const heat = toNumberOrNull(item.rate);
    return {
      symbol,
      code: item.code,
      name: quote?.name ?? item.name,
      price: quote?.price ?? null,
      changePct: quote ? toNumberOrNull(quote.changePercent) : null,
      heat,
      heatLabel: heat === null ? '' : formatHeatLabel(heat, heatUnit),
      rank: index + 1,
      rankChange: null,
      tags: [],
    } satisfies HotBoardItem;
  });
};

// ---------- 补涨榜 / T+0 榜（datahub specific_data） ----------

/** datahub 指标列定义行 */
interface DatahubIndex {
  /** 列序号（数据行 values 按 idx 归位） */
  idx: number;
  index_id: string;
}

/** datahub 数据行（code 为「市场段:代码」形态，values 为稀疏 kv） */
interface DatahubRow {
  code: string;
  values: { idx: number; value: string | number }[];
}

/** datahub specific_data 响应壳 */
interface DatahubResponse {
  status_code: number;
  status_msg?: string;
  data?: { indexes?: DatahubIndex[]; data?: DatahubRow[] };
}

/**
 * 拉取补涨榜 / T+0 榜（datahub POST；响应为 indexes 列定义 + data 稀疏行）
 * @param dataKey 榜单 data_key（etf_buzhangbang / etf_t0_bang）
 * @param changeIndexId 涨跌幅列的 index_id（补涨榜为 60 日口径、T+0 榜为当日口径）
 * @param changeTagPrefix 涨跌幅附加标签前缀（空串 = 不附标签；补涨榜用「60日涨幅」区分口径）
 * @returns 归一化条目（按上游顺序 = 名次升序）
 */
const fetchEtfDatahubBoard = async (
  dataKey: string,
  changeIndexId: string,
  changeTagPrefix: string,
): Promise<HotBoardItem[]> => {
  const response = await proxyFetch(ETF_DATAHUB_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: ETF_BOARD_REFERER },
    body: JSON.stringify({ data_key: dataKey, enable_default: true }),
  });
  if (!response.ok) {
    throw new Error(`同花顺 datahub 榜单请求失败：${response.status}`);
  }
  const payload = (await response.json()) as DatahubResponse;
  if (payload.status_code !== 0 || !payload.data) {
    throw new Error(`同花顺 datahub 榜单业务异常：${payload.status_msg ?? payload.status_code}`);
  }
  // 列定义 index_id → idx，数据行按 idx 归位取值
  const idxOf = new Map((payload.data.indexes ?? []).map((col) => [col.index_id, col.idx]));
  const nameIdx = idxOf.get(ETF_INDEX_NAME);
  const changeIdx = idxOf.get(changeIndexId);
  const attentionIdx = idxOf.get(ETF_INDEX_ATTENTION);
  const rows = (payload.data.data ?? []).slice(0, ETF_BOARD_ITEM_LIMIT);
  return rows.map((row, index): HotBoardItem | null => {
    const [market, code] = row.code.split(':');
    const symbol = toEtfSymbol(market ?? '', code ?? '');
    if (symbol === '') return null;
    const valueOf = (idx: number | undefined): string | number | undefined =>
      idx === undefined ? undefined : row.values.find((cell) => cell.idx === idx)?.value;
    const heat = toNumberOrNull(valueOf(attentionIdx));
    const tags: string[] = [];
    if (changeTagPrefix !== '') {
      const range = toNumberOrNull(valueOf(changeIdx));
      if (range !== null) {
        tags.push(`${changeTagPrefix} ${range >= 0 ? '+' : ''}${range.toFixed(2)}%`);
      }
    }
    return {
      symbol,
      code: code ?? '',
      name: String(valueOf(nameIdx) ?? ''),
      price: null,
      // 涨跌幅列：T+0 榜为当日口径直接展示；补涨榜为 60 日口径走 tags，置 null
      changePct: changeTagPrefix === '' ? toNumberOrNull(valueOf(changeIdx)) : null,
      heat,
      heatLabel: heat === null ? '' : formatHeatLabel(heat, '热度'),
      rank: index + 1,
      rankChange: null,
      tags,
    };
  })
    .filter((item): item is HotBoardItem => item !== null);
};

// ---------- 统一入口 ----------

/**
 * 拉取指定 ETF 榜单（统一入口，按榜单 key 分发到各源实现）
 * @param key 榜单 key（hot / selected / rebound / t0）
 * @returns 归一化条目（按名次升序）
 */
export const fetchEtfBoard = async (key: EtfBoardKey): Promise<HotBoardItem[]> => {
  switch (key) {
    case 'hot':
      return fetchEtfOpenBoard(ETF_HOT_LIST_URL, '热度');
    case 'selected':
      return fetchEtfOpenBoard(ETF_SELECTED_LIST_URL, '人');
    case 'rebound':
      return fetchEtfDatahubBoard(ETF_DATA_KEY_REBOUND, ETF_INDEX_CHANGE_60D, '60日涨幅');
    case 't0':
      return fetchEtfDatahubBoard(ETF_DATA_KEY_T0, ETF_INDEX_CHANGE_PCT, '');
  }
};

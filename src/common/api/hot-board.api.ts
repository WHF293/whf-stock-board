import { isTauri } from '@tauri-apps/api/core';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import {
  BOARD_ITEM_LIMIT,
  CLS_APP_COMMON_PARAMS,
  CLS_HOT_STOCK_URL,
  EM_RANK_API,
  EM_RANK_APP_ID,
  EM_RANK_PAGE_SIZE,
  THS_GROUP_TIME_TYPES,
  THS_HOT_LIST_URL,
  THS_NEW_STOCK_URL,
  THS_REFERER,
  TDX_CHANGE_ENTRY,
  TDX_CYCLE_LATEST,
  TDX_GROUP_LIST_TYPES,
  TDX_HOT_STOCK_ENTRY,
  TDX_REFERER,
  TDX_SKYROCKET_BODY,
  TDX_TQLEX_URL,
  TDX_YESTERDAY_BODY,
  TDX_YESTERDAY_ENTRY,
  XQ_GROUP_TYPES,
  XQ_LIST_URL,
  XQ_NEW_LIST_URL,
  XQ_PAGE_SIZE,
  type BoardSource,
} from '../constants/hot-board.constants.ts';
import { buildClsQuery } from './news.api.ts';
import { proxyFetch } from './proxy-fetch';
import { fetchFullQuotes } from './quotes.api.ts';
import type { HotBoardItem } from '../types/hot-board.types.ts';
import { toBoardSymbol } from '../utils/to-board-symbol';

/**
 * 「今天炒什么」取数层：五平台热股榜单 → 统一 HotBoardItem
 *
 * 各平台口径与鉴权差异（2026-09-28 实测，详见 SERVER_API.md）：
 * - 同花顺：dq.10jqka 热榜接口免鉴权（list_type 区分分组 + 新股独立接口）；
 * - 东财：App 人气榜接口免鉴权但**只返回代码 + 排名**，名称 / 现价 / 涨跌幅
 *   由腾讯源批量报价（fetchFullQuotes）补齐，补齐失败保留代码行不整榜报错；
 * - 财联社：App 端接口签名与 web 端同算法（排序参数 → sha1 → md5），复用
 *   news.api 的 buildClsQuery 传 App 公共参数；
 * - 通达信：TQLEX RPC 网关返回「状态行 + 列名行 + 数据行」表格协议，
 *   无 cookie 校验但**必须带页面 Referer**；
 * - 雪球：需 guest cookie（xq_a_token）。浏览器端由 /stock-proxy 中间件自动
 *   注入（server/stock-proxy-middleware.ts），Tauri 端在 JS 层两步获取
 *   （先 GET xueqiu.com 拿 set-cookie 再带 Cookie 请求）；
 * - 全部榜单过滤为 A 股（toBoardSymbol 返回空串的港美股代码剔除），单榜最多
 *   BOARD_ITEM_LIMIT 条
 */

/** 热度数值的「万」口径阈值（≥1 万换算为「N.N万」，与各平台页面文案一致） */
const HEAT_WAN_THRESHOLD = 10_000;

/**
 * 格式化热度数值为平台页面同款文案（如「64.2万热度」「538万人气」）
 * @param heat 热度原始数值
 * @param unit 单位后缀（热度 / 人气）
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
 * 把可能带脏字符的字符串转数字（空串 / 非法值返回 null）
 * @param raw 原始字符串
 * @returns 数值或 null
 */
const toNumberOrNull = (raw: string | number | undefined): number | null => {
  if (raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
};

// ---------- 同花顺 ----------

/** 同花顺热榜接口响应壳 */
interface ThsHotListResponse {
  status_code: number;
  data?: {
    stock_list?: {
      market: number;
      code: string;
      name: string;
      /** 热度值（页面「N万热度」的原始数值） */
      rate: string;
      /** 涨跌幅 % */
      rise_and_fall: number;
      /** 排名变化（正 = 上升） */
      hot_rank_chg: number;
      /** 名次（1 起） */
      order: number;
      tag?: {
        concept_tag?: string[];
        popularity_tag?: string | null;
      } | null;
    }[];
  };
}

/**
 * 拉取同花顺热股榜单（大家都在看 / 快速飙升 / 技术交易派 / 价值投资派 / 趋势投资派）
 * @param group 分组值（normal / skyrocket / tech / value / trend）
 * @returns 归一化条目（按上游名次升序）
 */
const fetchThsBoard = async (group: string): Promise<HotBoardItem[]> => {
  const timeType = THS_GROUP_TIME_TYPES[group] ?? 'day';
  const url = `${THS_HOT_LIST_URL}?stock_type=a&type=${timeType}&list_type=${group}`;
  const response = await proxyFetch(url, { headers: { Referer: THS_REFERER } });
  if (!response.ok) {
    throw new Error(`同花顺热榜请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThsHotListResponse;
  if (payload.status_code !== 0 || !payload.data) {
    throw new Error(`同花顺热榜业务异常：${payload.status_code}`);
  }
  return (payload.data.stock_list ?? []).slice(0, BOARD_ITEM_LIMIT).map((item) => {
    const heat = toNumberOrNull(item.rate);
    const tags = [...(item.tag?.concept_tag ?? [])];
    if (item.tag?.popularity_tag) tags.push(item.tag.popularity_tag);
    return {
      symbol: toBoardSymbol(item.code),
      code: item.code,
      name: item.name,
      price: null,
      changePct: toNumberOrNull(item.rise_and_fall),
      heat,
      heatLabel: heat === null ? '' : formatHeatLabel(heat, '热度'),
      rank: item.order,
      rankChange: toNumberOrNull(item.hot_rank_chg),
      tags,
    } satisfies HotBoardItem;
  });
}

/**
 * 拉取同花顺新股热度榜（独立接口，响应壳与通用热榜相同）
 * @returns 归一化条目
 */
const fetchThsNewStockBoard = async (): Promise<HotBoardItem[]> => {
  const response = await proxyFetch(THS_NEW_STOCK_URL, {
    headers: { Referer: THS_REFERER },
  });
  if (!response.ok) {
    throw new Error(`同花顺新股榜请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThsHotListResponse;
  if (payload.status_code !== 0 || !payload.data) {
    throw new Error(`同花顺新股榜业务异常：${payload.status_code}`);
  }
  return (payload.data.stock_list ?? []).slice(0, BOARD_ITEM_LIMIT).map((item, index) => ({
    symbol: toBoardSymbol(item.code),
    code: item.code,
    name: item.name,
    price: null,
    changePct: toNumberOrNull(item.rise_and_fall),
    heat: toNumberOrNull(item.rate),
    heatLabel: '',
    rank: item.order || index + 1,
    rankChange: null,
    tags: [...(item.tag?.concept_tag ?? [])],
  }));
};

// ---------- 东方财富 ----------

/** 东财榜单条目（接口只给代码与排名；rc 为排名变化，行情另行补齐） */
interface EmRankRaw {
  /** 完整代码（SH600418 / SZ000592 / BJ920926 形态） */
  sc: string;
  /** 排名（1 起） */
  rk: number;
  /** 排名变化（正 = 上升） */
  rc: number;
}

/** 东财榜单接口响应壳 */
interface EmRankResponse {
  code: number | string;
  message?: string;
  data?: EmRankRaw[];
}

/**
 * 请求东财 App 排行榜原始代码列表
 * @param endpoint 接口路径（getAllCurrentList 人气榜 / getAllHisRcList 飙升榜）
 * @returns 按排名升序的代码条目
 */
const fetchEmRankCodes = async (endpoint: string): Promise<EmRankRaw[]> => {
  const response = await proxyFetch(`${EM_RANK_API}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      appId: EM_RANK_APP_ID,
      globalId: crypto.randomUUID(),
      marketType: '',
      pageNo: 1,
      pageSize: EM_RANK_PAGE_SIZE,
    }),
  });
  if (!response.ok) {
    throw new Error(`东财热榜请求失败：${response.status}`);
  }
  const payload = (await response.json()) as EmRankResponse;
  if (Number(payload.code) !== 0 || !payload.data) {
    throw new Error(`东财热榜业务异常：${payload.message ?? payload.code}`);
  }
  return payload.data;
};

/**
 * 拉取东财热股榜单（人气榜 / 飙升榜）
 *
 * 排行接口只返回代码 + 排名，名称 / 现价 / 涨跌幅经腾讯源批量报价补齐；
 * 报价失败不整榜报错（保留代码行、价格置 null），只影响当次展示
 * @param group 分组值（popularity / skyrocket）
 * @returns 归一化条目（按排名升序）
 */
const fetchEmBoard = async (group: string): Promise<HotBoardItem[]> => {
  const endpoint = group === 'skyrocket' ? 'getAllHisRcList' : 'getAllCurrentList';
  const ranks = (await fetchEmRankCodes(endpoint)).slice(0, BOARD_ITEM_LIMIT);
  const symbols = ranks
    .map((item) => toBoardSymbol(item.sc))
    .filter((symbol) => symbol !== '');
  let quoteByCode = new Map<string, { name: string; price: number; changePercent: number }>();
  if (symbols.length > 0) {
    try {
      const quotes = await fetchFullQuotes(symbols);
      // FullQuote.code 为 6 位裸代码（⚠️ 腾讯源对不存在的代码静默丢弃，见 match-batch-quotes）
      quoteByCode = new Map(
        quotes.map((quote) => [
          quote.code,
          { name: quote.name, price: quote.price, changePercent: quote.changePercent },
        ]),
      );
    } catch (error) {
      console.error('[hot-board] 东财行情补齐失败', error);
    }
  }
  return ranks.map((item) => {
    const symbol = toBoardSymbol(item.sc);
    const quote = quoteByCode.get(symbol.slice(2));
    return {
      symbol,
      code: symbol.slice(2),
      name: quote?.name ?? item.sc,
      price: quote?.price ?? null,
      changePct: quote ? toNumberOrNull(quote.changePercent) : null,
      heat: null,
      heatLabel: '',
      rank: item.rk,
      rankChange: toNumberOrNull(item.rc),
      tags: [],
    } satisfies HotBoardItem;
  });
};

// ---------- 财联社 ----------

/** 财联社热股榜条目 */
interface ClsHotStockRaw {
  stock?: {
    StockID: string;
    name: string;
    /** 现价 */
    last: number;
    /** 涨跌幅 % */
    RiseRange: number;
  };
  /** 排名变化（正 = 上升） */
  ranking_change: number;
}

/** 财联社接口统一响应壳（与 news.api 的 web 端同构） */
interface ClsHotStockResponse {
  errno: number;
  msg?: string;
  data?: ClsHotStockRaw[];
}

/**
 * 拉取财联社热股榜（App 端接口，sign 动态计算；单页快照无翻页）
 * @returns 归一化条目（按上游返回顺序 = 名次升序）
 */
const fetchClsBoard = async (): Promise<HotBoardItem[]> => {
  const query = await buildClsQuery({}, CLS_APP_COMMON_PARAMS);
  const response = await proxyFetch(`${CLS_HOT_STOCK_URL}?${query}`);
  if (!response.ok) {
    throw new Error(`财联社热股榜请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ClsHotStockResponse;
  if (payload.errno !== 0 || !payload.data) {
    throw new Error(`财联社热股榜业务异常：${payload.msg ?? payload.errno}`);
  }
  return payload.data
    .map((item, index): HotBoardItem | null => {
      const symbol = toBoardSymbol(item.stock?.StockID ?? '');
      if (symbol === '' || !item.stock) return null;
      return {
        symbol,
        code: symbol.slice(2),
        name: item.stock.name,
        price: toNumberOrNull(item.stock.last),
        changePct: toNumberOrNull(item.stock.RiseRange),
        heat: null,
        heatLabel: '',
        rank: index + 1,
        rankChange: toNumberOrNull(item.ranking_change),
        tags: [],
      } satisfies HotBoardItem;
    })
    .filter((item): item is HotBoardItem => item !== null)
    .slice(0, BOARD_ITEM_LIMIT);
};

// ---------- 通达信 ----------

/**
 * 解析 TQLEX 表格协议响应
 *
 * 响应结构为 `[状态行, 列名行, 附加行, ...数据行]`：
 * 状态行 `[0, "", 100, "", ""]`（0 = 成功）；列名行声明后续数据行的字段顺序，
 * 数据行按列名归一为对象（上游所有列值均为字符串）
 * @param text 上游响应原文
 * @returns 状态码、列名与按列名归一的数据行
 */
const parseTdxTable = (
  text: string,
): { status: number; rows: Record<string, string>[] } => {
  const table = JSON.parse(text) as unknown[];
  const statusRow = table[0] as number[];
  const columnsRow = table[1] as string[];
  const dataRows = table.slice(3) as string[][];
  const rows = dataRows.map((row) =>
    Object.fromEntries(columnsRow.map((column, index) => [column, row[index] ?? ''])),
  );
  return { status: Number(statusRow?.[0]), rows };
};

/**
 * 从通达信行的概念板块列解析标签数组（gnbk 列为 JSON 字符串）
 * @param raw gnbk 列原始值
 * @returns 概念名列表（解析失败返回空数组）
 */
const parseTdxTags = (raw: string): string[] => {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as { name?: string }[];
    return list.map((item) => item.name ?? '').filter((name) => name !== '');
  } catch {
    return [];
  }
};

/**
 * 通达信榜单行的归一化参数（按 Entry 的列名差异取值）
 * @param row 按列名归一的数据行
 * @param index 行序（兜底名次）
 * @returns 归一化条目；非 A 股代码返回 null
 */
const toTdxItem = (row: Record<string, string>, index: number): HotBoardItem | null => {
  const symbol = toBoardSymbol(row.sec_code ?? '');
  if (symbol === '') return null;
  const heat = toNumberOrNull(row.nowTotal ?? row.totalCount);
  // 飙升榜 / 昨日榜有 lastRanking：排名变化 = 上期名次 - 当期名次（正 = 上升）
  const last = toNumberOrNull(row.lastRanking);
  const now = toNumberOrNull(row.nowRanking);
  const rankChange =
    last !== null && now !== null ? last - now : null;
  return {
    symbol,
    code: symbol.slice(2),
    name: row.stock_name ?? '',
    price: toNumberOrNull(row.now_price),
    changePct: toNumberOrNull(row.chg),
    heat,
    heatLabel: heat === null ? '' : formatHeatLabel(heat, '人气'),
    rank: toNumberOrNull(row.ranking ?? row.nowRanking) ?? index + 1,
    rankChange,
    tags: parseTdxTags(row.gnbk ?? ''),
  };
};

/**
 * 请求通达信 TQLEX 接口并归一化（无 cookie 校验，但必须带热榜页 Referer）
 * @param entry 业务 Entry（hotStockList / changeStockList / yesterdayList）
 * @param body 请求体（JSON 数组，按 Entry 各异）
 * @returns 归一化条目
 */
const fetchTdxBoard = async (
  entry: string,
  body: readonly unknown[],
): Promise<HotBoardItem[]> => {
  const response = await proxyFetch(`${TDX_TQLEX_URL}?Entry=${entry}&RI=`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Referer: TDX_REFERER },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`通达信热榜请求失败：${response.status}`);
  }
  const { status, rows } = parseTdxTable(await response.text());
  if (status !== 0) {
    throw new Error(`通达信热榜业务异常：${status}`);
  }
  return rows
    .map(toTdxItem)
    .filter((item): item is HotBoardItem => item !== null)
    .slice(0, BOARD_ITEM_LIMIT);
};

// ---------- 雪球 ----------

/** 雪球榜单条目（榜单含港美股，取数层按代码过滤） */
interface XqItemRaw {
  /** 代码（SZ300308 / NVDA / 00700 形态） */
  code: string;
  name: string;
  /** 热度值 */
  value: number;
  /** 排名变化 */
  rank_change: number;
  /** 涨跌幅（小数，×100 转百分比） */
  percent: number;
  /** 现价 */
  current: number;
}

/** 雪球热股页地址（guest cookie 的下发页；302 落点为 www 完整地址） */
const XQ_HOT_PAGE_URL = 'https://www.xueqiu.com/hot/stock';

/** 雪球榜单响应壳 */
interface XqListResponse {
  error_code: number;
  error_description?: string;
  data?: { items?: XqItemRaw[] };
}

/** Tauri 端缓存的雪球 guest cookie（模块级，应用生命周期内复用） */
let xqCookieCache = '';

/** 雪球 guest cookie 的请求头名前缀（只要 xq_ 开头的会话 cookie，u 为设备标识一并带上） */
const XQ_COOKIE_NAME_PATTERN = /^(xq_[a-z_]+|u)=/;

/**
 * Tauri 端获取雪球 guest cookie（两步过阿里云盾）：
 * ① GET 主站拿盾 cookie（acw_tc）；② 带 acw_tc GET 热股页（www 完整地址，避免
 * 302 中间跳在 reqwest 丢 cookie）拿全套业务 cookie（xq_a_token 等）并缓存。
 * xq_a_token 为游客 token（无需登录）；浏览器端不走本函数
 * （cookie 由 /stock-proxy 中间件在服务端注入，见 stock-proxy-middleware.ts）
 * @returns `acw_tc=...; xq_a_token=...` 形态的 Cookie 头值
 */
const ensureXqCookieTauri = async (): Promise<string> => {
  if (xqCookieCache !== '') return xqCookieCache;
  const collect = (response: Response): void => {
    for (const cookie of response.headers.getSetCookie?.() ?? []) {
      const pair = cookie.split(';')[0];
      if (XQ_COOKIE_NAME_PATTERN.test(pair)) {
        xqCookieCache = xqCookieCache === '' ? pair : `${xqCookieCache}; ${pair}`;
      }
    }
  };
  // ① 主站：拿 acw_tc（阿里云盾会话）
  collect(await tauriFetch('https://xueqiu.com/'));
  // ② 热股页（跟随后的最终地址）：下发 xq_a_token 等业务 cookie
  collect(
    await tauriFetch(XQ_HOT_PAGE_URL, {
      headers: xqCookieCache === '' ? {} : { Cookie: xqCookieCache },
    }),
  );
  if (xqCookieCache === '') {
    throw new Error('雪球 cookie 获取失败（未返回会话 cookie）');
  }
  return xqCookieCache;
};

/** 雪球 cookie 失效时清除缓存（下次请求重新获取） */
const invalidateXqCookie = (): void => {
  xqCookieCache = '';
};

/**
 * 拉取雪球热股榜单（热搜 / 飙升 / 热评 / 自选；含港美股，过滤后仅保留 A 股）
 *
 * cookie 失效（雪球返回 400）自动重取一次再重试
 * @param group 分组值（search / skyrocket / comment / optional）
 * @returns 归一化条目（按上游顺序 = 名次升序）
 */
const fetchXqBoard = async (group: string): Promise<HotBoardItem[]> => {
  const url =
    group === 'skyrocket'
      ? `${XQ_NEW_LIST_URL}?page=1&size=${XQ_PAGE_SIZE}&order=desc&order_by=rank_change&type=10`
      : `${XQ_LIST_URL}?page=1&size=${XQ_PAGE_SIZE}&order=desc&order_by=value&type=${XQ_GROUP_TYPES[group] ?? '10'}`;

  const request = async (): Promise<Response> => {
    if (isTauri()) {
      const cookie = await ensureXqCookieTauri();
      return tauriFetch(url, { headers: { Cookie: cookie } });
    }
    // 浏览器端：cookie 由代理中间件自动附加（服务端持有 guest token 缓存）
    return proxyFetch(url, { headers: { Referer: 'https://xueqiu.com/' } });
  };

  let response = await request();
  if (response.status === 400 || response.status === 401) {
    invalidateXqCookie();
    response = await request();
  }
  if (!response.ok) {
    throw new Error(`雪球热股榜请求失败：${response.status}`);
  }
  const payload = (await response.json()) as XqListResponse;
  if (payload.error_code !== 0 || !payload.data) {
    throw new Error(`雪球热股榜业务异常：${payload.error_description ?? payload.error_code}`);
  }
  return (payload.data.items ?? [])
    .map((item, index): HotBoardItem | null => {
      const symbol = toBoardSymbol(item.code);
      if (symbol === '') return null;
      const pct = toNumberOrNull(item.percent);
      return {
        symbol,
        code: symbol.slice(2),
        name: item.name,
        price: toNumberOrNull(item.current),
        changePct: pct === null ? null : Number((pct * 100).toFixed(2)),
        heat: toNumberOrNull(item.value),
        heatLabel:
          item.value === undefined ? '' : formatHeatLabel(item.value, '热度'),
        rank: index + 1,
        rankChange: toNumberOrNull(item.rank_change),
        tags: [],
      } satisfies HotBoardItem;
    })
    .filter((item): item is HotBoardItem => item !== null)
    .slice(0, BOARD_ITEM_LIMIT);
};

// ---------- 统一入口 ----------

/**
 * 拉取指定平台指定分组的热股榜单（统一入口，按平台分发到各源实现）
 * @param source 平台（ths / em / cls / tdx / xq）
 * @param group 分组值（见 constants/hot-board.constants.ts 的 BOARD_GROUPS）
 * @returns 归一化条目（按名次升序，A 股口径）
 */
export const fetchHotBoard = async (
  source: BoardSource,
  group: string,
): Promise<HotBoardItem[]> => {
  switch (source) {
    case 'ths':
      return group === 'new' ? fetchThsNewStockBoard() : fetchThsBoard(group);
    case 'em':
      return fetchEmBoard(group);
    case 'cls':
      return fetchClsBoard();
    case 'tdx':
      if (group === 'skyrocket') {
        return fetchTdxBoard(TDX_CHANGE_ENTRY, TDX_SKYROCKET_BODY);
      }
      if (group === 'yesterday') {
        return fetchTdxBoard(TDX_YESTERDAY_ENTRY, TDX_YESTERDAY_BODY);
      }
      return fetchTdxBoard(TDX_HOT_STOCK_ENTRY, [
        {
          listType: TDX_GROUP_LIST_TYPES[group] ?? '0',
          cycle: TDX_CYCLE_LATEST,
        },
      ]);
    case 'xq':
      return fetchXqBoard(group);
  }
};

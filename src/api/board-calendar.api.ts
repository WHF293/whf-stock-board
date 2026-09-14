import {
  BOARD_CALENDAR_URL,
  BOARD_LIST_PAGE_SIZE,
  BOARD_REQUEST_GAP_MS,
  BOARD_SECID_PREFIX,
  BOARD_SNAPSHOT_FIELDS,
  EASTMONEY_USER_AGENT,
  LIMIT_DOWN_POOL_SORT,
  LIMIT_POOL_PAGE_SIZE,
  LIMIT_POOL_TOKEN,
  LIMIT_UP_POOL_SORT,
  SW_LEVEL1_BOARDS,
  TENCENT_REFERER,
  TRADING_KLINE_LIMIT,
} from '../constants/board-calendar.constants';
import type {
  BoardConstituentQuote,
  BoardSnapshotItem,
  ConstituentItem,
  LimitPoolStock,
} from '../types/board-calendar.types';
import { delay } from '../utils/delay';
import { proxyFetch } from './proxy-fetch';

/**
 * 板块日历上游取数
 *
 * 通道（2026-09-14 实测，详见开发方案 §2）：
 * - 板块列表 / 成分股 → 东财 `push2delay`（`push2` 与 `push2his` 在本机被 TCP 层封禁）
 * - 涨停 / 跌停池 → 东财 `push2ex`
 * - 交易日轴 → 腾讯日 K（与 `turnover.api.ts` 同一指数）
 *
 * 落库口径：本文件只做「上游 → 归一化类型」，不做任何缓存与业务判断。
 */

/** 成分股翻页上限（机械设备 629 只 → 7 页，留余量） */
const CONSTITUENT_MAX_PAGES = 12;

/** 交易日轴索引（与 turnover.api.ts 的上证指数同源） */
const CALENDAR_INDEX_SYMBOL = 'sh000001';

/* --------------------------------- 类型守卫 --------------------------------- */

/**
 * 宽松数值转换（上游 `'-'` / null / 非数值统一按 0）
 * @param value 上游原始值
 * @returns 数值
 */
const toNumber = (value: unknown): number => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/**
 * 宽松数值转换（不可用时为 null）
 * @param value 上游原始值
 * @returns 数值或 null
 */
const toNumberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || value === '-') {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 宽松文本转换
 * @param value 上游原始值
 * @returns 文本（缺失为空串）
 */
const toText = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

/**
 * 封板时间归一化：上游给 5~6 位数字（如 92500 → 09:25:00）
 * @param value 上游封板时间原值
 * @returns 6 位 HHMMSS 字符串（不可用时为 null）
 */
const toSealTime = (value: unknown): string | null => {
  const raw = toNumberOrNull(value);
  if (raw === null || raw <= 0) return null;
  return String(Math.trunc(raw)).padStart(6, '0');
};

/**
 * 由 6 位代码推断市场（0 = 深/北，1 = 沪）
 *
 * 不依赖上游字段：6xxxxx（沪主板 / 科创板）与 9xxxxx（沪 B）为沪市，其余为深 / 北。
 * @param symbol 6 位股票代码
 * @returns 市场编号
 */
const resolveMarket = (symbol: string): number =>
  symbol.startsWith('6') || symbol.startsWith('9') ? 1 : 0;

/* -------------------------------- 板块列表 -------------------------------- */

/** 东财 clist / ulist 响应体（两者 `data.diff` 结构一致） */
interface ClistResponse {
  data?: { total?: number; diff?: Record<string, unknown>[] | null } | null;
}

/**
 * 拉取 clist 一页原始行（成分股翻页用）
 * @param fs 板块筛选表达式（`b:BK1216` 成分股）
 * @param fields 字段码列表（逗号分隔）
 * @param pn 页码（从 1 开始）
 * @returns 原始行数组
 * @throws Error 上游返回 200 但 `data.diff` 为空（限频 / 异常）时抛出
 */
const fetchClistPage = async (
  fs: string,
  fields: string,
  pn: number,
): Promise<Record<string, unknown>[]> => {
  const params = new URLSearchParams({
    pn: String(pn),
    pz: String(BOARD_LIST_PAGE_SIZE),
    po: '1',
    np: '1',
    fltt: '2',
    invt: '2',
    fid: 'f3',
    fs,
    fields,
  });
  const response = await proxyFetch(`${BOARD_CALENDAR_URL.BOARD_LIST}?${params.toString()}`, {
    headers: { 'User-Agent': EASTMONEY_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`东财板块列表 HTTP ${response.status}`);
  }
  const body = (await response.json()) as ClistResponse;
  const diff = body.data?.diff;
  if (!Array.isArray(diff)) {
    // ⚠️ 上游限频 / 异常时返回 200 + data: null，必须显式判空，
    // 否则会把「上游无数据」当成功（成交额模块踩过此坑）
    throw new Error('东财板块列表返回空数据（上游限频或异常）');
  }
  return diff;
};

/**
 * 板块列表行 → BoardSnapshotItem
 * @param row 上游原始行
 * @returns 归一化板块快照
 */
const toSnapshotItem = (row: Record<string, unknown>): BoardSnapshotItem => ({
  code: toText(row.f12),
  name: toText(row.f14),
  changePercent: toNumber(row.f3),
  amount: toNumber(row.f6),
  upCount: toNumber(row.f104),
  downCount: toNumber(row.f105),
  flatCount: toNumber(row.f106),
});

/**
 * 拉取全部一级行业板块快照（31 条，**单请求**）
 *
 * 2026-09-14 实测：`ulist.np/get?secids=90.BKxxxx,...` 一次即可返回全部 31 个板块
 * 与其涨跌家数（`f104/f105/f106`），与「clist 翻 5 页取 496 条再筛 31」结果一致，
 * 但把每次采集的 5 个请求压成 1 个，且不再依赖 496 条的条数阈值。
 * @returns 板块代码 → 快照（未命中的板块不在 Map 中，由调用方判定缺失）
 * @throws Error 上游返回空数据（限频 / 异常）时抛出
 */
export const fetchBoardSnapshot = async (): Promise<Map<string, BoardSnapshotItem>> => {
  const secids = SW_LEVEL1_BOARDS.map((board) => `${BOARD_SECID_PREFIX}.${board.code}`).join(',');
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    fields: BOARD_SNAPSHOT_FIELDS,
    secids,
  });
  const response = await proxyFetch(`${BOARD_CALENDAR_URL.BOARD_QUOTE}?${params.toString()}`, {
    headers: { 'User-Agent': EASTMONEY_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`东财板块快照 HTTP ${response.status}`);
  }
  const body = (await response.json()) as ClistResponse;
  const diff = body.data?.diff;
  // ⚠️ 上游限频 / 异常时返回 200 + data: null，必须显式判空，
  // 否则会把「上游无数据」当成功（成交额模块踩过此坑）
  if (!Array.isArray(diff) || diff.length === 0) {
    throw new Error('东财板块快照返回空数据（上游限频或异常）');
  }
  const map = new Map<string, BoardSnapshotItem>();
  for (const row of diff) {
    const item = toSnapshotItem(row);
    if (item.code.startsWith('BK')) {
      map.set(item.code, item);
    }
  }
  return map;
};

/* -------------------------------- 涨跌停池 -------------------------------- */

/** 东财涨跌停池响应体 */
interface LimitPoolResponse {
  data?: { tc?: number; pool?: Record<string, unknown>[] | null } | null;
}

/**
 * 涨跌停池行 → LimitPoolStock
 *
 * ⚠️ 涨停池与跌停池的字段名不同（实测）：
 * - 涨停池：`fbt` 首封时间 / `lbc` 连板数 / `zbc` 炸板次数
 * - 跌停池：`lbt` 最后封板时间 / `days` 连续跌停天数 / `oc` 开板次数
 * @param row 上游原始行
 * @param limitType 1 = 涨停，-1 = 跌停
 * @returns 归一化涨跌停个股
 */
const toLimitPoolStock = (
  row: Record<string, unknown>,
  limitType: number,
): LimitPoolStock => {
  const isUp = limitType === 1;
  const priceFen = toNumberOrNull(row.p);
  return {
    symbol: toText(row.c),
    name: toText(row.n),
    market: toNumber(row.m),
    // 上游 `p` 是「分」（如 2850 → 28.50 元），实测已交叉验证
    price: priceFen === null ? null : priceFen / 100,
    changePercent: toNumberOrNull(row.zdp),
    amount: toNumberOrNull(row.amount),
    turnoverRate: toNumberOrNull(row.hs),
    sealTime: toSealTime(isUp ? row.fbt : row.lbt),
    openTimes: toNumberOrNull(isUp ? row.zbc : row.oc),
    limitStreak: toNumberOrNull(isUp ? row.lbc : row.days),
    limitType,
  };
};

/**
 * 拉取指定交易日的涨停池或跌停池
 *
 * ⚠️ 响应里的 `qdate` 恒为「今天」，不可作为入库日期，入库日期必须用入参 `date`。
 * 单次 `pagesize` 不受 100 限制（实测 1000 全返回）。
 * @param limitType 1 = 涨停池，-1 = 跌停池
 * @param date 交易日（`YYYYMMDD`）
 * @returns 归一化涨跌停个股（超出回溯窗口时为空数组，不抛错）
 */
export const fetchLimitPool = async (
  limitType: number,
  date: string,
): Promise<LimitPoolStock[]> => {
  const isUp = limitType === 1;
  const params = new URLSearchParams({
    ut: LIMIT_POOL_TOKEN,
    dpt: 'wz.ztzt',
    Pageindex: '0',
    pagesize: String(LIMIT_POOL_PAGE_SIZE),
    sort: isUp ? LIMIT_UP_POOL_SORT : LIMIT_DOWN_POOL_SORT,
    date,
  });
  const base = isUp ? BOARD_CALENDAR_URL.LIMIT_UP_POOL : BOARD_CALENDAR_URL.LIMIT_DOWN_POOL;
  const response = await proxyFetch(`${base}?${params.toString()}`, {
    headers: { 'User-Agent': EASTMONEY_USER_AGENT },
  });
  if (!response.ok) {
    throw new Error(`${isUp ? '涨停' : '跌停'}池 HTTP ${response.status}`);
  }
  const body = (await response.json()) as LimitPoolResponse;
  const pool = body.data?.pool;
  // 超出可回溯窗口的日期返回 pool = null（实测 20260821 → tc=0），视为「该日无数据」
  if (!Array.isArray(pool)) {
    return [];
  }
  return pool
    .map((row) => toLimitPoolStock(row, limitType))
    .filter((stock) => /^\d{6}$/.test(stock.symbol));
};

/* -------------------------------- 成分股 -------------------------------- */

/**
 * 拉取一级行业全部成分股（构建「个股 → 一级行业」映射表用）
 *
 * 实测 31 个板块合计 5621 只 / 76 页 / 约 16s；跨板块重复为 0。
 * @param boardCode 板块代码（BKxxxx）
 * @returns 成分股列表
 */
export const fetchBoardConstituents = async (boardCode: string): Promise<ConstituentItem[]> => {
  const items: ConstituentItem[] = [];
  for (let pn = 1; pn <= CONSTITUENT_MAX_PAGES; pn += 1) {
    const rows = await fetchClistPage(`b:${boardCode}`, 'f12,f14', pn);
    for (const row of rows) {
      const symbol = toText(row.f12);
      if (!/^\d{6}$/.test(symbol)) continue;
      items.push({ symbol, name: toText(row.f14), market: resolveMarket(symbol) });
    }
    if (rows.length < BOARD_LIST_PAGE_SIZE) break;
    await delay(BOARD_REQUEST_GAP_MS);
  }
  return items;
};

/**
 * 拉取某一级行业成分股的实时行情（弹窗「全部成分股」页签，仅当日可用）
 * @param boardCode 板块代码（BKxxxx）
 * @returns 成分股行情列表
 */
export const fetchBoardConstituentQuotes = async (
  boardCode: string,
): Promise<BoardConstituentQuote[]> => {
  const items: BoardConstituentQuote[] = [];
  for (let pn = 1; pn <= CONSTITUENT_MAX_PAGES; pn += 1) {
    const rows = await fetchClistPage(`b:${boardCode}`, 'f12,f14,f2,f3,f8,f6', pn);
    for (const row of rows) {
      const symbol = toText(row.f12);
      if (!/^\d{6}$/.test(symbol)) continue;
      items.push({
        symbol,
        name: toText(row.f14),
        price: toNumberOrNull(row.f2),
        changePercent: toNumberOrNull(row.f3),
        turnoverRate: toNumberOrNull(row.f8),
        amount: toNumberOrNull(row.f6),
      });
    }
    if (rows.length < BOARD_LIST_PAGE_SIZE) break;
    await delay(BOARD_REQUEST_GAP_MS);
  }
  return items;
};

/* -------------------------------- 交易日轴 -------------------------------- */

/** 腾讯日 K 响应体（只需日线数组） */
interface TencentKlineResponse {
  data?: Record<string, { qfqday?: string[][]; day?: string[][] }>;
}

/**
 * 拉取交易日轴（升序）
 *
 * 以指数日 K 的日期序列作为交易日历：即使某日无板块快照，页面也能渲染出空列，
 * 不会因为缺数据导致列错位。
 * @returns 交易日数组（`YYYY-MM-DD`，升序）
 * @throws Error 无法获取任何交易日时抛出
 */
export const fetchTradingDates = async (): Promise<string[]> => {
  const url =
    `${BOARD_CALENDAR_URL.TENCENT_KLINE}` +
    `?param=${CALENDAR_INDEX_SYMBOL},day,,,${TRADING_KLINE_LIMIT},qfq`;
  const response = await proxyFetch(url, { headers: { Referer: TENCENT_REFERER } });
  if (!response.ok) {
    throw new Error(`腾讯日K HTTP ${response.status}`);
  }
  const body = (await response.json()) as TencentKlineResponse;
  const rows = body.data?.[CALENDAR_INDEX_SYMBOL]?.qfqday ?? body.data?.[CALENDAR_INDEX_SYMBOL]?.day ?? [];
  const dates = rows
    .map((row) => row[0])
    .filter((date): date is string => typeof date === 'string' && date.length === 10);
  if (dates.length === 0) {
    throw new Error('交易日轴为空（腾讯日K 无数据）');
  }
  return dates;
};

/**
 * 交易日轴格式转换：`YYYY-MM-DD` → 上游涨跌停池要求的 `YYYYMMDD`
 * @param tradeDate 交易日（`YYYY-MM-DD`）
 * @returns 上游日期参数（`YYYYMMDD`）
 */
export const toPoolDateParam = (tradeDate: string): string => tradeDate.replace(/-/g, '');

/**
 * 本地日期字符串（`YYYY-MM-DD`）
 *
 * 不使用 toISOString：那是 UTC，东八区凌晨会取到前一天。
 * @param date 任意时刻
 * @returns 本地日期字符串
 */
export const toLocalDateString = (date: Date): string => {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
};

/**
 * 当前本地日期（`YYYY-MM-DD`）
 * @returns 本地日期字符串
 */
export const getLocalDateString = (): string => toLocalDateString(new Date());

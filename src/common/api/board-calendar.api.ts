import {
  BOARD_CALENDAR_URL,
  BOARD_FUND_FLOW_FIELDS,
  BOARD_LIST_PAGE_SIZE,
  BOARD_REQUEST_GAP_MS,
  BOARD_SECID_PREFIX,
  BOARD_SNAPSHOT_FIELDS,
  CALENDAR_BOARDS,
  EASTMONEY_USER_AGENT,
  FUND_FLOW_FALLBACK_FS,
  FUND_FLOW_FALLBACK_MAX_PAGES,
  LIMIT_DOWN_POOL_SORT,
  LIMIT_POOL_PAGE_SIZE,
  LIMIT_POOL_TOKEN,
  LIMIT_UP_POOL_SORT,
  TENCENT_REFERER,
  TRADING_KLINE_LIMIT,
} from '../constants/board-calendar.constants.ts';
import type {
  BoardConstituentQuote,
  BoardSnapshotItem,
  CalendarBoardPanoramaItem,
  ConstituentItem,
  LimitPoolStock,
} from '../types/board-calendar.types.ts';
import type { SectorFundFlowItem } from '../types/flow.types.ts';
import { delay } from '../utils/delay';
import { fetchConstituentQuotesBatch, fetchConstituentQuotesByList } from './board-constituent-quote.api.ts';
import { proxyFetch } from './proxy-fetch';
import { push2Fetch } from './push2-fetch';

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
  const response = await push2Fetch(`${BOARD_CALENDAR_URL.BOARD_LIST}?${params.toString()}`, {
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
 * 拉取板块池全部板块快照（31 个申万一级 + 追加板块，**单请求**）
 *
 * 2026-09-14 实测：`ulist.np/get?secids=90.BKxxxx,...` 一次即可返回全部 31 个板块
 * 与其涨跌家数（`f104/f105/f106`），与「clist 翻 5 页取 496 条再筛 31」结果一致，
 * 但把每次采集的 5 个请求压成 1 个，且不再依赖 496 条的条数阈值。
 * 2026-09-15 追加 5 个板块后仍为单请求（实测 10 个 secid 一次查全）；
 * 概念板块同样返回涨跌平家数，故口径不变。
 * @returns 板块代码 → 快照（未命中的板块不在 Map 中，由调用方判定缺失）
 * @throws Error 上游返回空数据（限频 / 异常）时抛出
 */
export const fetchBoardSnapshot = async (): Promise<Map<string, BoardSnapshotItem>> => {
  const secids = CALENDAR_BOARDS.map((board) => `${BOARD_SECID_PREFIX}.${board.code}`).join(',');
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    fields: BOARD_SNAPSHOT_FIELDS,
    secids,
  });
  const response = await push2Fetch(`${BOARD_CALENDAR_URL.BOARD_QUOTE}?${params.toString()}`, {
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

/**
 * 拉取某板块全部成分股的实时涨跌幅（得分分桶采集专用）
 *
 * 2026-10-30 起改走腾讯批量报价多通道（`fetchConstituentQuotesBatch`，见
 * board-constituent-quote.api.ts）：clist 路径在本机被 TCP 封禁且无兜底，
 * 每日分桶整段降级。成员清单优先用调用方传入的本地清单（零上游）；未传时
 * 回落 clist 清单通道（封禁窗口内会失败，与旧版行为一致）。
 * 停牌 / 无行情成员不计入返回值（分桶侧自然跳过，不落入任何桶）。
 * @param boardCode 板块代码（BKxxxx）
 * @param constituents 板块成分清单（可选；本地 board_constituent 的 symbol 列表）
 * @returns symbol → 涨跌幅（%）；两通道均失败时抛出
 * @throws Error 腾讯与东财通道均失败时抛出
 */
export const fetchBoardConstituentChangePct = async (
  boardCode: string,
  constituents?: Array<{ symbol: string }>,
): Promise<Map<string, number>> => {
  const symbols =
    constituents && constituents.length > 0
      ? constituents.map((item) => item.symbol)
      : (await fetchBoardConstituents(boardCode)).map((item) => item.symbol);
  const quotes = await fetchConstituentQuotesBatch(symbols);
  const map = new Map<string, number>();
  for (const [symbol, quote] of quotes) {
    if (quote.changePercent !== null) {
      map.set(symbol, quote.changePercent);
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
 * 拉取某板块全部成分股（构建「个股 → 板块」映射表用）
 *
 * 实测 31 个一级行业合计 5621 只 / 76 页 / 约 16s；跨一级行业重复为 0。
 * 追加板块与一级行业**会有重叠**（同一只票可同时属于电子与半导体），
 * 映射表按一对多落库（`board_constituent` 主键是 (board_code, symbol)）。
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
 * 拉取某板块成分股的实时行情（板块分析扩展行 / 原明细弹窗用）
 *
 * 2026-10-30 起改走多通道（`fetchConstituentQuotesByList`，见
 * board-constituent-quote.api.ts）：原 clist 翻页在本机被 TCP 封禁且无兜底。
 * 成员清单优先用调用方传入的本地清单；未传时回落 clist 清单通道（封禁窗口内
 * 会失败，与旧版行为一致）。行情缺失的成员保留清单行（价格等置 null）。
 * @param boardCode 板块代码（BKxxxx）
 * @param constituents 板块成分清单（可选；本地 board_constituent 行）
 * @returns 成分股行情列表（按涨跌幅降序）
 */
export const fetchBoardConstituentQuotes = async (
  boardCode: string,
  constituents?: Array<{ symbol: string; stockName: string }>,
): Promise<BoardConstituentQuote[]> => {
  if (constituents && constituents.length > 0) {
    return fetchConstituentQuotesByList(constituents);
  }
  // clist 清单字段是 name（ConstituentItem），对齐本函数的 stockName 口径
  const fallback = await fetchBoardConstituents(boardCode);
  return fetchConstituentQuotesByList(
    fallback.map((item) => ({ symbol: item.symbol, stockName: item.name })),
  );
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

/* ------------------------ 36 板块统一全景（2026-10-29 王总指定） ------------------------ */

/**
 * 拉取 36 板块统一全景（板块日历池，按涨跌幅降序）
 *
 * 消费 `fetchBoardSnapshot()`（单请求），供热力图与平铺网格类模块与题材轮动 / 板块日历同源：
 * A股全景（PC + 移动端）、市场总览板块热力、移动端首页热力卡（2026-10-29 起统一口径）。
 * 上游未返回的板块跳过（限频时由调用方的快照播种 / 失败兜底处理）。
 * @returns 全景条目列表（涨跌幅降序；含 code / 成交额 / 涨跌家数）
 * @throws Error 上游限频 / 异常时抛出（透传 fetchBoardSnapshot）
 */
export const fetchCalendarBoardPanorama = async (): Promise<CalendarBoardPanoramaItem[]> => {
  const snapshot = await fetchBoardSnapshot();
  const items = CALENDAR_BOARDS.flatMap((board): CalendarBoardPanoramaItem[] => {
    const row = snapshot.get(board.code);
    if (!row) return [];
    return [
      {
        code: row.code,
        name: row.name,
        changePercent: row.changePercent,
        amount: row.amount,
        upCount: row.upCount,
        downCount: row.downCount,
      },
    ];
  });
  return items.sort((a, b) => b.changePercent - a.changePercent);
};

/**
 * 由上游原始行构造板块资金流条目（仅收 36 池内代码）
 * @param row 上游原始行（f12/f14/f3/f62/f184）
 * @param nameByCode 池内代码 → 名称映射
 * @returns 条目（池外代码返回 null）
 */
const toFundFlowItem = (
  row: Record<string, unknown>,
  nameByCode: Map<string, string>,
): SectorFundFlowItem | null => {
  const code = toText(row.f12);
  if (!nameByCode.has(code)) return null;
  return {
    code,
    name: nameByCode.get(code) ?? toText(row.f14),
    changePercent: toNumberOrNull(row.f3),
    mainNetInflow: toNumberOrNull(row.f62),
    mainNetInflowPercent: toNumberOrNull(row.f184),
    superLargeNetInflow: null,
    largeNetInflow: null,
    mediumNetInflow: null,
    smallNetInflow: null,
  };
};

/**
 * 板块池按主力净流入降序
 * @param items 资金流条目列表
 * @returns 原数组（已就地降序排序）
 */
const sortFundFlowDesc = (items: SectorFundFlowItem[]): SectorFundFlowItem[] =>
  items.sort((a, b) => (b.mainNetInflow ?? 0) - (a.mainNetInflow ?? 0));

/**
 * 兜底通道：clist 按主力净流入排行翻页（fid=f62，fs=m:90 全板块），过滤出 36 池
 *
 * 与 SDK `fundFlow.sectorRank` 同款通道（应用内已验证可用），仅在 ulist 快照通道
 * 返回空 / 报错时启用；页间按 `BOARD_REQUEST_GAP_MS` 错峰。板块总数约千级 → 全量翻页
 * 最多 `FUND_FLOW_FALLBACK_MAX_PAGES` 页。
 * @returns 板块资金流条目（主力净流入降序，可能少于 36 个——上游缺失即跳过）
 */
const fetchFundFlowViaClist = async (): Promise<SectorFundFlowItem[]> => {
  const nameByCode = new Map(CALENDAR_BOARDS.map((board) => [board.code, board.name]));
  const items: SectorFundFlowItem[] = [];
  const hitCodes = new Set<string>();
  for (let pn = 1; pn <= FUND_FLOW_FALLBACK_MAX_PAGES && hitCodes.size < CALENDAR_BOARDS.length; pn += 1) {
    const params = new URLSearchParams({
      pn: String(pn),
      pz: String(BOARD_LIST_PAGE_SIZE),
      po: '1',
      np: '1',
      fltt: '2',
      invt: '2',
      fid: 'f62',
      fs: FUND_FLOW_FALLBACK_FS,
      fields: BOARD_FUND_FLOW_FIELDS,
    });
    const response = await push2Fetch(`${BOARD_CALENDAR_URL.BOARD_LIST}?${params.toString()}`, {
      headers: { 'User-Agent': EASTMONEY_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`东财板块资金流（clist 兜底）HTTP ${response.status}`);
    }
    const body = (await response.json()) as ClistResponse;
    const diff = body.data?.diff;
    // ⚠️ 上游限频 / 异常时返回 200 + data: null，必须显式判空
    if (!Array.isArray(diff) || diff.length === 0) {
      throw new Error('东财板块资金流返回空数据（上游限频或异常）');
    }
    for (const row of diff) {
      const item = toFundFlowItem(row, nameByCode);
      if (item && !hitCodes.has(item.code)) {
        hitCodes.add(item.code);
        items.push(item);
      }
    }
    if (diff.length < BOARD_LIST_PAGE_SIZE) break;
    await delay(BOARD_REQUEST_GAP_MS);
  }
  return sortFundFlowDesc(items);
};

/**
 * 拉取 36 板块主力净流入榜单（板块日历池，按主力净流入降序）
 *
 * 主通道：与 `fetchBoardSnapshot` 同形态的 `ulist.np/get` 单请求，fields 扩为
 * `f12,f14,f3,f62,f184`（f62 主力净额 / f184 净占比）+ `fid=f62`（资金字段需显式声明
 * 排序基准才返回，东财自选板块资金流同款形态）；主通道空 / 报错时回落 clist 排行翻页兜底。
 * 供资金流向页与 496 全量行业榜单解耦；SDK `SectorFundFlowItem` 中不消费的分解字段置 null。
 * @returns 板块资金流条目（主力净流入降序）
 * @throws Error 主通道与兜底通道均失败（限频 / 异常）时抛出
 */
export const fetchCalendarBoardFundFlow = async (): Promise<SectorFundFlowItem[]> => {
  const secids = CALENDAR_BOARDS.map((board) => `${BOARD_SECID_PREFIX}.${board.code}`).join(',');
  const params = new URLSearchParams({
    fltt: '2',
    invt: '2',
    // 资金字段（f62/f184）需显式声明排序基准 fid=f62 才返回（东财自选板块资金流同款形态）
    fid: 'f62',
    fields: BOARD_FUND_FLOW_FIELDS,
    secids,
  });
  const nameByCode = new Map(CALENDAR_BOARDS.map((board) => [board.code, board.name]));
  try {
    const response = await push2Fetch(`${BOARD_CALENDAR_URL.BOARD_QUOTE}?${params.toString()}`, {
      headers: { 'User-Agent': EASTMONEY_USER_AGENT },
    });
    if (!response.ok) {
      throw new Error(`东财板块资金流 HTTP ${response.status}`);
    }
    const body = (await response.json()) as ClistResponse;
    const diff = body.data?.diff;
    // ⚠️ 上游限频 / 异常时返回 200 + data: null，必须显式判空（快照接口同款坑）
    if (!Array.isArray(diff) || diff.length === 0) {
      throw new Error('东财板块资金流返回空数据（上游限频或异常）');
    }
    const items = diff
      .map((row) => toFundFlowItem(row, nameByCode))
      .filter((item): item is SectorFundFlowItem => item !== null);
    if (items.length === 0) {
      throw new Error('东财板块资金流未命中板块池（f62 字段缺失）');
    }
    return sortFundFlowDesc(items);
  } catch (error) {
    console.warn('[board-calendar] ulist 资金流通道失败，回落 clist 兜底', error);
    return fetchFundFlowViaClist();
  }
};

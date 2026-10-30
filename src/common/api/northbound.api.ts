import { delay } from '../utils/delay';
import { proxyFetch } from './proxy-fetch';
import { sdk } from './sdk';
import {
  NORTHBOUND_HISTORY_RANGE_DAYS,
  NORTHBOUND_MILLION_TO_YUAN,
  NORTHBOUND_RANK_MAX_PAGES,
} from '../constants/northbound.constants.ts';
import type {
  NorthboundDirection,
  NorthboundFlowSummary,
  NorthboundHistoryRange,
  NorthboundHistoryRow,
  NorthboundIndividualItem,
  NorthboundMinuteItem,
  NorthboundRankMarket,
  NorthboundRankRow,
} from '../types/northbound.types.ts';

/**
 * 沪深港通（北向/南向）资金数据接口层
 *
 * 数据源（2026-10-30 实测定型）：
 * - summary / minute / individual 走 stock-sdk（上游正常）；
 * - 资金历史：stock-sdk 的 history 方法因上游 `BOARD_TYPE` 列被移除而失效，
 *   改为自行调 datacenter `RPT_MUTUAL_DEAL_HISTORY`（金额单位百万元）；
 * - 北向持股排行：原 `RPT_MUTUAL_STOCK_NORTHSTA` 已废弃（恒「服务器繁忙」），
 *   改用季度披露表 `RPT_MUTUAL_HOLDSTOCKNORTH_STA` 最新一期快照；
 * - 上游金额单位：summary / minute 为万元，历史表为百万元，本层统一换算为**元**
 */

/** 东方财富数据中心开放接口地址 */
const DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/** datacenter 通用响应结构 */
interface DatacenterResponse<T> {
  /** 是否成功（9501 列不存在 / 9701 服务器繁忙等业务码时为 false） */
  success: boolean;
  /** 业务码（0 成功） */
  code: number;
  /** 业务消息 */
  message: string;
  /** 数据包（失败时 null） */
  result: {
    /** 总行数 */
    count: number;
    /** 总页数 */
    pages: number;
    /** 当前页行 */
    data: T[];
  } | null;
}

/** RPT_MUTUAL_DEAL_HISTORY 行（金额单位百万元） */
interface DealHistoryRawRow {
  /** 交易日期（YYYY-MM-DD HH:mm:ss） */
  TRADE_DATE: string;
  /** 通道类型（001-005） */
  MUTUAL_TYPE: string;
  /** 成交净买额（百万元；北向 2024-08 后为 null） */
  NET_DEAL_AMT: number | null;
  /** 买入成交额（百万元） */
  BUY_AMT: number | null;
  /** 卖出成交额（百万元） */
  SELL_AMT: number | null;
  /** 历史累计净买额（百万元） */
  ACCUM_DEAL_AMT: number | null;
  /** 当日资金流入（百万元，停披露） */
  FUND_INFLOW: number | null;
  /** 当日资金余额（百万元，停披露） */
  QUOTA_BALANCE: number | null;
  /** 当日成交额（百万元；北向停披露后仍持续提供） */
  DEAL_AMT: number | null;
  /** 领涨股代码（600592.SH / 02656.HK 形态） */
  LEAD_STOCKS_CODE: string | null;
  /** 领涨股名称 */
  LEAD_STOCKS_NAME: string | null;
  /** 领涨股涨跌幅（%） */
  LS_CHANGE_RATE: number | null;
}

/** RPT_MUTUAL_HOLDSTOCKNORTH_STA 行（北向持股季度快照） */
interface HoldingRawRow {
  /** 数据期（YYYY-MM-DD HH:mm:ss，季度末） */
  TRADE_DATE: string;
  /** 股票代码（6 位纯代码） */
  SECURITY_CODE: string;
  /** 股票名称 */
  SECURITY_NAME: string;
  /** 期末收盘价（元） */
  CLOSE_PRICE: number | null;
  /** 当日涨跌幅（%） */
  CHANGE_RATE: number | null;
  /** 持股数量（股） */
  HOLD_SHARES: number | null;
  /** 持股市值（元） */
  HOLD_MARKET_CAP: number | null;
  /** 持股占流通股比（%） */
  FREE_SHARES_RATIO: number | null;
  /** 持股占总股本比（%） */
  TOTAL_SHARES_RATIO: number | null;
}

/**
 * 截取日期串的 YYYY-MM-DD 部分
 * @param raw 上游日期（YYYY-MM-DD HH:mm:ss 形态）
 * @returns YYYY-MM-DD
 */
const toDate = (raw: string): string => raw.slice(0, 10);

/**
 * 按范围换算起始日期（自然日回溯，天数 ×1.7 取整覆盖节假日）
 * @param range 历史卡范围
 * @param today 今天（YYYY-MM-DD）
 * @returns 起始日期（YYYY-MM-DD）
 */
const rangeToStartDate = (range: NorthboundHistoryRange, today: string): string => {
  const days = Math.round(NORTHBOUND_HISTORY_RANGE_DAYS[range] * 1.7);
  const start = new Date(`${today}T00:00:00`);
  start.setDate(start.getDate() - days);
  return start.toISOString().slice(0, 10);
};

/**
 * 调用东方财富数据中心开放接口（经统一代理通道，自动埋点）
 * @param params 查询参数（reportName / filter / sortColumns 等）
 * @returns 当前页行（接口失败返回空数组，由上层空态兜底）
 */
const dcFetchPage = async <T>(params: Record<string, string>): Promise<{ rows: T[]; pages: number }> => {
  const search = new URLSearchParams({
    pageSize: '500',
    pageNumber: '1',
    source: 'WEB',
    client: 'WEB',
    ...params,
  });
  const response = await proxyFetch(`${DATACENTER_URL}?${search.toString()}`);
  const json = (await response.json()) as DatacenterResponse<T>;
  if (!json.success || !json.result) {
    return { rows: [], pages: 1 };
  }
  return { rows: json.result.data ?? [], pages: json.result.pages ?? 1 };
};

/**
 * 百万元换算为元（上游历史表口径）
 * @param value 百万元数值（null 透传）
 * @returns 元数值
 */
const millionToYuan = (value: number | null): number | null =>
  value === null ? null : value * NORTHBOUND_MILLION_TO_YUAN;

/**
 * 历史原始行映射为业务类型（金额换算为元）
 * @param row datacenter 原始行
 * @returns 业务历史行
 */
const mapHistoryRow = (row: DealHistoryRawRow): NorthboundHistoryRow => ({
  date: toDate(row.TRADE_DATE),
  netBuyAmount: millionToYuan(row.NET_DEAL_AMT),
  buyAmount: millionToYuan(row.BUY_AMT),
  sellAmount: millionToYuan(row.SELL_AMT),
  accNetBuyAmount: millionToYuan(row.ACCUM_DEAL_AMT),
  netInflow: millionToYuan(row.FUND_INFLOW),
  remainAmount: millionToYuan(row.QUOTA_BALANCE),
  dealAmount: millionToYuan(row.DEAL_AMT),
  topStockCode: row.LEAD_STOCKS_CODE ?? null,
  topStockName: row.LEAD_STOCKS_NAME ?? null,
  topStockChangePercent: row.LS_CHANGE_RATE ?? null,
});

/**
 * 南向两通道（港股通沪/深）按日合并：可加总字段相加，领涨股不合并
 * @param a 通道一序列（升序）
 * @param b 通道二序列（升序）
 * @returns 合并后的南向合计序列（升序）
 */
const mergeSouthRows = (a: NorthboundHistoryRow[], b: NorthboundHistoryRow[]): NorthboundHistoryRow[] => {
  const byDate = new Map<string, NorthboundHistoryRow>();
  for (const row of [...a, ...b]) {
    const merged = byDate.get(row.date);
    const add = (x: number | null, y: number | null): number | null =>
      x === null ? y : y === null ? x : x + y;
    if (!merged) {
      byDate.set(row.date, { ...row, topStockCode: null, topStockName: null, topStockChangePercent: null });
      continue;
    }
    merged.netBuyAmount = add(merged.netBuyAmount, row.netBuyAmount);
    merged.buyAmount = add(merged.buyAmount, row.buyAmount);
    merged.sellAmount = add(merged.sellAmount, row.sellAmount);
    merged.accNetBuyAmount = add(merged.accNetBuyAmount, row.accNetBuyAmount);
    merged.netInflow = add(merged.netInflow, row.netInflow);
    merged.remainAmount = add(merged.remainAmount, row.remainAmount);
    merged.dealAmount = add(merged.dealAmount, row.dealAmount);
  }
  return [...byDate.values()].sort((x, y) => x.date.localeCompare(y.date));
};

/**
 * 历史通道类型：北向取合计行（005），南向取港股通沪（002）+ 港股通深（004）
 */
const HISTORY_MUTUAL_TYPES = {
  north: ['005'],
  south: ['002', '004'],
} as const;

/**
 * 拉取沪深港通市场资金流向汇总（东财 datacenter RPT_MUTUAL_QUOTA）
 *
 * 金额单位：上游为万元，SDK 未换算（d.ts 标注「元」有误），展示请用
 * `formatNorthboundAmount({ source: 'wan' })`；北向两行净买额停披露恒为 0
 * @returns 四通道汇总行（沪股通 / 港股通沪 / 深股通 / 港股通深）
 */
export const fetchNorthboundSummary = async (): Promise<NorthboundFlowSummary[]> =>
  sdk.northbound.summary();

/**
 * 拉取沪深港通当日分时净流入（每分钟一点；东财 kamtbs.rtmin）
 *
 * 金额单位：**万元**；北向方向停披露（序列恒 0），默认展示南向
 * @param direction 资金方向（north 北向 / south 南向）
 * @returns 分时序列（北向 241 点 9:30-15:00；南向 371 点 9:00-16:10）
 */
export const fetchNorthboundMinute = async (
  direction: NorthboundDirection,
): Promise<NorthboundMinuteItem[]> => sdk.northbound.minute(direction);

/**
 * 拉取北向 / 南向资金按日历史（东财 datacenter RPT_MUTUAL_DEAL_HISTORY）
 *
 * 金额单位：**元**（上游百万元已换算）；北向净买额自 2024-08-19 起停披露为 null
 * （成交额照常），南向为港股通沪/深两通道按日合并（领涨股不合并展示为 null）
 * @param direction 资金方向
 * @param range 时间范围（默认 '30d'）
 * @returns 历史序列（升序）
 */
export const fetchNorthboundHistory = async (
  direction: NorthboundDirection,
  range: NorthboundHistoryRange = '30d',
): Promise<NorthboundHistoryRow[]> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = rangeToStartDate(range, today);
  const filter = [
    `(TRADE_DATE>='${startDate}')`,
    `(TRADE_DATE<='${today}')`,
  ].join('');
  const types = HISTORY_MUTUAL_TYPES[direction];
  const channelRows: NorthboundHistoryRow[][] = [];
  for (let i = 0; i < types.length; i += 1) {
    // 同一上游连续请求错峰（东财红线：delay 500ms）
    if (i > 0) {
      await delay(500);
    }
    const { rows } = await dcFetchPage<DealHistoryRawRow>({
      reportName: 'RPT_MUTUAL_DEAL_HISTORY',
      columns: 'ALL',
      sortColumns: 'TRADE_DATE',
      sortTypes: '-1',
      filter: `${filter}(MUTUAL_TYPE="${types[i]}")`,
    });
    channelRows.push(rows.map(mapHistoryRow));
  }
  if (direction === 'south') {
    return mergeSouthRows(channelRows[0] ?? [], channelRows[1] ?? []);
  }
  return (channelRows[0] ?? []).sort((x, y) => x.date.localeCompare(y.date));
};

/**
 * 拉取北向持股个股排行（东财 datacenter RPT_MUTUAL_HOLDSTOCKNORTH_STA）
 *
 * 上游为**季度披露**快照：取最新一期全市场行，按持股市值降序（本地排序）；
 * market 为本地筛选（沪市 6 开头 / 深市 0、3 开头），不触发额外请求
 * @param opts 可选项
 * @param opts.market 市场筛选（默认 all）
 * @returns 排行行（持股市值降序）
 */
export const fetchNorthboundHoldingRank = async (
  opts: { market?: NorthboundRankMarket } = {},
): Promise<NorthboundRankRow[]> => {
  const market = opts.market ?? 'all';
  const first = await dcFetchPage<HoldingRawRow>({
    reportName: 'RPT_MUTUAL_HOLDSTOCKNORTH_STA',
    columns: 'ALL',
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
  });
  if (first.rows.length === 0) {
    return [];
  }
  // 最新一期的日期（首页首行即最新期）
  const latestDate = toDate(first.rows[0].TRADE_DATE);
  const allRows: HoldingRawRow[] = [...first.rows];
  for (let page = 2; page <= Math.min(first.pages, NORTHBOUND_RANK_MAX_PAGES); page += 1) {
    await delay(500);
    const next = await dcFetchPage<HoldingRawRow>({
      reportName: 'RPT_MUTUAL_HOLDSTOCKNORTH_STA',
      columns: 'ALL',
      sortColumns: 'TRADE_DATE',
      sortTypes: '-1',
      pageNumber: String(page),
    });
    // 越过最新期即停（首页可能跨期）
    if (next.rows.length === 0 || toDate(next.rows[0].TRADE_DATE) !== latestDate) {
      break;
    }
    allRows.push(...next.rows.filter((row) => toDate(row.TRADE_DATE) === latestDate));
  }
  const marketMatch = (code: string): boolean => {
    if (market === 'shanghai') return code.startsWith('6');
    if (market === 'shenzhen') return code.startsWith('0') || code.startsWith('3');
    return true;
  };
  return allRows
    .filter((row) => toDate(row.TRADE_DATE) === latestDate && marketMatch(row.SECURITY_CODE))
    .map((row) => ({
      date: latestDate,
      code: row.SECURITY_CODE,
      name: row.SECURITY_NAME,
      close: row.CLOSE_PRICE,
      changePercent: row.CHANGE_RATE,
      holdShares: row.HOLD_SHARES,
      holdMarketValue: row.HOLD_MARKET_CAP,
      holdRatioFloat: row.FREE_SHARES_RATIO,
      holdRatioTotal: row.TOTAL_SHARES_RATIO,
    }))
    .sort((x, y) => (y.holdMarketValue ?? 0) - (x.holdMarketValue ?? 0));
};

/**
 * 拉取个股北向持仓历史（东财 datacenter，stock-sdk individual 通道）
 *
 * 上游为**季度披露**：区间内通常只有季度末快照若干条；金额单位元
 * @param symbol 个股符号（600519 / sh600519 形态均可，SDK 内部归一）
 * @param range 时间范围（默认 '120d'）
 * @returns 持仓历史序列（升序）
 */
export const fetchNorthboundIndividual = async (
  symbol: string,
  range: NorthboundHistoryRange = '120d',
): Promise<NorthboundIndividualItem[]> => {
  const today = new Date().toISOString().slice(0, 10);
  const startDate = rangeToStartDate(range, today);
  return sdk.northbound.individual(symbol, { startDate, endDate: today });
};

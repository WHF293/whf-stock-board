import { proxyFetch } from './proxy-fetch';
import { sdk } from './sdk';
import { BOARD_CALENDAR_URL, TENCENT_REFERER } from '../constants/board-calendar.constants.ts';
import type { MarginAccountItem } from 'stock-sdk';

/**
 * 融资融券数据接口层（上游东财 datacenter）
 *
 * 数据时效：交易所**次一交易日**公布两融数据，accountInfo 最新一条通常是
 * 上一交易日，盘中查不到当天数据 —— 属正常时效，不是接口错误
 *
 * 单位口径（2026-11-02 实测定型）：
 * - accountInfo（stock-sdk `margin.accountInfo`，上游 RPT_RZRQ_LSHJ）：
 *   SDK 已把金额换算为**亿元**（finBalance 23152.77 ≈ 2.3 万亿），展示层直接按亿读；
 * - targetList：SDK 自带的 `margin.targetList` 上游报表 `RPT_MARGIN_TRADE_DETAIL`
 *   已被东财下线（恒返回 0 行），改自行调 datacenter `RPTA_WEB_RZRQ_GGMX`
 *   （个股两融明细全量表），金额字段为**元**，本层换算为元口径输出
 */

/** 东方财富数据中心开放接口地址 */
const DATACENTER_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/** datacenter 通用响应结构 */
interface DatacenterResponse<T> {
  /** 是否成功 */
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

/** RPTA_WEB_RZRQ_GGMX 原始行（金额单位元，数量单位股） */
interface MarginTargetRawRow {
  /** 数据日期（YYYY-MM-DD HH:mm:ss） */
  DATE: string;
  /** 证券代码（6 位纯代码） */
  SCODE: string;
  /** 证券名称 */
  SECNAME: string;
  /** 融资余额（元） */
  RZYE: number | null;
  /** 融资买入额（元） */
  RZMRE: number | null;
  /** 融资偿还额（元） */
  RZCHE: number | null;
  /** 融券余量（股） */
  RQYL: number | null;
  /** 融券卖出量（股） */
  RQMCL: number | null;
  /** 融券偿还量（股） */
  RQCHL: number | null;
}

/** 两融标的明细业务行（金额元 / 数量股；字段与 stock-sdk MarginTargetItem 同构） */
export interface MarginTargetItem {
  /** 证券代码（6 位纯代码） */
  code: string;
  /** 证券名称 */
  name: string;
  /** 数据日期（YYYY-MM-DD） */
  date: string;
  /** 融资余额（元） */
  finBalance: number | null;
  /** 融资买入额（元） */
  finBuyAmount: number | null;
  /** 融资偿还额（元） */
  finRepayAmount: number | null;
  /** 融券余量（股） */
  loanBalance: number | null;
  /** 融券卖出量（股） */
  loanSellVolume: number | null;
  /** 融券偿还量（股） */
  loanRepayVolume: number | null;
}

/**
 * 融资融券账户统计（按日倒序，最新在前；金额单位**亿元**，见文件头单位口径）
 * @returns 账户统计列表
 */
export const fetchMarginAccount = (): Promise<MarginAccountItem[]> => sdk.margin.accountInfo();

/**
 * 两融标的明细（金额换算为元、数量为股）
 *
 * 上游单日约 3000+ 行，pageSize 5000 一页取全；按融资余额降序（与展示默认序一致）
 * @param date 交易日（YYYY-MM-DD，省略取服务端最新一期）
 * @returns 该日两融标列表
 */
export const fetchMarginTargets = async (date?: string): Promise<MarginTargetItem[]> => {
  const search = new URLSearchParams({
    reportName: 'RPTA_WEB_RZRQ_GGMX',
    columns: 'ALL',
    sortColumns: 'RZYE',
    sortTypes: '-1',
    pageSize: '5000',
    pageNumber: '1',
    source: 'WEB',
    client: 'WEB',
  });
  if (date) {
    search.set('filter', `(DATE='${date}')`);
  }
  const response = await proxyFetch(`${DATACENTER_URL}?${search.toString()}`);
  const json = (await response.json()) as DatacenterResponse<MarginTargetRawRow>;
  if (!json.success || !json.result) {
    throw new Error(`两融标明细拉取失败：${json.message || '上游无数据'}`);
  }
  return (json.result.data ?? []).map((row) => ({
    code: row.SCODE,
    name: row.SECNAME,
    date: row.DATE.slice(0, 10),
    finBalance: row.RZYE,
    finBuyAmount: row.RZMRE,
    finRepayAmount: row.RZCHE,
    loanBalance: row.RQYL,
    loanSellVolume: row.RQMCL,
    loanRepayVolume: row.RQCHL,
  }));
};

/* ---------------- 指数日涨跌幅序列（融资余额走势叠加对比用，2026-11-02） ---------------- */

/** 腾讯日 K 响应体（只需日线数组；指数无复权，qfq 参数返回 day 键） */
interface TencentKlineResponse {
  data?: Record<string, { qfqday?: string[][]; day?: string[][] }>;
}

/** 指数日涨跌幅业务行 */
export interface IndexDailyPctItem {
  /** 交易日（YYYY-MM-DD） */
  date: string;
  /** 当日收盘涨跌幅（%，较上一交易日收盘；首个交易日为 null） */
  pct: number | null;
}

/**
 * 拉取指数日收盘涨跌幅序列（升序）
 *
 * 腾讯日 K 通道（与板块日历交易日轴同源）：指数不做复权，直接 day K；
 * 涨跌幅 = 相邻收盘环比，首点 null（K 线多取一根做基期）。
 * @param symbol 腾讯形态符号（sh000001 上证指数 / sz399006 创业板指）
 * @param limit 取多少根日 K（含基期一根）
 * @returns 涨跌幅序列（升序）
 * @throws Error HTTP 异常或上游无数据时抛出
 */
export const fetchIndexDailyPct = async (
  symbol: string,
  limit: number,
): Promise<IndexDailyPctItem[]> => {
  const url = `${BOARD_CALENDAR_URL.TENCENT_KLINE}?param=${symbol},day,,,${limit},qfq`;
  const response = await proxyFetch(url, { headers: { Referer: TENCENT_REFERER } });
  if (!response.ok) {
    throw new Error(`指数日K HTTP ${response.status}`);
  }
  const body = (await response.json()) as TencentKlineResponse;
  // 指数（sh/sz 前缀）走 day 键；qfqday 兜底（与 fetchTradingDates 同口径）
  const rows = body.data?.[symbol]?.day ?? body.data?.[symbol]?.qfqday ?? [];
  const closes = rows
    .map((row) => ({ date: row[0], close: Number(row[2]) }))
    .filter((row) => row.date.length === 10 && Number.isFinite(row.close));
  if (closes.length === 0) {
    throw new Error(`指数日K无数据（${symbol}）`);
  }
  return closes.map((row, index) => ({
    date: row.date,
    pct: index === 0 ? null : ((row.close - closes[index - 1].close) / closes[index - 1].close) * 100,
  }));
};

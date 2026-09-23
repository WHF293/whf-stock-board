import { proxyFetch } from './proxy-fetch';
import { sdk } from './sdk';
import {
  PANORAMA_CLIST_PAGE_SIZE,
  PANORAMA_GLOBAL_INDEX_FS,
  PANORAMA_GLOBAL_INDEX_SECIDS,
  PANORAMA_US_SECIDS,
} from '../constants/panorama.constants';
import type { GlobalIndexQuote, PanoramaItem } from '../types/panorama.types';

/**
 * 行情全景 api：东财 clist / ulist 直连（走同源代理）+ SDK 全球期货
 *
 * A 股板块复用 board.api 的概念板块接口；本文件只补美股行业 ETF / 全球指数 /
 * 外盘商品三类源，全部为进入页面时拉取一次（不参与轮询）
 *
 * 上游 host 实测说明：push2delay 域连通性最稳（同为 SDK 镜像域之一）；
 * 美股行业 ETF 走 ulist.np/get 精确 secid 查询（clist 无对应板块分类码）
 */

/** 东财 clist 请求地址 */
const CLIST_URL_BASE = 'https://push2delay.eastmoney.com/api/qt/clist/get';

/** 东财 ulist 批量标的请求地址（secids 精确查询） */
const ULIST_URL_BASE = 'https://push2delay.eastmoney.com/api/qt/ulist.np/get';

/** 行情取值字段：f12 代码 / f14 名称 / f3 涨跌幅（fltt=2 已归一为百分数数值） */
const QUOTE_FIELDS = 'f12,f14,f3';

/** 全球指数取值字段：f2 最新价 / f12 代码 / f14 名称 / f3 涨跌幅 */
const GLOBAL_INDEX_FIELDS = 'f2,f12,f14,f3';

/** 上游列表响应体（仅取本页所需字段） */
interface EastmoneyListResponse {
  data: {
    diff: {
      f12: string;
      f14: string;
      f3: number | string;
    }[];
  } | null;
}

/** 全球指数 ulist 响应体（比列表接口多 f2 最新价） */
interface EastmoneyUlistResponse {
  data: {
    diff: {
      f2: number | string;
      f12: string;
      f14: string;
      f3: number | string;
    }[];
  } | null;
}

/**
 * 解析列表单条为全景条目（f3 为 '-' 时视为无数据）
 * @param raw 上游原始条目
 * @param raw.f12 代码
 * @param raw.f14 名称
 * @param raw.f3 涨跌幅
 * @returns 全景条目
 */
const toPanoramaItem = (raw: {
  f12: string;
  f14: string;
  f3: number | string;
}): PanoramaItem => ({
  name: raw.f14,
  changePercent: typeof raw.f3 === 'number' ? raw.f3 : null,
});

/**
 * 通用东财 clist 拉取（push2delay 域，经同源代理转发）
 * @param fs 市场分类码（如 m:100 全球指数）
 * @returns 全景条目列表（按涨跌幅降序，与 po=1 fid=f3 一致）
 */
const fetchClist = async (fs: string): Promise<PanoramaItem[]> => {
  // fs 含 '+'，不能用 URLSearchParams（会把 + 编码为 %2B 上游不识别），手工拼接
  const query = [
    'pn=1',
    `pz=${PANORAMA_CLIST_PAGE_SIZE}`,
    'po=1',
    'np=1',
    'fltt=2',
    'invt=2',
    'fid=f3',
    `fs=${fs}`,
    `fields=${QUOTE_FIELDS}`,
  ].join('&');
  const response = await proxyFetch(`${CLIST_URL_BASE}?${query}`);
  if (!response.ok) {
    throw new Error(`clist 请求失败：HTTP ${response.status}`);
  }
  const body = (await response.json()) as EastmoneyListResponse;
  return (body.data?.diff ?? []).map(toPanoramaItem);
};

/**
 * 拉取美股全景（SPDR 行业 ETF 系列，ulist 接口按 secids 精确查询）
 * @returns 美股行业 ETF 列表（名称 + 涨跌幅，按涨跌幅降序）
 */
export const fetchUsSectorPanorama = async (): Promise<PanoramaItem[]> => {
  const query = [
    'fltt=2',
    `fields=${QUOTE_FIELDS}`,
    `secids=${PANORAMA_US_SECIDS.join(',')}`,
  ].join('&');
  const response = await proxyFetch(`${ULIST_URL_BASE}?${query}`);
  if (!response.ok) {
    throw new Error(`ulist 请求失败：HTTP ${response.status}`);
  }
  const body = (await response.json()) as EastmoneyListResponse;
  const items = (body.data?.diff ?? []).map(toPanoramaItem);
  // ulist 按传入 secids 顺序返回，按涨跌幅降序对齐全景展示口径
  return items.sort((a, b) => (b.changePercent ?? 0) - (a.changePercent ?? 0));
};

/**
 * 拉取全球指数全景（东财源）
 * @returns 全球指数列表（名称 + 涨跌幅，按涨跌幅降序）
 */
export const fetchGlobalIndexPanorama = async (): Promise<PanoramaItem[]> =>
  fetchClist(PANORAMA_GLOBAL_INDEX_FS);

/**
 * 任务栏盯盘小组件「大盘走势」视图的指数 secids（东财形态，展示顺序即此顺序）
 *
 * 上证指数 / 深证成指 / 创业板指 / 恒生指数：A股三大指数东财 ulist 直接覆盖，
 * 恒生与市场总览「全球指数」同形态（100.HSI）—— 四个指数走**同一次请求**，
 * 避免腾讯 + 东财两套源拼数据（口径分裂，见 plugin.types.ts 的 app:market 设计说明）。
 */
const WIDGET_INDEX_SECIDS = ['1.000001', '0.399001', '0.399006', '100.HSI'] as const;

/**
 * 按传入 secids 精确查询 ulist 带最新价的轻量报价（全球指数 / 小组件大盘共用）
 * @param secids 东财 secid 序列（`1.000001` / `100.HSI` 形态）
 * @returns 报价列表（顺序与 secids 一致；上游 200 ≠ 有数据，diff 缺失返回空数组）
 */
const fetchUlistQuotes = async (secids: readonly string[]): Promise<GlobalIndexQuote[]> => {
  const query = [
    'fltt=2',
    `fields=${GLOBAL_INDEX_FIELDS}`,
    `secids=${secids.join(',')}`,
  ].join('&');
  const response = await proxyFetch(`${ULIST_URL_BASE}?${query}`);
  if (!response.ok) {
    throw new Error(`ulist 请求失败：HTTP ${response.status}`);
  }
  const body = (await response.json()) as EastmoneyUlistResponse;
  // ⚠️ 上游 200 ≠ 有数据：data/diff 缺失返回空数组而非抛错由卡片空态兜底
  return (body.data?.diff ?? []).map((raw) => ({
    name: raw.f14,
    code: raw.f12,
    price: typeof raw.f2 === 'number' ? raw.f2 : null,
    changePercent: typeof raw.f3 === 'number' ? raw.f3 : null,
  }));
};

/**
 * 拉取全球指数轻量报价（东财 push2delay ulist 精确 secid 查询，带最新价）
 *
 * 市场总览「全球指数」展开区数据源；腾讯行情源不覆盖日经 225 / KOSPI，
 * 故统一走东财（⚠️ 上游 200 ≠ 有数据，diff 缺失按空处理由上层展示空态）
 * @returns 全球指数报价列表（顺序与 secids 配置一致）
 */
export const fetchGlobalIndexQuotes = async (): Promise<GlobalIndexQuote[]> =>
  fetchUlistQuotes(PANORAMA_GLOBAL_INDEX_SECIDS);

/**
 * 拉取任务栏小组件「大盘走势」的指数轻量报价（东财 ulist 单次请求）
 *
 * 上证 / 深证 / 创业板指 / 恒生四个指数一次拿齐；仅小组件「大盘视图激活 && 气泡展开」
 * 期间以 30s 低频轮询（插件侧门控），不触犯「报价类请求别轮询」红线
 * @returns 指数报价列表（顺序 = WIDGET_INDEX_SECIDS 配置顺序，缺失条目不出现在结果里）
 */
export const fetchWidgetIndexQuotes = async (): Promise<GlobalIndexQuote[]> =>
  fetchUlistQuotes(WIDGET_INDEX_SECIDS);

/**
 * 拉取外盘商品全景（SDK 全球期货接口，futsseapi 源）
 * @returns 外盘期货列表（名称 + 涨跌幅，按涨跌幅降序）
 */
export const fetchGlobalFuturesPanorama = async (): Promise<PanoramaItem[]> => {
  const quotes = await sdk.futures.globalSpot({ pageSize: PANORAMA_CLIST_PAGE_SIZE });
  return quotes.map((quote) => ({
    name: quote.name,
    changePercent: quote.changePercent,
  }));
};

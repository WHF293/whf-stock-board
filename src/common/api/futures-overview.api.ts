import { proxyFetch } from './proxy-fetch.ts';
import {
  FUTURES_EM_MARKET_BY_PREFIX,
  FUTURES_EM_SNAPSHOT_HOSTS,
  FUTURES_OVERVIEW_API_BASE,
  FUTURES_OVERVIEW_CACHE_TTL_MS,
  FUTURES_RANK_API_BASE,
  FUTURES_RANK_BOARD_SIZE,
} from '../constants/futures.constants.ts';
import type {
  FuturesCapitalFlowItem,
  FuturesOverviewHome,
  FuturesPositionRateItem,
  FuturesRankBoards,
  FuturesRankContract,
  FuturesRankQuoteType,
  FuturesRankRow,
} from '../types/futures.types.ts';

/**
 * 期货总览数据接口层（同花顺期货通 futgwapi）
 *
 * 上游：`https://fupage.10jqka.com.cn/futgwapi/api/market/`（fupage 同源反代的
 * 行情网关，JSON，响应包一层 `{code:0, msg, data}`）。端点（2026-10-20 从
 * futures-frontend-marketoverview 前端包逆向核实）：
 * - `v2/home`：主力流况 + 资金流向四强四弱 + 多空比三强三弱（首页三模块一次拉齐）
 * - `v2/capital`：品种资金流向全列表（元）
 * - `v2/position`：主力持仓多空比全列表（longRate = 多单占比 %）
 * - `v1/trade/lastDate`：数据交易日（来源标注用）
 *
 * 盘中实时变化的数据，不做落库持久化，仅会话内存缓存（60 秒 TTL）防抖。
 */

/** 通用响应包装 */
interface FutgwResponse<T> {
  code: number;
  msg: string;
  data: T;
}

/** 会话缓存条目（各端点独立） */
const cache = new Map<string, { at: number; data: unknown }>();

/**
 * 拉取一个 futgwapi 端点（带会话缓存）
 * @param path 端点路径（如 `v2/home`）
 * @param forceRefresh 跳过缓存强制回源
 * @returns 响应 data 字段
 */
const fetchFutgw = async <T>(path: string, forceRefresh = false): Promise<T> => {
  const cached = cache.get(path);
  if (!forceRefresh && cached && Date.now() - cached.at < FUTURES_OVERVIEW_CACHE_TTL_MS) {
    return cached.data as T;
  }
  const response = await proxyFetch(`${FUTURES_OVERVIEW_API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`[futures-overview] ${path} HTTP ${response.status}`);
  }
  const body = (await response.json()) as FutgwResponse<T>;
  if (body.code !== 0) {
    throw new Error(`[futures-overview] ${path} ${body.msg || `code=${body.code}`}`);
  }
  cache.set(path, { at: Date.now(), data: body.data });
  return body.data;
};

/**
 * 期货市场总览（主力流况 + 资金流向预览 + 多空比预览）
 * @param forceRefresh 跳过缓存强制回源
 * @returns 三模块数据
 */
export const fetchFuturesOverviewHome = (forceRefresh = false): Promise<FuturesOverviewHome> =>
  fetchFutgw<FuturesOverviewHome>('v2/home', forceRefresh);

/**
 * 品种资金流向全列表（元，正 = 流入）
 * @param forceRefresh 跳过缓存强制回源
 * @returns 全品种资金净流向列表
 */
export const fetchFuturesCapitalFlows = (forceRefresh = false): Promise<FuturesCapitalFlowItem[]> =>
  fetchFutgw<FuturesCapitalFlowItem[]>('v2/capital', forceRefresh);

/**
 * 主力持仓多空比全列表（longRate = 多单占比 %）
 * @param forceRefresh 跳过缓存强制回源
 * @returns 全品种多空比列表
 */
export const fetchFuturesPositionRates = (forceRefresh = false): Promise<FuturesPositionRateItem[]> =>
  fetchFutgw<FuturesPositionRateItem[]>('v2/position', forceRefresh);

/**
 * 数据交易日（yyyy-MM-dd，来源标注用）
 * @param forceRefresh 跳过缓存强制回源
 * @returns 数据交易日
 */
export const fetchFuturesLastDate = (forceRefresh = false): Promise<string> =>
  fetchFutgw<string>('v1/trade/lastDate', forceRefresh);

/* -------------------- 主力合约四榜（涨幅 / 跌幅 / 成交额 / 日增仓） --------------------
 * 榜单合约清单来自同花顺期货通首页同款接口（ftapi futgwapi recommend_futures，
 * 每榜直接给定前 N 个合约）；行情快照来自东方财富 push2 ulist 批量接口
 * （f2 最新价 / f3 涨跌幅 / f6 成交额 / f163 日增仓，2026-10-20 逆向核实）。
 * 同花顺行情快照接口（quota-h multi_last_snapshot）需要设备级 license，无法裸调用，
 * 故快照换东财源；合约名沿用同花顺榜单的口径。
 */

/** EM ulist 快照字段 */
interface EmSnapshotRow {
  f2: number | string;
  f3: number | string;
  f6: number | string;
  f12: string;
  f13: number | string;
  f14: string;
  f163: number | string;
}

/** EM ulist 响应包装 */
interface EmUlistResponse {
  rc: number;
  data: { diff: EmSnapshotRow[] } | null;
}

/** recommend_futures 行 */
interface RecommendFuturesItem {
  market: string;
  contract_code: string;
  contract_name: string;
  expired_date: number;
}

/** 榜单类型清单（渲染与拉取顺序一致） */
export const FUTURES_RANK_QUOTE_TYPES: readonly FuturesRankQuoteType[] = [
  'rise_percent',
  'fall_percent',
  'turnover',
  'increase_position',
];

/**
 * 合约代码 → 东财 push2 secid（前缀映射，大小写敏感、最长前缀优先）
 * @param contractCode 合约代码（如 `au2612` / `IM2612`）
 * @returns secid（如 `113.au2612`）；未知品种返回 null
 */
export const resolveEmSecid = (contractCode: string): string | null => {
  let best: readonly [string, string] | null = null;
  for (const entry of FUTURES_EM_MARKET_BY_PREFIX) {
    if (contractCode.startsWith(entry[0]) && (best === null || entry[0].length > best[0].length)) {
      best = entry;
    }
  }
  return best ? `${best[1]}.${contractCode}` : null;
};

/**
 * 拉取一张榜单的合约清单（同花顺 recommend_futures）
 * @param quoteType 榜单类型
 * @returns 合约清单（按榜单序，截取展示条数）
 */
const fetchRankContracts = async (quoteType: FuturesRankQuoteType): Promise<FuturesRankContract[]> => {
  const url = `${FUTURES_RANK_API_BASE}?quote_type=${quoteType}&number=${FUTURES_RANK_BOARD_SIZE}`;
  const response = await proxyFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`[futures-rank] recommend_futures(${quoteType}) HTTP ${response.status}`);
  }
  const body = (await response.json()) as { code: number; data: RecommendFuturesItem[] };
  if (body.code !== 0 || !Array.isArray(body.data)) {
    throw new Error(`[futures-rank] recommend_futures(${quoteType}) 响应异常`);
  }
  return body.data.slice(0, FUTURES_RANK_BOARD_SIZE).map((item) => ({
    market: item.market,
    contractCode: item.contract_code,
    contractName: item.contract_name,
    expiredDate: item.expired_date,
  }));
};

/**
 * 批量拉取合约行情快照（东财 push2 ulist，一次请求全量合约；host 失败依次切镜像）
 * @param secids secid 列表（`<market>.<code>`）
 * @returns 以 secid 为键的快照表
 */
const fetchEmSnapshots = async (secids: string[]): Promise<Map<string, EmSnapshotRow>> => {
  const result = new Map<string, EmSnapshotRow>();
  if (secids.length === 0) return result;
  const query =
    `?fields=f2,f3,f6,f12,f13,f14,f163` +
    `&secids=${secids.join(',')}&invt=2&fltt=2&np=1`;
  let lastError: unknown = null;
  for (const host of FUTURES_EM_SNAPSHOT_HOSTS) {
    try {
      const response = await proxyFetch(`${host}/api/qt/ulist.np/get${query}`, {
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = (await response.json()) as EmUlistResponse;
      for (const row of body.data?.diff ?? []) {
        result.set(`${row.f13}.${row.f12}`, row);
      }
      return result;
    } catch (err) {
      lastError = err;
    }
  }
  // 原始错误（可能含完整 URL）只进控制台，对外抛简短文案供界面展示
  console.warn('[futures-overview] em ulist 全部镜像失败:', lastError);
  throw new Error('行情快照源均不可达（可能被限流或网络受限）');
};

/** 快照字段数值化（东财对缺失值返回字符串 '-'）
 * @param value 原始字段值
 * @returns 数值或 null
 */
const toNumber = (value: number | string | undefined): number | null =>
  typeof value === 'number' && Number.isFinite(value)
    ? value
    : typeof value === 'string' && value !== '-' && value.trim() !== ''
      ? Number(value)
      : null;

/**
 * 主力合约四榜（涨幅 / 跌幅 / 成交额 / 日增仓）
 * @param forceRefresh 跳过缓存强制回源
 * @returns 四张榜单（每榜截取展示条数）
 */
export const fetchFuturesRankBoards = async (forceRefresh = false): Promise<FuturesRankBoards> => {
  const cacheKey = 'rank-boards';
  const cached = cache.get(cacheKey);
  if (!forceRefresh && cached && Date.now() - cached.at < FUTURES_OVERVIEW_CACHE_TTL_MS) {
    return cached.data as FuturesRankBoards;
  }

  const contractLists = await Promise.all(FUTURES_RANK_QUOTE_TYPES.map((t) => fetchRankContracts(t)));

  // 全榜合约去重 → secid 映射（无法解析的合约丢弃，不影响其余行）
  const contracts = new Map<string, FuturesRankContract>();
  const secidByCode = new Map<string, string>();
  for (const list of contractLists) {
    for (const contract of list) {
      if (contracts.has(contract.contractCode)) continue;
      const secid = resolveEmSecid(contract.contractCode);
      if (!secid) continue;
      contracts.set(contract.contractCode, contract);
      secidByCode.set(contract.contractCode, secid);
    }
  }
  const snapshots = await fetchEmSnapshots([...secidByCode.values()]);

  const mergeRow = (contract: FuturesRankContract): FuturesRankRow => {
    const snap = snapshots.get(secidByCode.get(contract.contractCode) ?? '');
    return {
      contract,
      lastPrice: toNumber(snap?.f2),
      changePercent: toNumber(snap?.f3),
      turnover: toNumber(snap?.f6),
      oiChange: toNumber(snap?.f163),
    };
  };

  const boards = Object.fromEntries(
    FUTURES_RANK_QUOTE_TYPES.map((t, i) => [t, contractLists[i].filter((c) => secidByCode.has(c.contractCode)).map(mergeRow)]),
  ) as FuturesRankBoards;

  cache.set(cacheKey, { at: Date.now(), data: boards });
  return boards;
};

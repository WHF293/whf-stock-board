import {
  BOARD_CALENDAR_URL,
  TENCENT_REFERER,
} from '../constants/board-calendar.constants';
import {
  BOARD_DETAIL_CONCURRENCY,
  BOARD_DETAIL_FETCH_BARS,
  BOARD_DETAIL_MAX_CONSTITUENTS,
  BOARD_DETAIL_SERIES_TTL_MS,
} from '../constants/board-detail.constants';
import type { BoardConstituent } from '../types/board-calendar.types';
import type {
  BoardDetailLoadResult,
  BoardDetailRow,
  DailyCloseBar,
} from '../types/board-detail.types';
import { calcWindowChangePercents } from '../utils/calc-window-change-percents';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { normalizeAShareCode } from '../utils/normalize-a-share-code';
import { fetchBoardConstituents, getLocalDateString } from './board-calendar.api';
import { listConstituentsByBoard } from './board-calendar-db.api';
import { proxyFetch } from './proxy-fetch';

/**
 * 板块日历详情页取数（板块成分股 × 交易日 涨跌幅矩阵）
 *
 * 数据链路：
 * 1. **行** = 板块成分股：本地库 `board_constituent`（桌面端，随采集周期 7 天同步一次）
 *    → 库内为空（浏览器端 / 首次安装）时回退东财实时成分；
 * 2. **格** = 该股该交易日的涨跌幅：腾讯**前复权**日 K 的相邻收盘比。
 *
 * 为什么逐票取数而不是批量：腾讯 `newfqkline` 不支持多标的（实测 `param=a;b` 报
 * 「param error」、重复 `param=` 只有最后一个生效），东财行情域本机被封、
 * `push2delay` 又不提供历史 K 线 —— 没有可用的批量历史通道。
 * 因此本模块的成本就是「成分股数」个请求（20 ~ 500），全部优化都围绕
 * 「同一会话内绝不重复请求同一只票」展开（内存序列缓存 + 在途请求去重）。
 *
 * 口径：前复权相邻收盘比 == 交易所涨跌幅（除权日不失真）。用新浪日 K 会失真——
 * 新浪不复权，10 送 10 那天相邻收盘比会算出 -50% 的假涨跌幅。
 *
 * 本文件只负责「上游 → 归一化类型」，缓存与业务排序分别在上层（内存缓存 / utils）。
 */

/** 腾讯日 K 响应体（`data` 以请求的完整符号为键） */
interface TencentKlineResponse {
  data?: Record<string, { qfqday?: string[][]; day?: string[][] }>;
}

/**
 * 拉取单票前复权日 K（升序）
 *
 * ⚠️ 行结构 `[日期, 开, 收, 高, 低, 成交量(手), {}, ?, 成交额(万元), …]`：
 * 收盘是**下标 2**（不是 1），与成交量模块取值位置不同，别按「开收高低」以外的顺序猜。
 * @param fullSymbol 完整符号（`sh600519` 形态）
 * @param barLimit 请求根数
 * @returns 日 K 收盘序列（升序）；该标的无数据时为空数组
 * @throws Error 上游 HTTP 非 2xx 时抛出
 */
const fetchTencentDailyBars = async (
  fullSymbol: string,
  barLimit: number,
): Promise<DailyCloseBar[]> => {
  const url = `${BOARD_CALENDAR_URL.TENCENT_KLINE}?param=${fullSymbol},day,,,${barLimit},qfq`;
  const response = await proxyFetch(url, { headers: { Referer: TENCENT_REFERER } });
  if (!response.ok) {
    throw new Error(`腾讯日K HTTP ${response.status}`);
  }
  const body = (await response.json()) as TencentKlineResponse;
  const entry = body.data?.[fullSymbol];
  // qfqday 为空时回退 day（极少数标的没有复权序列，不复权也比整格空白强）
  const rows = entry?.qfqday ?? entry?.day ?? [];
  const bars: DailyCloseBar[] = [];
  for (const row of rows) {
    const tradeDate = row[0];
    const close = Number(row[2]);
    if (typeof tradeDate === 'string' && tradeDate.length === 10 && Number.isFinite(close) && close > 0) {
      bars.push({ tradeDate, close });
    }
  }
  return bars;
};

/** 单票日 K 的内存缓存项 */
interface SeriesCacheEntry {
  /** 日 K 收盘序列（升序） */
  bars: DailyCloseBar[];
  /** 取数时刻（毫秒） */
  fetchedAt: number;
  /** 序列末位交易日（判缓存是否覆盖到窗口最新一天） */
  lastDate: string;
}

/**
 * 会话级序列缓存（key = 完整符号）
 *
 * 为什么不做持久化：今天这一列的涨跌幅盘中一直变，落库就得带「是否已收盘」的状态，
 * 而收盘前的每次访问仍要重取一遍全部成分股 —— 持久化只在「看纯历史窗口」时省请求，
 * 收益与新增一张表 + 一次迁移的风险不成正比。会话内缓存 + 在途去重已覆盖
 * 「切板块 / 切范围 / 重复进出本页」三类重复请求。
 */
const seriesMemo = new Map<string, SeriesCacheEntry>();

/** 在途请求（同一只票被并发请求时复用同一个 Promise，避免重复打上游） */
const inFlight = new Map<string, Promise<DailyCloseBar[]>>();

/**
 * 缓存是否仍可用
 *
 * 三条规则按代价从低到高短路：
 * 1. 无缓存 → 不可用；
 * 2. 序列末位早于窗口最新交易日 → 缓存没覆盖到最新一天（跨日 / 盘中新增 bar），必须重取；
 * 3. 序列末位早于今天（收盘后、周末、纯历史窗口）→ 序列不再变化，当天一直有效；
 *    否则（含今天的盘中窗口）按 TTL 复用。
 * @param cached 缓存项
 * @param latestDate 窗口最新交易日
 * @returns true 表示可复用
 */
const isSeriesUsable = (cached: SeriesCacheEntry | undefined, latestDate: string): boolean => {
  if (cached === undefined || cached.bars.length === 0) return false;
  if (cached.lastDate < latestDate) return false;
  if (cached.lastDate < getLocalDateString()) return true;
  return Date.now() - cached.fetchedAt < BOARD_DETAIL_SERIES_TTL_MS;
};

/**
 * 取单票日 K（命中缓存或复用在途请求时零请求）
 * @param fullSymbol 完整符号
 * @param latestDate 窗口最新交易日
 * @returns 日 K 收盘序列（升序）
 * @throws Error 上游请求失败时抛出（由调用方按「该票取数失败」处理）
 */
const getDailyBars = async (
  fullSymbol: string,
  latestDate: string,
): Promise<DailyCloseBar[]> => {
  const cached = seriesMemo.get(fullSymbol);
  if (cached !== undefined && isSeriesUsable(cached, latestDate)) {
    return cached.bars;
  }
  const running = inFlight.get(fullSymbol);
  if (running !== undefined) {
    return running;
  }
  const task = fetchTencentDailyBars(fullSymbol, BOARD_DETAIL_FETCH_BARS)
    .then((bars) => {
      if (bars.length > 0) {
        seriesMemo.set(fullSymbol, {
          bars,
          fetchedAt: Date.now(),
          lastDate: bars[bars.length - 1].tradeDate,
        });
      }
      return bars;
    })
    .finally(() => {
      inFlight.delete(fullSymbol);
    });
  inFlight.set(fullSymbol, task);
  return task;
};

/** 详情页取数选项 */
export interface LoadBoardDetailOptions {
  /** 板块代码（BKxxxx） */
  boardCode: string;
  /** 需要在矩阵中取值的交易日（**降序**，最近的在最前） */
  dates: string[];
  /** 进度回调（每完成一只票一次） */
  onProgress?: (completed: number, total: number) => void;
  /** 中断信号（切板块 / 换范围时取消上一轮） */
  signal?: AbortSignal;
}

/**
 * 读取某板块的成分股清单（本地库优先，空则回退东财实时成分）
 * @param boardCode 板块代码
 * @returns 成分股与来源标记
 * @throws Error 本地库与上游都拿不到成分股时抛出
 */
const loadConstituents = async (
  boardCode: string,
): Promise<{ items: BoardConstituent[]; source: 'db' | 'upstream' }> => {
  const local = await listConstituentsByBoard(boardCode);
  if (local.length > 0) {
    return { items: local, source: 'db' };
  }
  const upstream = await fetchBoardConstituents(boardCode);
  return {
    items: upstream.map((item) => ({
      boardCode,
      symbol: item.symbol,
      stockName: item.name,
      market: item.market,
    })),
    source: 'upstream',
  };
};

/**
 * 加载「板块成分股 × 交易日」涨跌幅矩阵的原始行
 *
 * 单票取数失败（无行情 / 请求报错）只计入 `failed` 并跳过该票，不中断整页 ——
 * 500 只票里有一只停牌或上游抽风，不该让整个板块打不开。
 * 返回值为**未排序**行（排序口径属于视图层，见 `sortBoardDetailRows`）。
 * @param options 板块代码 / 交易日窗口 / 进度与中断
 * @returns 矩阵行、成分股总数、失败票数与成分股来源
 * @throws Error 成分股取不到、或取数被 abort 时抛出（后者见 isAnalysisAborted）
 */
export const loadBoardDetailMatrix = async (
  options: LoadBoardDetailOptions,
): Promise<BoardDetailLoadResult> => {
  const { boardCode, dates } = options;
  if (dates.length === 0) {
    return { rows: [], total: 0, failed: 0, source: 'db' };
  }
  const latestDate = dates[0];
  const { items, source } = await loadConstituents(boardCode);
  const targets = items.slice(0, BOARD_DETAIL_MAX_CONSTITUENTS);

  let failed = 0;
  const loaded = await mapWithConcurrency(
    targets,
    async (item): Promise<BoardDetailRow | null> => {
      const fullSymbol = normalizeAShareCode(item.symbol);
      try {
        const bars = await getDailyBars(fullSymbol, latestDate);
        if (bars.length === 0) {
          failed += 1;
          return null;
        }
        const { cells, cumulative } = calcWindowChangePercents(bars, dates);
        const firstFilled = cells.findIndex((value) => value !== null);
        return {
          symbol: item.symbol,
          fullSymbol,
          name: item.stockName,
          cells,
          cumulative,
          latest: firstFilled === -1 ? null : cells[firstFilled],
        };
      } catch (error) {
        failed += 1;
        console.warn(`[board-detail] ${item.symbol} 日K取数失败，该票跳过`, error);
        return null;
      }
    },
    {
      concurrency: BOARD_DETAIL_CONCURRENCY,
      signal: options.signal,
      onProgress: options.onProgress,
    },
  );

  return {
    rows: loaded.filter((row): row is BoardDetailRow => row !== null),
    total: targets.length,
    failed,
    source,
  };
};

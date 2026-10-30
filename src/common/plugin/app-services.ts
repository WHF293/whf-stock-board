/**
 * 宿主公开服务的实现体 · common 层可复用的工厂
 *
 * `app:format` / `app:market` / `app:polling` / `app:market-data` / `app:watchlist`
 * 只依赖 common 层的 api / composables / constants / utils / stores，与端无关，
 * 因此实现放在这里，供 PC 与移动端的插件装配层共用（PC 侧 `pc/plugin/app-services.ts`
 * re-export 这些工厂，保持既有 import 不变）。改动要同步 PLUGIN_API.md / PLUGIN_WIKI.md
 * 的服务清单（AGENTS.md §12 的同步义务）。
 */
import { fetchZtPool } from '../api/event.api.ts';
import { fetchIndustryBoards } from '../api/board.api.ts';
import { fetchMarketTurnover } from '../api/turnover.api.ts';
import { fetchWidgetIndexQuotes } from '../api/panorama.api.ts';
import { fetchThsTurnoverDay, fetchThsTurnoverMinute } from '../api/ths-market-analysis.api.ts';
import {
  fetchClsHotList,
  fetchEastmoneyHotNews,
  fetchSinaHotNews,
  fetchThepaperHotNews,
  fetchThsHotNews,
  fetchTdxHotNews,
} from '../api/news.api.ts';
import { fetchHotBoard } from '../api/hot-board.api.ts';
import { createPollingScheduler } from '../composables/polling-scheduler';
import { useWatchlistStore } from '../stores/watchlist';
import { NUMBER_PLACEHOLDER } from '../constants/format.constants.ts';
import {
  MARKET_BOARD_SOURCE_GROUP,
} from '../constants/market-data.constants.ts';
import {
  getTrendByChangePercent,
  TREND,
} from '../constants/trend.constants.ts';
import {
  TREND_PILL_CLASS,
  TREND_TEXT_CLASS,
} from '../constants/stock-colors.constants.ts';
import { delay } from '../utils/delay';
import { computeTurnoverAverage5 } from '../utils/compute-turnover-averages';
import { findQuoteBySymbol } from '../utils/find-quote-by-symbol';
import { formatPercent, formatPercentUnsigned } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import { formatRelativeTime } from '../utils/format-relative-time';
import { normalizeAShareCode } from '../utils/normalize-a-share-code';
import { toBareCode } from '../utils/to-bare-code';
import { toFullSymbol } from '../utils/to-full-symbol';
import type { Trend } from '../constants/trend.constants.ts';
import type { Pinia } from 'pinia';
import type {
  FormatService,
  IndustryBoardSnapshot,
  LimitUpPoolMember,
  MarketDataService,
  MarketService,
  PollingService,
  WatchlistService,
} from '../types/plugin.types.ts';
import type {
  MarketBoardRow,
  MarketNewsHeadline,
  MarketNewsSource,
  MarketTurnoverSnapshot,
} from '../types/market-data.types.ts';

/**
 * `app:format` 的实现
 *
 * 全部转发到宿主自己的工具函数 / 常量 —— 插件看到的口径与原生页面完全一致，
 * 这些工具将来改版本或修 bug，插件自动跟随，不需要重新打包。
 * @returns 格式化服务
 */
export const createFormatService = (): FormatService => ({
  placeholder: NUMBER_PLACEHOLDER,
  trend: (changePercent: number | null | undefined): Trend =>
    getTrendByChangePercent(changePercent ?? 0),
  trendClass: (trend: Trend): string => TREND_TEXT_CLASS[trend] ?? TREND_TEXT_CLASS[TREND.FLAT],
  trendPillClass: (trend: Trend): string => TREND_PILL_CLASS[trend] ?? TREND_PILL_CLASS[TREND.FLAT],
  percent: formatPercent,
  percentUnsigned: formatPercentUnsigned,
  price: formatPrice,
  relativeTime: formatRelativeTime,
  delay,
  debounce: <T extends unknown[]>(
    fn: (...args: T) => void,
    wait: number,
  ): ((...args: T) => void) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    return (...args: T): void => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        fn(...args);
      }, wait);
    };
  },
  toFullSymbol,
  toBareCode,
  normalizeCode: normalizeAShareCode,
  findQuote: findQuoteBySymbol,
});

/**
 * `app:market` 的实现
 *
 * 涨停池与行业板块都做了**显式字段映射**（而不是原样透传上游类型）：
 * 上游字段名与口径随版本变化，这里只承诺契约类型里声明的那些，
 * 插件拿到的结构因此长期稳定。
 * @returns 市场剖面服务
 */
export const createMarketService = (): MarketService => ({
  fetchMarketTurnover: async () => fetchMarketTurnover(),
  fetchIndustryBoards: async (): Promise<IndustryBoardSnapshot[]> => {
    const boards = await fetchIndustryBoards();
    return boards.map((board) => ({
      code: board.code,
      name: board.name,
      changePercent: board.changePercent,
      totalMarketCap: board.totalMarketCap,
    }));
  },
  fetchLimitUpPool: async (date?: string): Promise<LimitUpPoolMember[]> => {
    const items = await fetchZtPool('zt', date);
    return items.map((item) => ({
      code: item.code,
      name: item.name,
      price: item.price,
      changePercent: item.changePercent,
      continuousBoardCount: item.continuousBoardCount,
      boardAmount: item.boardAmount,
      industry: item.industry,
    }));
  },
  fetchIndexQuotes: async () => {
    const quotes = await fetchWidgetIndexQuotes();
    return quotes.map((quote) => ({
      code: quote.code,
      name: quote.name,
      price: quote.price,
      changePercent: quote.changePercent,
    }));
  },
});

/**
 * `app:polling` 的实现
 *
 * 直接把 `createPollingScheduler` 交出去：交易窗口 / 失败退避 / 可见性 / 总开关
 * 四份策略写在这一处，插件自备 `setInterval` 只会多一份容易写岔的副本。
 * @returns 轮询调度服务
 */
export const createPollingService = (): PollingService => ({
  create: createPollingScheduler,
});

/** 新闻标题行单源条数上限（气泡单行展示口径，足够滚动一屏，避免整页大载荷） */
const MARKET_NEWS_HEADLINE_LIMIT = 20;

/**
 * `app:market-data` 的实现
 *
 * 三个方法都是「宿主已有取数代码 + 显式字段映射」：上游类型不进契约，
 * 插件与气泡渲染端拿到的结构长期稳定。任一上游失败直接抛错，由调用方
 * （小组件的轮询引擎）决定保留旧快照还是展示空态。
 * @returns 市场资讯数据服务
 */
export const createMarketDataService = (): MarketDataService => ({
  fetchRealtimeTurnover: async (): Promise<MarketTurnoverSnapshot> => {
    const [minute, day] = await Promise.all([fetchThsTurnoverMinute(), fetchThsTurnoverDay()]);
    return {
      turnover: minute.turnover,
      turnoverChange: minute.turnoverChange,
      predictTurnover: minute.predictTurnover,
      averageTurnover: day.averageTurnover,
      averageTurnover5: computeTurnoverAverage5(day.points),
      points: minute.points.map((point) => ({
        turnover: point.turnover,
        pre: point.pre,
      })),
    };
  },
  fetchHotNews: async (source: MarketNewsSource): Promise<MarketNewsHeadline[]> => {
    let items: { url: string; title: string; ctime: string }[];
    switch (source) {
      case 'sina':
        items = await fetchSinaHotNews(1, MARKET_NEWS_HEADLINE_LIMIT);
        break;
      case 'eastmoney':
        items = (await fetchEastmoneyHotNews('', MARKET_NEWS_HEADLINE_LIMIT)).items;
        break;
      case 'ths':
        items = await fetchThsHotNews(1, MARKET_NEWS_HEADLINE_LIMIT);
        break;
      case 'thepaper':
        items = (await fetchThepaperHotNews('', MARKET_NEWS_HEADLINE_LIMIT)).items;
        break;
      case 'cls':
        items = await fetchClsHotList(MARKET_NEWS_HEADLINE_LIMIT);
        break;
      case 'tdx':
        items = await fetchTdxHotNews('yw', MARKET_NEWS_HEADLINE_LIMIT);
        break;
    }
    return items.map((item) => ({ url: item.url, title: item.title, ctime: item.ctime }));
  },
  fetchHotBoard: async (source): Promise<MarketBoardRow[]> => {
    const items = await fetchHotBoard(source, MARKET_BOARD_SOURCE_GROUP[source]);
    return items.map((item) => ({
      symbol: item.symbol,
      name: item.name,
      price: item.price,
      changePct: item.changePct,
      heatLabel: item.heatLabel,
    }));
  },
});

/**
 * `app:watchlist` 的实现（只读）
 *
 * 三个成员都是 getter 而不是快照：直接读 pinia state，
 * 因此在插件自己的 `computed` / `watch` 里调用能正常收集响应式依赖
 * （盯盘插件的「候选 ∩ 自选股」就是靠这条实现自选股增删后自动跟随）。
 * PC 与移动端共用同一份自选存储（`stores/watchlist`），因此两端同源。
 * @param pinia 应用 pinia 实例（缺省时用当前活动实例）
 * @returns 自选股只读服务
 */
export const createWatchlistService = (pinia?: Pinia): WatchlistService => {
  const store = pinia ? useWatchlistStore(pinia) : useWatchlistStore();
  return {
    symbols: () => store.allSymbols,
    groups: () => store.groups.map((group) => ({
      id: group.id,
      name: group.name,
      stocks: group.stocks.map((stock) => ({ symbol: stock.symbol, name: stock.name })),
    })),
    nameOf: (symbol) => {
      for (const group of store.groups) {
        const found = group.stocks.find((stock) => stock.symbol === symbol);
        if (found) return found.name;
      }
      return undefined;
    },
  };
};

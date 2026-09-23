/**
 * 宿主公开服务的实现体（`AppServiceMap` 里由宿主自己填的那些条目）
 *
 * 为什么要单独一个文件：`setup.ts` 只做「装配」，不该掺杂业务口径。
 * 这里放的都是**宿主正在用、且第三方同样需要**的能力，改动要同步
 * PLUGIN_API.md / PLUGIN_WIKI.md 的服务清单（AGENTS.md §12 的同步义务）。
 */
import { fetchZtPool } from '../api/event.api';
import { fetchIndustryBoards } from '../api/board.api';
import { fetchMarketTurnover } from '../api/turnover.api';
import { fetchWidgetIndexQuotes } from '../api/panorama.api';
import { createPollingScheduler } from '../composables/polling-scheduler';
import { NUMBER_PLACEHOLDER } from '../constants/format.constants';
import { ROUTE_PATH } from '../constants/router-meta.constants';
import {
  getTrendByChangePercent,
  TREND,
} from '../constants/trend.constants';
import {
  TREND_PILL_CLASS,
  TREND_TEXT_CLASS,
} from '../constants/stock-colors.constants';
import { delay } from '../utils/delay';
import { findQuoteBySymbol } from '../utils/find-quote-by-symbol';
import { formatPercent, formatPercentUnsigned } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import { formatRelativeTime } from '../utils/format-relative-time';
import { normalizeAShareCode } from '../utils/normalize-a-share-code';
import { toBareCode } from '../utils/to-bare-code';
import { toFullSymbol } from '../utils/to-full-symbol';
import { trackAction } from '../weblog/weblogActions';
import { useDockPanelStore } from '../stores/dock-panel';
import { useStockContextStore } from '../stores/stock-context';
import { useWatchlistStore } from '../stores/watchlist';
import type { Trend } from '../constants/trend.constants';
import type { ContextStock } from '../stores/stock-context';
import type { Pinia } from 'pinia';
import type {
  FormatService,
  IndustryBoardSnapshot,
  LimitUpPoolMember,
  MarketService,
  PollingService,
  StockContextItem,
  StockOpenService,
  WatchlistService,
} from '../types/plugin.types';

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
 * `app:stock-open` 的实现
 *
 * 与宿主组件侧的 `useStockOpen()` 共用这一份逻辑（后者把 router 包成 `navigate` 后
 * 委托到这里）——「打开个股」的两条交互一旦有两份实现，差别一定出现在
 * 「详情页左侧来源列表对不对」这种只有长期用才会发现的地方。
 * @param navigate 路由跳转（宿主 `router.push`；插件体系里统一由 `app:navigate` 提供）
 * @param pinia 应用 pinia 实例（缺省时用当前活动实例）
 * @returns 个股打开服务
 */
export const createStockOpenService = (
  navigate: (path: string) => void,
  pinia?: Pinia,
): StockOpenService => {
  const dockPanel = pinia ? useDockPanelStore(pinia) : useDockPanelStore();
  const stockContext = pinia ? useStockContextStore(pinia) : useStockContextStore();

  /**
   * 契约层列表 → 宿主上下文列表（符号一律归一化，详情页高亮匹配就靠它）
   * @param list 来源列表
   * @returns 上下文股票列表
   */
  const toContext = (list?: readonly StockContextItem[]): ContextStock[] =>
    (list ?? []).map((item) => ({
      symbol: normalizeAShareCode(item.symbol),
      name: item.name ?? '',
      price: item.price ?? null,
      changePercent: item.changePercent ?? null,
    }));

  return {
    openSidebar: (symbol, list): void => {
      const context = toContext(list);
      if (context.length > 0) {
        stockContext.setContext(context);
      }
      trackAction('STOCK_OPEN_SIDEBAR', { target: symbol });
      dockPanel.openStock(symbol);
    },
    openPage: (symbol, list): void => {
      const context = toContext(list);
      // 不给来源列表时写入仅当前一只：否则详情页左侧会残留上一批股票
      stockContext.setContext(
        context.length > 0
          ? context
          : [{
            symbol: normalizeAShareCode(symbol),
            name: '',
            price: null,
            changePercent: null,
          }],
      );
      trackAction('STOCK_OPEN_PAGE', { target: symbol });
      dockPanel.close();
      navigate(`${ROUTE_PATH.STOCK_DETAIL}/${symbol}`);
    },
  };
};

/**
 * `app:watchlist` 的实现（只读）
 *
 * 三个成员都是 getter 而不是快照：直接读 pinia state，
 * 因此在插件自己的 `computed` / `watch` 里调用能正常收集响应式依赖
 * （盯盘插件的「候选 ∩ 自选股」就是靠这条实现自选股增删后自动跟随）。
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

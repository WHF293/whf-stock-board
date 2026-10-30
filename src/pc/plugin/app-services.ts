/**
 * 宿主公开服务的实现体（`AppServiceMap` 里由宿主自己填的那些条目）
 *
 * 为什么要单独一个文件：`setup.ts` 只做「装配」，不该掺杂业务口径。
 * 这里放的都是**宿主正在用、且第三方同样需要**的能力，改动要同步
 * PLUGIN_API.md / PLUGIN_WIKI.md 的服务清单（AGENTS.md §12 的同步义务）。
 *
 * 纯 common 层可复用的五个工厂（format / market / polling / market-data / watchlist）
 * 已下沉到 `common/plugin/app-services.ts`，这里 re-export 保持装配层 import 不变；
 * 依赖 PC 专属能力（停靠面板 / 股票上下文 / weblog）的 stock-open 留在本文件。
 */
export {
  createFormatService,
  createMarketService,
  createPollingService,
  createMarketDataService,
  createWatchlistService,
} from '../../common/plugin/app-services';
import { normalizeAShareCode } from '../../common/utils/normalize-a-share-code';
import { ROUTE_PATH } from '../../common/constants/router-meta.constants.ts';
import { trackAction } from '../weblog/weblogActions';
import { useDockPanelStore } from '../../common/stores/dock-panel';
import { useStockContextStore } from '../../common/stores/stock-context';
import type { Pinia } from 'pinia';
import type { ContextStock } from '../../common/stores/stock-context';
import type {
  StockContextItem,
  StockOpenService,
} from '../../common/types/plugin.types.ts';

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

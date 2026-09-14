import { useRouter } from 'vue-router';
import { useDockPanelStore } from '../stores/dock-panel';
import { useStockContextStore, type ContextStock } from '../stores/stock-context';
import { ROUTE_PATH } from '../constants/router-meta.constants';
import { normalizeAShareCode } from '../utils/normalize-a-share-code';

/**
 * 全站统一的个股打开交互：
 *
 * - 单击 -> 展开右侧个股详情侧栏（可携带来源列表，供侧栏跳详情页时复用）
 * - 双击 -> 关闭侧栏并跳转股票详情整页（跳转前写入来源列表，
 *   详情页左侧列表即可一键切换同批股票）
 *
 * 配合 BaseTable 的 enableDblclickNav（单击延迟合并）或原生 dblclick 使用
 * @returns openSidebar 单击开侧栏；openPage 双击跳详情页；toContextList 行数组映射
 */
export const useStockOpen = () => {
  const dockPanel = useDockPanelStore();
  const stockContext = useStockContextStore();
  const router = useRouter();

  /**
   * 单击：打开个股详情侧栏（携带 list 时同步写入上下文，
   * 供侧栏「打开详情页」按钮跳转后展示来源列表）
   * @param symbol 个股符号
   * @param list 来源股票列表（如全局搜索结果；可不传）
   */
  const openSidebar = (symbol: string, list?: ContextStock[]): void => {
    if (list && list.length > 0) {
      stockContext.setContext(list);
    }
    dockPanel.openStock(symbol);
  };

  /**
   * 双击：关闭侧栏并进入股票详情整页
   * @param symbol 个股符号
   * @param list 来源股票列表；不传时写入仅当前一只（避免残留上一批列表）
   */
  const openPage = (symbol: string, list?: ContextStock[]): void => {
    stockContext.setContext(
      list && list.length > 0 ? list : [{ symbol: normalizeAShareCode(symbol), name: '', price: null, changePercent: null }],
    );
    dockPanel.close();
    void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${symbol}`);
  };

  /**
   * 把表格行数组映射为详情页上下文列表
   *
   * symbol 经 normalizeAShareCode 归一化为完整符号（与详情页路由符号同形态，
   * 保证当前股高亮可匹配）；name / price / changePercent 取同名可选字段，
   * 字段名不同（如龙虎榜的 close）时用 pickPrice 指定。
   * @param rows 表格行数组
   * @param pickSymbol 行 -> 个股代码/符号
   * @param pickPrice 行 -> 现价（可选，默认取 row.price）
   * @returns 上下文股票列表
   */
  const toContextList = <T>(
    rows: readonly T[],
    pickSymbol: (row: T) => string,
    pickPrice?: (row: T) => number | null,
  ): ContextStock[] =>
    rows.map((row) => ({
      symbol: normalizeAShareCode(pickSymbol(row)),
      name: (row as { name?: string }).name ?? '',
      price: pickPrice
        ? pickPrice(row)
        : ((row as { price?: number | null }).price ?? null),
      changePercent: (row as { changePercent?: number | null }).changePercent ?? null,
    }));

  return { openSidebar, openPage, toContextList };
};

import { useRouter } from 'vue-router';
import { createStockOpenService } from '../plugin/app-services';
import { normalizeAShareCode } from '../utils/normalize-a-share-code';
import type { ContextStock } from '../stores/stock-context';

/**
 * 全站统一的个股打开交互：
 *
 * - 单击 -> 展开右侧个股详情侧栏（可携带来源列表，供侧栏跳详情页时复用）
 * - 双击 -> 关闭侧栏并跳转股票详情整页（跳转前写入来源列表，
 *   详情页左侧列表即可一键切换同批股票）
 *
 * 配合 BaseTable 的 enableDblclickNav（单击延迟合并）或原生 dblclick 使用
 *
 * 真正的实现在 `createStockOpenService`（`plugin/app-services.ts`）——
 * 同一份行为还要经 `app:stock-open` 服务交给插件，两边不能各写一套：
 * 差异只会体现在「详情页左侧来源列表对不对」这种长期用才看得出的地方。
 * @returns openSidebar 单击开侧栏；openPage 双击跳详情页；toContextList 行数组映射
 */
export const useStockOpen = () => {
  const router = useRouter();
  const service = createStockOpenService((path) => {
    void router.push(path);
  });

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

  return {
    openSidebar: service.openSidebar,
    openPage: service.openPage,
    toContextList,
  };
};

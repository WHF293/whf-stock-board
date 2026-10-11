/**
 * 板块热力图常量集中管理
 */

/** 下钻成分股视图展示的个股数量（按成交额取 Top N） */
export const HEATMAP_DRILL_STOCK_COUNT = 30;

/** 板块热力展示形式（禁 enum：const 对象 + types/heatmap.types.ts 派生类型） */
export const HEATMAP_VIEW_MODE = {
  HEATMAP: 'heatmap',
  LIST: 'list',
} as const;

/** 展示形式默认值 */
export const HEATMAP_VIEW_MODE_DEFAULT = HEATMAP_VIEW_MODE.HEATMAP;

/** 展示形式切换按钮组选项（与 BaseTabs 配套：value 为字符串） */
export const HEATMAP_VIEW_MODE_OPTIONS = [
  { label: '热力图', value: HEATMAP_VIEW_MODE.HEATMAP },
  { label: '列表', value: HEATMAP_VIEW_MODE.LIST },
] as const;

/** Top 数量按钮组选项（与 BaseTabs 配套：value 为字符串，绑定时转 number） */
export const HEATMAP_TOP_TAB_OPTIONS = [
  { label: 'Top10', value: '10' },
  { label: 'Top20', value: '20' },
  { label: 'Top30', value: '30' },
  { label: 'Top50', value: '50' },
] as const;

/** 热力图 / 列表两种展示形式的统一高度（像素）：切换展示形式时避免卡片高度跳动 */
export const HEATMAP_VIEW_HEIGHT_PX = 400;

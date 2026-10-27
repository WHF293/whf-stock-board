/**
 * 盘面雷达常量（平铺看板）
 */

/** 平铺看板：报价排序类页签（涨幅 / 跌幅 / 成交额 / 换手率）每列展示条数 */
export const TILED_QUOTE_RANK_COUNT = 20;

/** 平铺看板：股池 / 明细类榜单每列最大展示条数（对上游克制的只读视图） */
export const TILED_LIST_MAX_COUNT = 50;

/** 平铺看板：龙虎榜涨 / 跌方向筛选选项（与龙虎榜页签同口径） */
export const TILED_DRAGON_DIRECTION_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '涨', value: 'up' },
  { label: '跌', value: 'down' },
] as const;

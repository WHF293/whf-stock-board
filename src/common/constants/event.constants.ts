import type { ZTPoolType } from 'stock-sdk';

/**
 * 涨停与异动常量
 */

/**
 * 涨停股池类型选项（value 必须为 SDK ZTPoolType 成员）
 */
export const ZT_POOL_OPTIONS = [
  { label: '涨停池', value: 'zt' },
  { label: '昨日涨停', value: 'yesterday' },
  { label: '强势股', value: 'strong' },
  { label: '次新股', value: 'sub_new' },
  { label: '炸板股', value: 'broken' },
  { label: '跌停池', value: 'dt' },
] as const satisfies readonly { label: string; value: ZTPoolType }[];

/** 默认展示的股池类型 */
export const ZT_POOL_DEFAULT = 'zt';

/** 盘口异动时间轴最大展示条数（上游滚动列表可能很长） */
export const STOCK_CHANGE_MAX_ITEMS = 50;

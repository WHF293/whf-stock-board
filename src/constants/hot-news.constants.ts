/**
 * 热点新闻 - 源 / 通道的共享定义
 *
 * 「同花顺热点主题」卡片内含三条取数通道（热点主题 / 快讯 / 头条），
 * 卡片本体与它的放大弹窗都要渲染这套切换控件，故定义抽到本文件共享
 * （`<script setup>` 内不能 export，SFC 之间无法互相导入类型与常量）
 */

/**
 * 同花顺卡片的子视图
 *
 * 历史上三者是三张独立卡片（同花顺 / 同花顺头条 / 同花顺热点主题），
 * 合并成一张卡片后仍各占一条独立取数通道，只是共用同一张卡片外壳
 */
export type ThsSubView = 'theme' | 'flash' | 'headline';

/** 子视图渲染顺序（首个为默认选中项） */
export const THS_SUB_VIEWS: readonly ThsSubView[] = [
  'theme',
  'flash',
  'headline',
];

/** 子视图展示名（切换控件文案） */
export const THS_SUB_VIEW_LABELS: Record<ThsSubView, string> = {
  theme: '热点主题',
  flash: '快讯',
  headline: '头条',
};

/** 切换控件的通用选项形态（子视图值 + 展示名） */
export interface HotNewsViewOption {
  value: string;
  label: string;
}

/**
 * 由子视图枚举 + 展示名表构造选项列表
 * @param views 子视图值列表（渲染顺序）
 * @param labels 展示名表
 * @returns 切换控件选项列表
 */
const toViewOptions = <T extends string>(
  views: readonly T[],
  labels: Record<T, string>,
): HotNewsViewOption[] => views.map((value) => ({ value, label: labels[value] }));

/** 同花顺卡片子视图选项（切换控件直接消费） */
export const THS_SUB_VIEW_OPTIONS: readonly HotNewsViewOption[] = toViewOptions(
  THS_SUB_VIEWS,
  THS_SUB_VIEW_LABELS,
);

/**
 * 东方财富卡片的子视图
 *
 * 快讯 = 既有 7×24 快讯通道；推荐 / 热搜 / 领涨概念为 so.eastmoney.com
 * 首屏同名模块的单页快照（无翻页），数据结构与快讯的新闻列表不同，卡片内分支渲染
 */
export type EmSubView = 'flash' | 'rec' | 'hot' | 'concept';

/** 东财子视图渲染顺序（首个为默认选中项） */
export const EM_SUB_VIEWS: readonly EmSubView[] = [
  'flash',
  'rec',
  'hot',
  'concept',
];

/** 东财子视图展示名（与官网模块名对应） */
export const EM_SUB_VIEW_LABELS: Record<EmSubView, string> = {
  flash: '快讯',
  rec: '推荐',
  hot: '热搜',
  concept: '领涨概念',
};

/** 东财卡片子视图选项（切换控件直接消费） */
export const EM_SUB_VIEW_OPTIONS: readonly HotNewsViewOption[] = toViewOptions(
  EM_SUB_VIEWS,
  EM_SUB_VIEW_LABELS,
);

/**
 * 澎湃新闻卡片的子视图
 *
 * 快讯 = 既有财经频道（channel_25951）翻页通道；
 * 热榜 = 频道页右侧栏「热榜」的单页快照（wwwIndex/rightSidebar，无翻页），
 * 数据为名次榜而非新闻列表，卡片内分支渲染
 */
export type TpSubView = 'flash' | 'hot';

/** 澎湃子视图渲染顺序（首个为默认选中项） */
export const TP_SUB_VIEWS: readonly TpSubView[] = ['flash', 'hot'];

/** 澎湃子视图展示名（与官网模块名对应） */
export const TP_SUB_VIEW_LABELS: Record<TpSubView, string> = {
  flash: '快讯',
  hot: '热榜',
};

/** 澎湃卡片子视图选项（切换控件直接消费） */
export const TP_SUB_VIEW_OPTIONS: readonly HotNewsViewOption[] = toViewOptions(
  TP_SUB_VIEWS,
  TP_SUB_VIEW_LABELS,
);

/**
 * 财联社卡片的子视图
 *
 * 深度 = 深度页（depth id=1000）置顶头条 + 资讯流；
 * 热榜 = 站点「热门文章排行榜」单页快照（v2/article/hot/list，无翻页），
 * 数据为名次榜（含阅读数），卡片内分支渲染
 */
export type ClsSubView = 'depth' | 'hot';

/** 财联社子视图渲染顺序（首个为默认选中项） */
export const CLS_SUB_VIEWS: readonly ClsSubView[] = ['depth', 'hot'];

/** 财联社子视图展示名（与官网模块名对应） */
export const CLS_SUB_VIEW_LABELS: Record<ClsSubView, string> = {
  depth: '深度',
  hot: '热榜',
};

/** 财联社卡片子视图选项（切换控件直接消费） */
export const CLS_SUB_VIEW_OPTIONS: readonly HotNewsViewOption[] = toViewOptions(
  CLS_SUB_VIEWS,
  CLS_SUB_VIEW_LABELS,
);

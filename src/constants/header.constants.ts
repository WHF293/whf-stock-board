/**
 * 顶栏（应用右上角工具条）常量
 *
 * 顶栏条目有两个来源，都会被设置页「顶栏工具」编排（顺序 + 显隐）：
 * - **宿主自带**：交易时段徽标 / 明暗切换 / 搜索 / Agent 分析（本文件声明）；
 * - **插件贡献**：`ctx.header.add(...)`（内核注册表提供，见 `plugin/contributions.ts`）。
 *
 * 两侧合并后按 `settings.headerOrder` 渲染；默认顺序 = 本文件声明顺序 +
 * 插件条目按自己的 `order` 追加末尾（与左侧导航菜单同一套兜底规则：
 * 升级新增项 / 新装插件的入口不会因为不在持久化顺序里就消失）。
 */
import { HEADER_MARQUEE_TONE } from './plugin.constants';
import type { HeaderMarqueeTone } from '../types/plugin.types';

/** 宿主自带顶栏条目的 id（供渲染分支与设置页编排共用） */
export const HOST_HEADER_ITEM = {
  /** 交易时段徽标（MarketStatusBadge 组件，不是图标按钮） */
  MARKET_STATUS: 'host-market-status',
  /** 明暗模式切换 */
  THEME: 'host-theme',
  /** 标的搜索 */
  SEARCH: 'host-search',
  /** Agent 分析（Tauri 独立窗口 / 浏览器站内页） */
  AGENT: 'host-agent',
} as const satisfies Record<string, string>;

/** 宿主自带顶栏条目（数组顺序 = 默认展示顺序，从左到右；title / icon 供设置页编排列表展示） */
export const HOST_HEADER_ITEMS = [
  { id: HOST_HEADER_ITEM.MARKET_STATUS, title: '交易时段', icon: 'info' },
  { id: HOST_HEADER_ITEM.THEME, title: '明暗切换', icon: 'sun' },
  { id: HOST_HEADER_ITEM.SEARCH, title: '搜索个股', icon: 'search' },
  { id: HOST_HEADER_ITEM.AGENT, title: 'Agent 分析', icon: 'agent' },
] as const;

/** 宿主自带顶栏条目的 id 集合（设置页「重置」判定与合并顺序用） */
export const HEADER_DEFAULT_ORDER: readonly string[] = HOST_HEADER_ITEMS.map(
  (item) => item.id,
);

/**
 * 轮播行语义色调 → 文本色类名
 *
 * 只有颜色走这个映射，其余外观（字号 / 截断 / 对齐）在 `HeaderItemHost.vue` 里统一 ——
 * 插件声明语气，宿主决定长相。
 */
export const HEADER_MARQUEE_TONE_CLASS: Record<HeaderMarqueeTone, string> = {
  [HEADER_MARQUEE_TONE.DEFAULT]: 'text-text-secondary',
  [HEADER_MARQUEE_TONE.UP]: 'text-up',
  [HEADER_MARQUEE_TONE.DOWN]: 'text-down',
  [HEADER_MARQUEE_TONE.FLAT]: 'text-flat',
  [HEADER_MARQUEE_TONE.PRIMARY]: 'text-primary',
};

/**
 * 顶栏轮播单行高度（px）
 *
 * 滚动视窗高度、轨道位移步长、每行行高三处必须用同一个值 —— 差 1px 就会在
 * 切换瞬间露出下一行的半截字。所以用数值常量内联 style，不依赖 Tailwind 类名同步。
 */
export const HEADER_MARQUEE_LINE_HEIGHT = 20;

/** 顶栏轮播滑动时长（ms）：一整条滑出、下一条滑入的时间 */
export const HEADER_MARQUEE_SLIDE_MS = 400;

/** 顶栏轮播滑动缓动（快起慢收，Swiper 那种「滑到位」的观感） */
export const HEADER_MARQUEE_SLIDE_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)';

/** 顶栏轮播行首标签的宽度上限（em，随字号缩放；5 = 五个汉字宽，超出截断省略） */
export const HEADER_MARQUEE_LABEL_MAX_EM = 5;

/**
 * 顶栏轮播数值列固定宽度（px）
 *
 * 按最坏一行里的「价格 + 涨跌幅」预留：`99999.99 +9999.99%` 本机 Chrome 实测 110.63
 * （系统字体栈 12px），向上取整到 111。**写死而不是自适应** —— 自适应会让每行的
 * 数值列宽随内容变化，数字左右横跳；固定后不论行情怎么变，这一列的位置都不动。
 * 单价 5 位是冗余预留（A 股远达不到），宁可留白也不让极端数字把布局挤变形。
 */
export const HEADER_MARQUEE_VALUE_WIDTH_PX = 111;

/**
 * 顶栏轮播视窗宽度（px）
 *
 * 两列宽度固定，视窗宽度才能是个定值、顶栏永不被轮播内容推挤：
 * 名称上限 5 字（12px 字号 = 60）+ 数值列 111 = 171。
 * 两列之间不留间距 —— 数值列本身就是冗余预留（见上），再留间距只会把名称挤窄。
 */
export const HEADER_MARQUEE_VIEWPORT_PX = 171;


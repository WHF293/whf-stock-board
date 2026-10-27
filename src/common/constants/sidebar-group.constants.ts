/**
 * 侧栏菜单分组（2026-10-17 起：页面多了以后侧栏按组折叠展示）
 *
 * 分组归属由「声明」决定：宿主页在 `MENU_ITEMS` 里写 `group`，插件菜单经
 * `ctx.menu.add({ group })` 声明；不声明 `group` 的一律归「插件」组。
 * 组顺序由用户编排（settings.menuGroupOrder），组内顺序沿用扁平的
 * settings.menuOrder——归组与排序正交，互不覆盖。
 */

/** 侧栏菜单分组 id（代替魔法字符串） */
export const SIDEBAR_MENU_GROUP = {
  MARKET: 'market',
  FUTURES: 'futures',
  NEWS: 'news',
  ACCOUNT: 'account',
  PLUGIN: 'plugin',
} as const;

/** 分组 id 类型（即 SIDEBAR_MENU_GROUP 的值） */
export type SidebarMenuGroupId = (typeof SIDEBAR_MENU_GROUP)[keyof typeof SIDEBAR_MENU_GROUP];

/**
 * 菜单项未声明 group 时的默认归组（插件页不声明就收进「插件」组）
 *
 * 用 string 而非 SidebarMenuGroupId：插件可声明任意自定义分组 id，
 * 归组逻辑按字符串处理，不把类型收窄到宿主内置的五个组。
 */
export const SIDEBAR_MENU_GROUP_DEFAULT: string = SIDEBAR_MENU_GROUP.PLUGIN;

/**
 * 分组 id → 展示标题
 *
 * 未收录的自定义分组 id（插件声明的新组）直接以 id 作为标题渲染，
 * 宿主不为其硬编码文案。
 */
export const SIDEBAR_MENU_GROUP_TITLES: Readonly<Record<string, string>> = {
  [SIDEBAR_MENU_GROUP.MARKET]: '市场行情',
  [SIDEBAR_MENU_GROUP.FUTURES]: '期货',
  [SIDEBAR_MENU_GROUP.NEWS]: '热点资讯',
  [SIDEBAR_MENU_GROUP.ACCOUNT]: '自选与账户',
  [SIDEBAR_MENU_GROUP.PLUGIN]: '插件',
};

/**
 * 分组默认顺序（= 用户未编排时 settings.menuGroupOrder 的初始值）
 *
 * 未收录进此数组的分组 id（插件声明的新组）追加到末尾渲染。
 */
export const SIDEBAR_MENU_GROUP_DEFAULT_ORDER: readonly string[] = [
  SIDEBAR_MENU_GROUP.MARKET,
  SIDEBAR_MENU_GROUP.FUTURES,
  SIDEBAR_MENU_GROUP.NEWS,
  SIDEBAR_MENU_GROUP.ACCOUNT,
  SIDEBAR_MENU_GROUP.PLUGIN,
];

/**
 * 路由路径集中管理（代替魔法字符串）
 */
export const ROUTE_PATH = {
  DASHBOARD: "/dashboard",
  WATCHLIST: "/watchlist",
  PANORAMA: "/panorama",

  MARKET_EVENT: "/market-event", // 兼容旧路由跳转
  MARKET_MOOD: "/market-mood",
  SCREENER: "/screener",
  HOT_NEWS: "/hot-news",
  MARKET_RANK: "/market-rank",
  SETTINGS: "/settings",
} as const;

/**
 * 左侧导航图标 key（MenuIcon 组件按此渲染内联 SVG）
 */
export const MENU_ICON = {
  DASHBOARD: "dashboard",
  STAR: "star",
  PANORAMA: "globe",
  FUNDS: "funds",
  FLAME: "flame",
  TROPHY: "trophy",
  FILTER: "filter",
  NEWS: "news",
  RANK: "rank",
  SETTINGS: "settings",
} as const;

/**
 * 左侧导航菜单配置（驱动 MainLayout 渲染，数组顺序即展示顺序）
 *
 * 板块行情已并入行情全景的 A 股全景模块；设置不入主导航（固定为侧栏底部入口）
 */
export const MENU_ITEMS = [
  { path: ROUTE_PATH.DASHBOARD, title: "市场总览", icon: MENU_ICON.DASHBOARD },
  { path: ROUTE_PATH.MARKET_RANK, title: "市场榜单", icon: MENU_ICON.RANK },
  { path: ROUTE_PATH.PANORAMA, title: "行情全景", icon: MENU_ICON.PANORAMA },
  { path: ROUTE_PATH.MARKET_MOOD, title: "市场异动", icon: MENU_ICON.FLAME },
  { path: ROUTE_PATH.WATCHLIST, title: "自选股", icon: MENU_ICON.STAR },
  { path: ROUTE_PATH.SCREENER, title: "选股器", icon: MENU_ICON.FILTER },
  { path: ROUTE_PATH.HOT_NEWS, title: "热点新闻", icon: MENU_ICON.NEWS },
] as const;

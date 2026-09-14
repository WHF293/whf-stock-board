/**
 * 路由路径集中管理（代替魔法字符串）
 */
export const ROUTE_PATH = {
  DASHBOARD: "/dashboard",
  WATCHLIST: "/watchlist",
  PANORAMA: "/panorama",
  BOARD_CALENDAR: "/board-calendar",

  MARKET_EVENT: "/market-event", // 兼容旧路由跳转
  MARKET_MOOD: "/market-mood",
  SCREENER: "/screener",
  HOT_NEWS: "/hot-news",
  MARKET_RANK: "/market-rank",
  STOCK_ACCOUNT: "/stock-account",
  AGENT_ANALYSIS: "/agent-analysis",
  SETTINGS: "/settings",
  STOCK_DETAIL: "/stock-detail", // 股票详情整页（+/:symbol，不入菜单）
} as const;

/**
 * 左侧导航图标 key（MenuIcon 组件按此渲染内联 SVG）
 */
export const MENU_ICON = {
  DASHBOARD: "dashboard",
  STAR: "star",
  PANORAMA: "globe",
  CALENDAR: "calendar",
  FUNDS: "funds",
  FLAME: "flame",
  TROPHY: "trophy",
  FILTER: "filter",
  NEWS: "news",
  RANK: "rank",
  ACCOUNT: "account",
  AGENT: "agent",
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
  // 板块日历紧跟行情全景：同为「板块维度的行情视角」
  { path: ROUTE_PATH.BOARD_CALENDAR, title: "板块日历", icon: MENU_ICON.CALENDAR },
  { path: ROUTE_PATH.MARKET_MOOD, title: "市场异动", icon: MENU_ICON.FLAME },
  { path: ROUTE_PATH.WATCHLIST, title: "自选股", icon: MENU_ICON.STAR },
  { path: ROUTE_PATH.SCREENER, title: "选股器", icon: MENU_ICON.FILTER },
  { path: ROUTE_PATH.HOT_NEWS, title: "热点新闻", icon: MENU_ICON.NEWS },
  // 账户（含交割单导入入口）是「本地 Agent 分析」的数据输入，排在 Agent 分析之前
  { path: ROUTE_PATH.STOCK_ACCOUNT, title: "账户管理", icon: MENU_ICON.ACCOUNT },
  { path: ROUTE_PATH.AGENT_ANALYSIS, title: "Agent 分析", icon: MENU_ICON.AGENT },
] as const;

/**
 * 默认侧栏顺序（= MENU_ITEMS 声明顺序的 path 数组）
 *
 * 供设置页「重置」与主布局兜底使用；用户自定义顺序存于 settings.menuOrder
 */
export const MENU_DEFAULT_ORDER: readonly string[] = MENU_ITEMS.map(
  (item) => item.path,
);

/**
 * 路由路径集中管理（代替魔法字符串）
 */
export const ROUTE_PATH = {
  DASHBOARD: '/dashboard',
  WATCHLIST: '/watchlist',
  PANORAMA: '/panorama',
  FUNDS: '/funds',
  MARKET_EVENT: '/market-event',
  DRAGON_TIGER: '/dragon-tiger',
  SCREENER: '/screener',
  HOT_NEWS: '/hot-news',
  SETTINGS: '/settings',
} as const;

/**
 * 左侧导航图标 key（MenuIcon 组件按此渲染内联 SVG）
 */
export const MENU_ICON = {
  DASHBOARD: 'dashboard',
  STAR: 'star',
  PANORAMA: 'globe',
  FUNDS: 'funds',
  FLAME: 'flame',
  TROPHY: 'trophy',
  FILTER: 'filter',
  NEWS: 'news',
  SETTINGS: 'settings',
} as const;

/**
 * 左侧导航菜单配置（驱动 MainLayout 渲染，数组顺序即展示顺序）
 *
 * 板块行情已并入行情全景的 A 股全景模块；设置不入主导航（固定为侧栏底部入口）
 */
export const MENU_ITEMS = [
  { path: ROUTE_PATH.DASHBOARD, title: '市场总览', icon: MENU_ICON.DASHBOARD },
  { path: ROUTE_PATH.WATCHLIST, title: '自选股', icon: MENU_ICON.STAR },
  { path: ROUTE_PATH.PANORAMA, title: '行情全景', icon: MENU_ICON.PANORAMA },
  { path: ROUTE_PATH.FUNDS, title: '资金动向', icon: MENU_ICON.FUNDS },
  { path: ROUTE_PATH.MARKET_EVENT, title: '涨停与异动', icon: MENU_ICON.FLAME },
  { path: ROUTE_PATH.DRAGON_TIGER, title: '龙虎榜·大宗', icon: MENU_ICON.TROPHY },
  { path: ROUTE_PATH.SCREENER, title: '选股器', icon: MENU_ICON.FILTER },
  { path: ROUTE_PATH.HOT_NEWS, title: '热点新闻', icon: MENU_ICON.NEWS },
] as const;

/**
 * 路由路径集中管理（代替魔法字符串）
 */
import type { SidebarMenuEntry } from '../utils/order-sidebar-menu';
import { SIDEBAR_MENU_GROUP } from './sidebar-group.constants.ts';

export const ROUTE_PATH = {
  DASHBOARD: "/dashboard",
  WATCHLIST: "/watchlist",
  PANORAMA: "/panorama",
  BOARD_CALENDAR: "/board-calendar",
  BOARD_DETAIL: "/board-detail", // 板块日历详情（+/:code，板块日历页点板块名称进入，不入菜单）

  MARKET_EVENT: "/market-event", // 兼容旧路由跳转
  MARKET_MOOD: "/market-mood",
  // SCREENER("/screener")已改为插件分发（dsh-stock-screener），路径由插件注册
  HOT_NEWS: "/hot-news",
  WHAT_TO_TRADE: "/what-to-trade", // 今天炒什么（五平台热股榜 + 同花顺四 ETF 榜，页内模式切换）
  MARKET_RANK: "/market-rank",
  STOCK_MARKET: "/stock-market", // 个股行情（已并入行情全景「全部个股」子 tab，2026-10-22；旧路径由 404 兜底页承接）
  BOARD_FLOW: "/board-flow", // 板块资金流向（原「行情全景-最新板块资金」独立成页，2026-10-13）
  HEATMAP: "/heatmap", // 大盘云图（2026-10-29 起转插件分发：dsh-dapanyuntu 注册本路径；总览「板块热力」卡标题入口仍指向这里）
  MARKET_BREADTH: "/market-breadth", // 市场宽度（2026-10-29 起转插件分发：dsh-market-breadth 注册本路径；总览宽度卡的深化页入口仍指向这里）
  SECTOR_FLOW_HISTORY: "/sector-flow-history", // 板块历史净流入（行情全景-板块资金 → 「查看历史净流入」，不入菜单）
  FUTURES_OVERVIEW: "/futures/overview", // 期货·总览（期货市场总览：主力流况 / 资金流向 / 多空比，同花顺期货通数据）
  STOCK_ACCOUNT: "/stock-account",
  PLUGIN_LAB: "/plugin-lab", // 插件工坊（宿主自带功能：插件体系的自省与管理页）
  AGENT_WINDOW: "/agent-window", // Agent 分析独立 WebviewWindow（standalone 布局，不入菜单）
  SYSTEM_LOG: "/system-log", // 系统日志页（设置页入口进入，不入菜单）
  SETTINGS: "/settings",
  STOCK_DETAIL: "/stock-detail", // 股票详情整页（+/:symbol，不入菜单）
  WIDE_BASE_ETF: "/wide-base-etf", // 宽基ETF（国家队/汇金系核心操作宽基监控，市场总览页头按钮进入，不入菜单）
  INDUSTRY_LEADER_DETAIL: "/industry-leader", // 行业龙头详情（+?kind=&group=，行情全景-行业龙头点卡片标题进入，不入菜单）
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
  PLUG: "plug",
  AGENT: "agent",
  SETTINGS: "settings",
  LOG: "log",
} as const;

/**
 * 主布局路由的 name（插件路由经 `router.addRoute(LAYOUT_ROUTE_NAME, ...)` 挂为其子路由）
 */
export const LAYOUT_ROUTE_NAME = 'root';

/** 404 兜底路由的 name（插件启动路径还原等逻辑按此判定「当前在兜底页」） */
export const NOT_FOUND_ROUTE_NAME = 'not-found';

/**
 * 左侧导航菜单配置（驱动 MainLayout 渲染，数组顺序即展示顺序）
 *
 * 板块行情已并入行情全景的 A 股全景模块；市场异动已并入盘面雷达（涨停 / 异动 /
 * 龙虎榜 / 大宗为其页签）；设置不入主导航（固定为侧栏底部入口）；
 * 插件贡献的菜单项由内核注册表提供，本数组只声明宿主自带的菜单。
 *
 * `group` 声明侧栏分组（归属由声明决定，用户只能调组序与组内序，见
 * `sidebar-group.constants.ts`）；插件菜单不声明 group 默认归「插件」组。
 *
 * `fallbackLanding` 声明「插件页随插件撤销」时的兜底落点（必须是宿主自带页面，
 * 恒可用）：用户停在其他插件页面上关掉那个插件，宿主优先把他送到这里。
 */
export const MENU_ITEMS: readonly SidebarMenuEntry[] = [
  { path: ROUTE_PATH.DASHBOARD, title: "市场总览", icon: MENU_ICON.DASHBOARD, group: SIDEBAR_MENU_GROUP.MARKET },
  { path: ROUTE_PATH.PANORAMA, title: "行情全景", icon: MENU_ICON.PANORAMA, group: SIDEBAR_MENU_GROUP.MARKET },
  // 盘面雷达 / 资金流向：原「榜单与资金」组撤销，并入市场行情组（2026-10-27 王总指定）
  { path: ROUTE_PATH.MARKET_RANK, title: "盘面雷达", icon: MENU_ICON.RANK, group: SIDEBAR_MENU_GROUP.MARKET },
  // 资金流向（原「板块资金流向」，2026-10-22 王总更名）：原「行情全景-最新板块资金」模块独立成页（2026-10-13）
  { path: ROUTE_PATH.BOARD_FLOW, title: "资金流向", icon: MENU_ICON.FUNDS, group: SIDEBAR_MENU_GROUP.MARKET },
  // 大盘云图侧栏入口已移除（2026-10-22 王总指定），改为市场总览页头「大盘云图」按钮进入（同宽基ETF入口位）；
  // 页面 2026-10-29 起转插件分发（dsh-dapanyuntu 注册 /heatmap，不入菜单）
  // 板块日历紧跟行情全景：同为「板块维度的行情视角」
  { path: ROUTE_PATH.BOARD_CALENDAR, title: "板块分析", icon: MENU_ICON.CALENDAR, group: SIDEBAR_MENU_GROUP.MARKET },
  // 市场广度指标：五大广度副图（ADL/ADR/OBOS/ARMS/MCO），市场总览宽度卡的深化页
  // 市场宽度（2026-10-29 起转插件分发：菜单与 /market-breadth 路由由 dsh-market-breadth 注册）
  { path: ROUTE_PATH.FUTURES_OVERVIEW, title: "期货总览", icon: MENU_ICON.DASHBOARD, group: SIDEBAR_MENU_GROUP.MARKET },
  // 期货·总览：原「期货」分组撤销后并入市场行情组（2026-10-29 王总指定）
  { path: ROUTE_PATH.WATCHLIST, title: "自选股", icon: MENU_ICON.STAR, group: SIDEBAR_MENU_GROUP.ACCOUNT },
  // 选股器已改为插件分发（dsh-stock-screener），由插件注册菜单与 /screener 路由
  { path: ROUTE_PATH.HOT_NEWS, title: "热点新闻", icon: MENU_ICON.NEWS, group: SIDEBAR_MENU_GROUP.NEWS },
  // 今天炒什么紧跟热点新闻：同为「盘前 / 盘中扫一眼市场在炒什么」的日常视角
  { path: ROUTE_PATH.WHAT_TO_TRADE, title: "今天炒什么", icon: MENU_ICON.FLAME, group: SIDEBAR_MENU_GROUP.NEWS },
  { path: ROUTE_PATH.STOCK_ACCOUNT, title: "账户分析", icon: MENU_ICON.ACCOUNT, group: SIDEBAR_MENU_GROUP.ACCOUNT },
  // 插件工坊侧栏入口已移除（2026-10-29 王总指定），改为顶栏 Agent 分析之后的插头图标进入；
  // /plugin-lab 路由与「插件页撤销兜底落点」语义保留（落点声明见 pc/plugin/setup.ts）
];

/**
 * 默认侧栏顺序（= MENU_ITEMS 声明顺序的 path 数组）
 *
 * 供设置页编排弹窗的「恢复默认」与 store 的兜底（初始值 / resetMenuOrder）使用；
 * 用户自定义顺序存于 settings.menuOrder
 */
export const MENU_DEFAULT_ORDER: readonly string[] = MENU_ITEMS.map(
  (item) => item.path,
);

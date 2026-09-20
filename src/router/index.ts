import { createRouter, createWebHistory } from 'vue-router';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';
import MainLayout from '../layouts/MainLayout.vue';
import { LAYOUT_ROUTE_NAME, ROUTE_PATH, MENU_ITEMS } from '../constants/router-meta.constants';
import DashboardView from '../views/DashboardView.vue';
import WatchlistView from '../views/WatchlistView.vue';
import PanoramaView from '../views/PanoramaView.vue';
import BoardCalendarView from '../views/BoardCalendarView.vue';
import BoardCalendarDetailView from '../views/BoardCalendarDetailView.vue';
import MarketMoodView from '../views/MarketMoodView.vue';
import ScreenerView from '../views/ScreenerView.vue';
import HotNewsView from '../views/HotNewsView.vue';
import StockAccountView from '../views/StockAccountView.vue';
import AgentAnalysisView from '../views/AgentAnalysisView.vue';
import MarketRankView from '../views/MarketRankView.vue';
import SectorFlowHistoryView from '../views/SectorFlowHistoryView.vue';
import StockDetailView from '../views/StockDetailView.vue';
import SystemLogView from '../views/SystemLogView.vue';
import WhitepaperView from '../views/WhitepaperView.vue';

/** 路由切换顶部进度条：钩子在路由表定义后立即挂载 */
NProgress.configure({ showSpinner: false, speed: 300, minimum: 0.2 });

/**
 * 路由标题表（菜单项），避免魔法字符串散落
 */
const ROUTE_TITLE_BY_PATH: Record<string, string> = {
  ...Object.fromEntries(MENU_ITEMS.map((item) => [item.path, item.title])),
};

/**
 * 路由表：根路径挂 MainLayout。
 * 桌面端（Tauri）页面资源随安装包本地加载，无网络传输成本，
 * 因此不做路由懒加载 / 分包，统一静态导入，消除切换时的 chunk 请求与白屏。
 * `/` 重定向到市场总览，未匹配路径（404）兜底回市场总览
 */
const routes = [
  {
    path: '/',
    // 具名：插件路由经 `router.addRoute(LAYOUT_ROUTE_NAME, ...)` 挂为其子路由
    name: LAYOUT_ROUTE_NAME,
    component: MainLayout,
    children: [
      { path: '', redirect: ROUTE_PATH.DASHBOARD },
      {
        path: ROUTE_PATH.DASHBOARD,
        component: DashboardView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.DASHBOARD] },
      },
      {
        path: ROUTE_PATH.WATCHLIST,
        component: WatchlistView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.WATCHLIST] },
      },
      {
        path: ROUTE_PATH.PANORAMA,
        component: PanoramaView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.PANORAMA] },
      },
      {
        path: ROUTE_PATH.BOARD_CALENDAR,
        component: BoardCalendarView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.BOARD_CALENDAR] },
      },
      // 板块日历详情整页：板块日历页点击板块名称进入；不入左侧导航
      {
        path: `${ROUTE_PATH.BOARD_DETAIL}/:code`,
        component: BoardCalendarDetailView,
        meta: { title: '板块详情' },
      },
      // 资金动向已并入市场榜单（旧路径重定向）
      { path: '/funds', redirect: ROUTE_PATH.MARKET_RANK },
      {
        path: ROUTE_PATH.MARKET_MOOD,
        component: MarketMoodView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.MARKET_MOOD] },
      },
      // 旧路径重定向（历史收藏 / 外链兼容）
      { path: ROUTE_PATH.MARKET_EVENT, redirect: ROUTE_PATH.MARKET_MOOD },
      { path: '/dragon-tiger', redirect: ROUTE_PATH.MARKET_MOOD },
      {
        path: ROUTE_PATH.SCREENER,
        component: ScreenerView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.SCREENER] },
      },
      {
        path: ROUTE_PATH.HOT_NEWS,
        component: HotNewsView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.HOT_NEWS] },
      },
      {
        path: ROUTE_PATH.STOCK_ACCOUNT,
        component: StockAccountView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.STOCK_ACCOUNT] },
      },
      // 交割单导入已并入股票账户页（历史收藏 / 旧路径兼容）
      { path: '/trade-import', redirect: ROUTE_PATH.STOCK_ACCOUNT },
      {
        path: ROUTE_PATH.MARKET_RANK,
        component: MarketRankView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.MARKET_RANK] },
      },
      // 板块历史净流入：市场榜单-板块净流入「查看历史净流入」进入；不入左侧导航
      {
        path: ROUTE_PATH.SECTOR_FLOW_HISTORY,
        component: SectorFlowHistoryView,
        meta: { title: '板块历史净流入' },
      },
      // 设置已改为侧栏底部入口的右侧抽屉（历史收藏 / 旧路径兼容）
      { path: ROUTE_PATH.SETTINGS, redirect: ROUTE_PATH.DASHBOARD },
      // 系统日志：由设置抽屉「查看系统日志」进入，不入左侧导航
      {
        path: ROUTE_PATH.SYSTEM_LOG,
        component: SystemLogView,
        meta: { title: '系统日志' },
      },
      // 软件白皮书：由顶栏「软件白皮书」入口进入，不入左侧导航
      {
        path: ROUTE_PATH.WHITEPAPER,
        component: WhitepaperView,
        meta: { title: '软件白皮书' },
      },
      // 股票详情整页：全站双击个股进入；不入左侧导航
      {
        path: `${ROUTE_PATH.STOCK_DETAIL}/:symbol`,
        component: StockDetailView,
        meta: { title: '股票详情' },
      },
    ],
  },
  // Agent 分析独立窗口路由：Tauri 下经独立 WebviewWindow 打开（standalone 布局占满 webview），
  // 不在主窗口导航内使用；浏览器直开此路径也渲染 standalone 版本
  {
    path: ROUTE_PATH.AGENT_WINDOW,
    component: AgentAnalysisView,
    props: { standalone: true },
    meta: { title: 'Agent 分析' },
  },
  { path: '/:pathMatch(.*)*', redirect: ROUTE_PATH.DASHBOARD },
];

// 独立窗口启动引导：WebviewWindow 用 `index.html?page=/agent-window` 打开（规避
// Tauri 静态资源协议对 SPA 子路径回退的不确定性），这里把 page 参数还原成真实路径
const bootPage = new URLSearchParams(window.location.search).get('page');
if (bootPage && bootPage.startsWith('/') && !bootPage.startsWith('//')) {
  window.history.replaceState(null, '', bootPage);
}

/** 全站路由实例（HTML5 History 模式） */
export const router = createRouter({
  history: createWebHistory(),
  routes,
});

// 路由切换进度条：静态组件渲染很快，进度条仅作极短过渡反馈
router.beforeEach(() => {
  NProgress.start();
});
router.afterEach(() => {
  NProgress.done();
});
router.onError(() => {
  NProgress.done();
});

import { createRouter, createWebHistory } from 'vue-router';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';
import MainLayout from '../layouts/MainLayout.vue';
import { ROUTE_PATH, MENU_ITEMS } from '../constants/router-meta.constants';
import DashboardView from '../views/DashboardView.vue';
import WatchlistView from '../views/WatchlistView.vue';
import PanoramaView from '../views/PanoramaView.vue';
import MarketMoodView from '../views/MarketMoodView.vue';
import ScreenerView from '../views/ScreenerView.vue';
import HotNewsView from '../views/HotNewsView.vue';
import StockAccountView from '../views/StockAccountView.vue';
import TradeImportView from '../views/TradeImportView.vue';
import AgentAnalysisView from '../views/AgentAnalysisView.vue';
import MarketRankView from '../views/MarketRankView.vue';
import SettingsView from '../views/SettingsView.vue';

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
      {
        path: ROUTE_PATH.TRADE_IMPORT,
        component: TradeImportView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.TRADE_IMPORT] },
      },
      {
        path: ROUTE_PATH.AGENT_ANALYSIS,
        component: AgentAnalysisView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.AGENT_ANALYSIS] },
      },
      {
        path: ROUTE_PATH.MARKET_RANK,
        component: MarketRankView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.MARKET_RANK] },
      },
      {
        path: ROUTE_PATH.SETTINGS,
        component: SettingsView,
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.SETTINGS] },
      },
    ],
  },
  { path: '/:pathMatch(.*)*', redirect: ROUTE_PATH.DASHBOARD },
];

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

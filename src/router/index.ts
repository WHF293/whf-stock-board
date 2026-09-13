import { createRouter, createWebHistory } from 'vue-router';
import NProgress from 'nprogress';
import 'nprogress/nprogress.css';
import MainLayout from '../layouts/MainLayout.vue';
import { ROUTE_PATH, MENU_ITEMS } from '../constants/router-meta.constants';

/** 路由切换顶部进度条：钩子在路由表定义后立即挂载 */
NProgress.configure({ showSpinner: false, speed: 300, minimum: 0.2 });

/**
 * 路由标题表（菜单项），避免魔法字符串散落
 */
const ROUTE_TITLE_BY_PATH: Record<string, string> = {
  ...Object.fromEntries(MENU_ITEMS.map((item) => [item.path, item.title])),
};

/**
 * 路由表：根路径挂 MainLayout，子路由懒加载按页面分包；
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
        component: () => import('../views/DashboardView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.DASHBOARD] },
      },
      {
        path: ROUTE_PATH.WATCHLIST,
        component: () => import('../views/WatchlistView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.WATCHLIST] },
      },
      {
        path: ROUTE_PATH.PANORAMA,
        component: () => import('../views/PanoramaView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.PANORAMA] },
      },
      {
        path: ROUTE_PATH.FUNDS,
        component: () => import('../views/FundFlowView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.FUNDS] },
      },
      {
        path: ROUTE_PATH.MARKET_EVENT,
        component: () => import('../views/MarketEventView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.MARKET_EVENT] },
      },
      {
        path: ROUTE_PATH.DRAGON_TIGER,
        component: () => import('../views/DragonTigerView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.DRAGON_TIGER] },
      },
      {
        path: ROUTE_PATH.SCREENER,
        component: () => import('../views/ScreenerView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.SCREENER] },
      },
      {
        path: ROUTE_PATH.HOT_NEWS,
        component: () => import('../views/HotNewsView.vue'),
        meta: { title: ROUTE_TITLE_BY_PATH[ROUTE_PATH.HOT_NEWS] },
      },
      {
        path: ROUTE_PATH.SETTINGS,
        component: () => import('../views/SettingsView.vue'),
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

// 路由切换进度条：懒加载 chunk 期间展示，完成/失败收起
router.beforeEach(() => {
  NProgress.start();
});
router.afterEach(() => {
  NProgress.done();
});
router.onError(() => {
  NProgress.done();
});

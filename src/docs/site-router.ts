/**
 * 官网路由
 *
 * 用 hash 模式：GitHub Pages 项目子路径（/whf-stock-board/）没有 404 兜底配置，
 * history 模式下刷新 / 直链 /docs 会 404；hash 模式天然无此问题。
 */
import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router';
import DocsView from './views/DocsView.vue';
import DownloadView from './views/DownloadView.vue';
import HomeView from './views/HomeView.vue';
import PluginsView from './views/PluginsView.vue';

/** 官网路由表（四页体量小，直接静态导入，不做懒加载分包） */
const SITE_ROUTES: RouteRecordRaw[] = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/docs', name: 'docs', component: DocsView },
  { path: '/download', name: 'download', component: DownloadView },
  { path: '/plugins', name: 'plugins', component: PluginsView },
  { path: '/:pathMatch(.*)*', redirect: '/' },
];

/** 官网路由实例 */
export const siteRouter = createRouter({
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: SITE_ROUTES,
  scrollBehavior: () => ({ top: 0 }),
});

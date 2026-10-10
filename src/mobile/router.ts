import { createRouter, createWebHashHistory } from 'vue-router';
import MobileArticle from './views/MobileArticle.vue';
import MobileBoard from './views/MobileBoard.vue';
import MobileHotNews from './views/MobileHotNews.vue';
import MobileMine from './views/MobileMine.vue';
import MobileSettings from './views/MobileSettings.vue';
import MobileTheme from './views/MobileTheme.vue';

/** 主 Tab 页路径（底部 TabBar 只在这些路由显示；二级页由页面 meta 控制） */
export const MOBILE_TAB_PATHS: readonly string[] = ['/news', '/board', '/mine'];

/**
 * 移动端路由（hash 模式：Tauri Android WebView 的 file/本地加载形态下无需服务端配合）
 *
 * meta.tab = true 的路由显示底部 TabBar（MobileApp 按 meta 判断）
 */
export const mobileRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/news' },
    { path: '/news', name: 'news', component: MobileHotNews, meta: { tab: true } },
    { path: '/board', name: 'board', component: MobileBoard, meta: { tab: true } },
    { path: '/mine', name: 'mine', component: MobileMine, meta: { tab: true } },
    { path: '/settings', name: 'settings', component: MobileSettings },
    { path: '/theme', name: 'theme', component: MobileTheme },
    {
      path: '/article',
      name: 'article',
      component: MobileArticle,
      // 原文页为 webview 容器：url / title / media 经 query 传入
    },
  ],
});

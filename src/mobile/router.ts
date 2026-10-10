import { createRouter, createWebHashHistory } from 'vue-router';
import MobileArticle from './views/MobileArticle.vue';
import MobileBoard from './views/MobileBoard.vue';
import MobileBoardCalendar from './views/MobileBoardCalendar.vue';
import MobileHome from './views/MobileHome.vue';
import MobileHotNews from './views/MobileHotNews.vue';
import MobileMarketRank from './views/MobileMarketRank.vue';
import MobileMine from './views/MobileMine.vue';
import MobilePanorama from './views/MobilePanorama.vue';
import MobileSettings from './views/MobileSettings.vue';
import MobileStockDetail from './views/MobileStockDetail.vue';
import MobileTheme from './views/MobileTheme.vue';

/** 主 Tab 页路径（底部 TabBar 只在这些路由显示；二级页由页面 meta 控制） */
export const MOBILE_TAB_PATHS: readonly string[] = ['/', '/news', '/mine'];

/**
 * 移动端路由（hash 模式：Tauri Android WebView 的 file/本地加载形态下无需服务端配合）
 *
 * meta.tab = true 的路由显示底部 TabBar（MobileApp 按 meta 判断）；
 * /board（今天炒什么）自 v1.2 起为首页模块跳转的二级页，不占 Tab；
 * /panorama /market-rank /board-calendar /stock 为 v2 二期二级页（design-mobile.md §4）
 */
export const mobileRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: MobileHome, meta: { tab: true } },
    { path: '/news', name: 'news', component: MobileHotNews, meta: { tab: true } },
    { path: '/board', name: 'board', component: MobileBoard },
    { path: '/mine', name: 'mine', component: MobileMine, meta: { tab: true } },
    { path: '/settings', name: 'settings', component: MobileSettings },
    { path: '/theme', name: 'theme', component: MobileTheme },
    {
      path: '/article',
      name: 'article',
      component: MobileArticle,
      // 原文页为 webview 容器：url / title / media 经 query 传入
    },
    // === v2 二期二级页 ===
    { path: '/panorama', name: 'panorama', component: MobilePanorama },
    { path: '/market-rank', name: 'market-rank', component: MobileMarketRank },
    // /board-calendar 列表矩阵；/board-calendar/:code 板块详情矩阵
    { path: '/board-calendar/:code?', name: 'board-calendar', component: MobileBoardCalendar },
    // 个股 K 线详情：全站股票行点击统一落点（code 为完整符号，如 sh600519）
    { path: '/stock/:code', name: 'stock', component: MobileStockDetail },
  ],
});

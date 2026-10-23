import { createRouter, createWebHashHistory } from 'vue-router';
import MobileArticle from './views/MobileArticle.vue';
import MobileBoard from './views/MobileBoard.vue';
import MobileBoardCalendar from './views/MobileBoardCalendar.vue';
import MobileBreadth from './views/MobileBreadth.vue';
import MobileBullReview from './views/MobileBullReview.vue';
import MobileFundFlow from './views/MobileFundFlow.vue';
import MobileFuturesInstitutional from './views/MobileFuturesInstitutional.vue';
import MobileHome from './views/MobileHome.vue';
import MobileHotNews from './views/MobileHotNews.vue';
import MobileIpoBoard from './views/MobileIpoBoard.vue';
import MobileMarketRank from './views/MobileMarketRank.vue';
import MobileMine from './views/MobileMine.vue';
import MobilePanorama from './views/MobilePanorama.vue';
import MobileQuote from './views/MobileQuote.vue';
import MobileSearch from './views/MobileSearch.vue';
import MobileSettings from './views/MobileSettings.vue';
import MobileStockDetail from './views/MobileStockDetail.vue';
import MobileStockMarket from './views/MobileStockMarket.vue';
import MobileTheme from './views/MobileTheme.vue';
import MobileWatchlist from './views/MobileWatchlist.vue';

/** 主 Tab 页路径（底部 TabBar 只在这些路由显示，显隐由 MobileTabBar 按 MOBILE_TAB_ITEMS 判定；
 * MobileApp 的页面切换动画也按此声明序判定前进/后退方向，二级页视为最末；
 * 2026-10-20 起五 Tab：首页 / 行情 / 自选 / 新闻 / 我的） */
export const MOBILE_TAB_PATHS: readonly string[] = ['/', '/quote', '/watchlist', '/news', '/mine'];

/**
 * 移动端路由（hash 模式：Tauri Android WebView 的 file/本地加载形态下无需服务端配合）
 *
 * meta.tab = true 的路由为底部 TabBar 主 Tab（TabBar 显隐由 MobileTabBar 按 MOBILE_TAB_ITEMS 判定）；
 * /board（今天炒什么）自 v1.2 起为行情页金刚区跳转的二级页，不占 Tab；
 * /mine 自 2026-10-20 起回归 TabBar 第五 Tab（此前 2026-10-12 曾移出、由首页 navbar logo 进入）；
 * /panorama /market-rank /board-calendar /stock 为 v2 二期二级页（DESIGN-MOBILE.md §4）
 */
export const mobileRouter = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: MobileHome, meta: { tab: true } },
    // 行情（2026-10-20 新增主 Tab）：指数模块 + 金刚区快捷入口（今天炒什么/连板/异动/龙虎榜）
    { path: '/quote', name: 'quote', component: MobileQuote, meta: { tab: true } },
    { path: '/watchlist', name: 'watchlist', component: MobileWatchlist, meta: { tab: true } },
    { path: '/news', name: 'news', component: MobileHotNews, meta: { tab: true } },
    // 资金流向：自 2026-10-20 起移出 TabBar，入口改首页金刚区（页面保留为二级页）
    { path: '/fund-flow', name: 'fund-flow', component: MobileFundFlow },
    { path: '/board', name: 'board', component: MobileBoard },
    // 我的：2026-10-20 起回归第五主 Tab
    { path: '/mine', name: 'mine', component: MobileMine, meta: { tab: true } },
    { path: '/settings', name: 'settings', component: MobileSettings },
    // 股票搜索：首页 navbar 搜索入口的落点（二级页，无 TabBar）
    { path: '/search', name: 'search', component: MobileSearch },
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
    // 独立榜页（连板 / 异动 / 龙虎榜，入口在首页金刚区）：同组件按 :rank 进入独立模式
    {
      path: '/rank/:rank(event|events|dragon-tiger)',
      name: 'rank-standalone',
      component: MobileMarketRank,
    },
    // 历史牛熊（PC 行情全景-历史复盘的移动版；数据复用 panorama-review 单源，月K落 appStorage）
    { path: '/bull-review', name: 'bull-review', component: MobileBullReview },
    // 新股次新股（v4.5.2 自行情全景拆出的独立二级页，入口在首页金刚区）
    { path: '/ipo', name: 'ipo', component: MobileIpoBoard },
    // 个股行情（2026-10-13 新增二级页，入口在首页金刚区；PC /stock-market 同源移动版）
    { path: '/stock-market', name: 'stock-market', component: MobileStockMarket },
    // 机构行为（2026-10-20 新增二级页，入口在首页金刚区；PC FuturesInstitutionalView 的
    //  移动精简版：中金所 CCPM 席位行为标注——做多/做空/对冲，数据同源同算法）
    { path: '/futures-institutional', name: 'futures-institutional', component: MobileFuturesInstitutional },
    // 市场广度指标（2026-10-21 新增二级页，入口在首页金刚区；PC MarketBreadthView 同内容移动版：
    //  ADL/ADR/OBOS/ARMS/MCO 五副图，本地日 bar 离线计算，本页自带快照轮询负责 ingest）
    { path: '/market-breadth', name: 'market-breadth', component: MobileBreadth },
    // /board-calendar 列表矩阵；/board-calendar/:code 板块详情矩阵
    { path: '/board-calendar/:code?', name: 'board-calendar', component: MobileBoardCalendar },
    // 个股 K 线详情：全站股票行点击统一落点（code 为完整符号，如 sh600519）
    { path: '/stock/:code', name: 'stock', component: MobileStockDetail },
  ],
});

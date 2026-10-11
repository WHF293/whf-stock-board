import { createApp } from 'vue';
import SiteApp from './SiteApp.vue';
import { siteRouter } from './site-router';
import './site.css';

/**
 * 官网入口（独立于桌面 / 移动端入口，仅由 site.html 加载）
 *
 * 构建走 vite.config.site.ts（pnpm build:site），产物 dist-site/ 部署 GitHub Pages；
 * 主应用 pnpm build 不包含本入口。
 */
createApp(SiteApp).use(siteRouter).mount('#site-app');

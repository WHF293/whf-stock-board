// ⚠️ 必须最先导入：补 process/global 垫片，早于 deepagents 依赖链（micromatch →
// picomatch）的模块求值，否则 WebView 下会白屏（详见该模块注释）
import './utils/node-globals-shim';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import { router } from './router';
import { disableDevtools } from './utils/disable-devtools';
import { initWeblog } from './weblog';
import { installPlugins } from './plugin/setup';
import { useSettingsStore } from './stores/settings';
import './assets/styles/main.css';

// 线上禁用开发者工具常见入口（F12 / Ctrl+Shift+I|J|C / 右键菜单）
if (import.meta.env.PROD) {
  disableDevtools();
}

// 入口：pinia 挂持久化插件后先于 router 安装；主题初始化由 useTheme（useDark）在消费处完成
const app = createApp(App);

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

app.use(pinia);

// 系统日志：必须在 app.use(router) 之前挂载 —— 页面显示埋点靠 router.afterEach，
// 首个导航在 router 安装时就会触发，晚一步会漏掉首屏那一条
initWeblog({
  app,
  router,
  enabled: useSettingsStore(pinia).weblogEnabled,
});

// 插件体系：必须在 app.use(router) 之前装配 —— 插件贡献的路由要在首个导航就绪，
// 否则直接进入插件页面会被 404 兜底重定向回市场总览（详见 plugin/setup.ts）
installPlugins(pinia);

app.use(router);
app.mount('#app');

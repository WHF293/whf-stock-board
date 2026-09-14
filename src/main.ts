// ⚠️ 必须最先导入：补 process/global 垫片，早于 deepagents 依赖链（micromatch →
// picomatch）的模块求值，否则 WebView 下会白屏（详见该模块注释）
import './utils/node-globals-shim';
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import { router } from './router';
import { disableDevtools } from './utils/disable-devtools';
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
app.use(router);
app.mount('#app');

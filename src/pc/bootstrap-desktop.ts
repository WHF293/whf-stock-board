// 桌面端启动链（由 main.ts 在非 mobile 构建下动态加载，见 main.ts 的 mode 分流注释）
// 行为与拆分前的 main.ts 主体完全一致，仅整体搬移；移动端入口在 src/mobile/bootstrap.ts
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import App from './App.vue';
import { router } from './router/index';
import { disableDevtools } from '../common/utils/disable-devtools';
import { initWeblog } from './weblog/index';
import { installPlugins } from './plugin/setup';
import { startWatchlistDbSync } from '../common/composables/use-watchlist-db-sync';
import { useSettingsStore } from '../common/stores/settings';

/** 桌面端（Windows 客户端 / 浏览器）应用装配与挂载 */
export const bootstrapDesktop = (): void => {
  // 线上禁用开发者工具常见入口（F12 / Ctrl+Shift+I|J|C / 右键菜单）
  if (import.meta.env.PROD) {
    disableDevtools();
  }

  // 入口：pinia 挂持久化插件后先于 router 安装；主题初始化由 useTheme（useDark）在消费处完成
  const app = createApp(App);

  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);

  app.use(pinia);

  // 自选股 SQLite 镜像：启动对齐（库覆盖 store / 首次播种）+ 运行期整包重写，
  // 是「数据导入后自选股生效」与「导出文件含完整自选股」的前提（见模块注释）
  startWatchlistDbSync();

  // 系统日志：必须在 app.use(router) 之前挂载 —— 页面显示埋点靠 router.afterEach，
  // 首个导航在 router 安装时就会触发，晚一步会漏掉首屏那一条
  initWeblog({
    app,
    router,
    enabled: useSettingsStore(pinia).weblogEnabled,
    developerMode: useSettingsStore(pinia).weblogDeveloperMode,
  });

  // 插件体系：必须在 app.use(router) 之前装配 —— 插件贡献的路由要在首个导航就绪，
  // 否则直接进入插件页面会先落到 404 兜底页（详见 plugin/setup.ts）
  installPlugins(pinia);

  app.use(router);
  app.mount('#app');
};

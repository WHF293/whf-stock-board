import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import Vant from 'vant';
import 'vant/lib/index.css';
import { mobileRouter } from './router';
import MobileApp from './MobileApp.vue';
import './mobile.css';

/**
 * 移动端启动（main.ts 在 --mode mobile 构建下动态加载，桌面构建整树剔除）
 *
 * 与桌面启动链的差异：不装配插件体系 / Agent / weblog / 自选 SQLite 镜像，
 * 只保留 pinia（持久化）+ Vant + 移动路由；主题三轴由 MobileApp 内
 * useDocumentThemeSync 落 <html>（与桌面共用同一持久化）。
 * Vant 走全量注册 + 全量样式（移动产物独立打包，体积可接受；桌面不受影响）。
 */

/** 移动端应用装配与挂载 */
export const bootstrapMobile = (): void => {
  const app = createApp(MobileApp);

  const pinia = createPinia();
  pinia.use(piniaPluginPersistedstate);

  app.use(pinia);
  app.use(Vant);
  app.use(mobileRouter);
  app.mount('#app');
};

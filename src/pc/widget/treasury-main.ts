/**
 * 大A宝典独立窗口 · 轻量入口（2026-11-03 王总指定：气泡改独立窗口，参考盯盘小组件实现）
 *
 * 与 watch-widget-main 同思路：**刻意不装路由、不装插件内核**——宝典是纯静态文案
 * 渲染端（内容全部来自 treasury.constants 常量，无数据依赖），pinia 只为水合
 * settings store 的主题（useDocumentThemeSync 读整包 + 运行期主题事件跟随）。
 *
 * 同一入口承载两个视图（watch-widget.html?page= 同款模式，URL 参数分流）：
 * - `treasury.html`          → 弹窗视图（TreasuryWindow：轮播区 + 完整列表 + 免责）
 * - `treasury.html?view=bar` → 桌面横条视图（TreasuryBar：置顶透明小窗，轮播祖训）
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import TreasuryBar from './TreasuryBar.vue';
import TreasuryWindow from './TreasuryWindow.vue';
import '../../common/assets/styles/main.css';

const isBarView = new URLSearchParams(window.location.search).get('view') === 'bar';

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

// 横条视图是透明窗口：body 打上页面标识 id，样式层用 `body#treasury-page` 提高特异性
// 压过 theme.css 的 `body { background-color }`，保证整页透出桌面（watch-widget-page 同款
// 手法，普通 `body` 选择器实测压不住）；弹窗视图非透明，不打 id
if (isBarView) {
  document.body.id = 'treasury-page';
}

// 独立 app 实例不经 MainLayout，主题由视图组件 setup 内的
// useDocumentThemeSync 落 <html>（与 WatchWidgetApp 同款模式）
createApp(isBarView ? TreasuryBar : TreasuryWindow).use(pinia).mount('#treasury');

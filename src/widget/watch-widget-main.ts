/**
 * 任务栏盯盘小组件 · 独立轻量入口
 *
 * **刻意不装插件内核、不装路由**：小组件窗口是纯渲染端，数据全部来自主窗口
 * 推送的事件；如果像 Agent 窗口那样加载完整应用，插件内核会在这里再挂一遍 ——
 * 盯盘引擎翻倍轮询、阈值提醒重复弹，全部架构约束都会被打破。
 *
 * pinia 只为水合主题设置（useDocumentThemeSync 读 settings store 的
 * 主题色 / 涨跌配色；明暗走 useDark 同款 storage 适配器），不含任何业务引擎。
 *
 * 条与气泡共用本入口，按 `?page=` 路由参数选择视图。
 */
import { createApp } from 'vue';
import { createPinia } from 'pinia';
import piniaPluginPersistedstate from 'pinia-plugin-persistedstate';
import WatchWidgetApp from './WatchWidgetApp.vue';
import WatchWidgetBar from './WatchWidgetBar.vue';
import WatchWidgetPopover from './WatchWidgetPopover.vue';
import {
  WATCH_WIDGET_BAR_ROUTE,
  WATCH_WIDGET_PAGE_PARAM,
  WATCH_WIDGET_POPOVER_ROUTE,
} from '../plugins/watch-widget/constants';
import '../assets/styles/main.css';
/** 按窗口加载地址里的路由参数选择视图（缺省回落盯盘条） */
const route =
  new URLSearchParams(window.location.search).get(WATCH_WIDGET_PAGE_PARAM) ??
  WATCH_WIDGET_BAR_ROUTE;
const view = route === WATCH_WIDGET_POPOVER_ROUTE ? WatchWidgetPopover : WatchWidgetBar;

const pinia = createPinia();
pinia.use(piniaPluginPersistedstate);

createApp(WatchWidgetApp, { view }).use(pinia).mount('#widget');

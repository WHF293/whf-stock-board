/**
 * 插件 dsh-sidebar-watch · 自选盯盘
 *
 * 演示「一句话给左侧栏加一个常驻面板」：整个能力就是一次 `ctx.sidebar.add()`，
 * 外加一条全局命令 —— 卸载插件时面板与命令会一起消失，宿主代码零改动。
 */
import SidebarWatchPanel from './SidebarWatchPanel.vue';
import { ROUTE_PATH } from '../../constants/router-meta.constants';
import type { PluginDefinition } from '../../types/plugin.types';

/** 该插件注册的面板 id（会在内核里拼成 `dsh-sidebar-watch#watch`） */
export const SIDEBAR_WATCH_PANEL_ID = 'watch';

/**
 * 自选盯盘插件定义
 */
export const sidebarWatchPlugin: PluginDefinition = {
  id: 'dsh-sidebar-watch',
  name: '自选盯盘',
  version: '1.0.0',
  description:
    '在左侧栏常驻一个自选股盯盘面板，展示前 8 只自选股的现价与涨跌幅，单击直接开右侧个股详情；另附「打开自选股页」全局快捷键。',
  author: '内置',
  apply: (ctx) => {
    ctx.sidebar.add({
      id: SIDEBAR_WATCH_PANEL_ID,
      title: '自选盯盘',
      icon: 'star',
      mode: 'inline',
      position: 'nav',
      // order 只在「插件面板之间」排序（面板统一渲染在宿主导航菜单之下）
      order: 200,
      component: SidebarWatchPanel,
    });

    ctx.command.add({
      id: 'open-watchlist',
      title: '打开自选股页',
      keys: 'Ctrl+Alt+W',
      run: () => {
        // 命令不在组件上下文里，拿不到 useRouter()，故走宿主提供的导航服务
        ctx.consume('app:navigate')?.(ROUTE_PATH.WATCHLIST);
      },
    });

    ctx.logger.info('已注册左侧栏面板与 1 条命令');
  },
};

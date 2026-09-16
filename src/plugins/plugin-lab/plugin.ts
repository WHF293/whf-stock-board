/**
 * 插件 dsh-plugin-lab · 插件工坊
 *
 * 演示「插件也能加页面和菜单」：一次 `ctx.menu.add()` 同时产出导航项与页面路由
 * （内核的菜单贡献点约定：带 `component` 就顺带注册该路径的布局子路由）。
 *
 * 页面里消费两个宿主 / 其他插件提供的服务：
 * - `kernel:runtime`（宿主提供）：内核运行时只读句柄；
 * - `note:repo`（由 dsh-quick-note 提供，可缺省）：跨插件服务消费示例。
 */
import PluginLabView from './PluginLabView.vue';
import { PLUGIN_LAB_PATH } from './constants';
import type { PluginDefinition } from '../../types/plugin.types';

/** 插件 id（其他插件想依赖本插件时使用） */
export const PLUGIN_LAB_ID = 'dsh-plugin-lab';

/**
 * 插件工坊插件定义
 */
export const pluginLabPlugin: PluginDefinition = {
  id: PLUGIN_LAB_ID,
  name: '插件工坊',
  version: '1.0.0',
  description:
    '在左侧导航新增「插件工坊」页面：查看已挂载插件、贡献点清单、生效服务与最近内核事件，用于自省插件体系。',
  author: '内置',
  apply: (ctx) => {
    ctx.menu.add({
      path: PLUGIN_LAB_PATH,
      title: '插件工坊',
      icon: 'plug',
      component: PluginLabView,
      props: {
        // 可缺省消费：速记插件被禁用时这里是 undefined，页面自行降级
        noteRepo: ctx.consume('note:repo'),
      },
    });

    ctx.logger.info('已注册「插件工坊」导航项与页面');
  },
};

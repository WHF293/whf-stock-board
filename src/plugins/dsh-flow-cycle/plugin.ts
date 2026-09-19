/**
 * 插件 dsh-flow-cycle（资金周期）
 *
 * 左侧导航新增「资金周期」页面：热点板块 × 交易日的逐日主力净流入拆解，
 * 支撑「板块资金是持续流入还是一轮游」的周期复盘（参考 coooapi.cn/cycle 的等价实现）。
 *
 * 数据链路（实测口径见 constants.ts）：东财 clist f174 排行（行业 + 概念两源合并）
 * 产出热点名单 → fflow/daykline 直连 push2his 拉逐日主力净流入 → 纯函数聚合（judge.ts）→ 只读看板。
 * 重接口（30 板块 × 1 请求）仅进入页面 / 手动刷新触发，不轮询；push2his 封禁期给出重试入口不静默。
 */
import FlowCycleView from './FlowCycleView.vue';
import {
  FLOW_CYCLE_MENU_ICON,
  FLOW_CYCLE_MENU_PATH,
  FLOW_CYCLE_MENU_TITLE,
  FLOW_CYCLE_PLUGIN_ID,
} from './constants';
import type { PluginDefinition } from '../../types/plugin.types';

/**
 * 资金周期插件定义
 */
export const flowCyclePlugin: PluginDefinition = {
  id: FLOW_CYCLE_PLUGIN_ID,
  name: '资金周期',
  version: '1.0.0',
  description:
    '左侧导航新增「资金周期」页面：热点板块（行业 + 概念，按近 10 日主力净额排名）近 5/10/20 个交易日的逐日主力净流入双向条形拆解与区间总览，看资金是持续流入还是一轮游。',
  author: '内置',
  apply: (ctx) => {
    ctx.menu.add({
      path: FLOW_CYCLE_MENU_PATH,
      title: FLOW_CYCLE_MENU_TITLE,
      icon: FLOW_CYCLE_MENU_ICON,
      component: FlowCycleView,
    });

    ctx.logger.info('已注册「资金周期」导航项与页面');
  },
};

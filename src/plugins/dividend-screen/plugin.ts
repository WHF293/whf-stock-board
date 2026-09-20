/**
 * 插件 dsh-dividend-screen（股息筛选）
 *
 * 左侧导航新增「股息筛选」页面：市面股息排行的 TTM 口径只反映「过去派了多少」，
 * 本插件在同一张表上叠加**今年推算**——以今年中报 ÷ 去年中报的净利比作全年增长系数、
 * 保留去年分红率，推算「维持分红习惯下的今年股息率」。
 *
 * 数据落地：`ctx.db` 两张插件表（`screen_rows` / `scan_meta`），
 * 扫描一次后重进页面只读库渲染、零联网（避免重复查询触发上游限速）；
 * 重接口只在用户点击「扫描排行」时触发。
 */
import DividendColumnSettings from './DividendColumnSettings.vue';
import DividendScreenView from './DividendScreenView.vue';
import {
  DIVIDEND_MENU_ICON,
  DIVIDEND_MENU_PATH,
  DIVIDEND_MENU_TITLE,
  DIVIDEND_PLUGIN_ID,
} from './constants';
import { createDividendRepo } from './storage';
import type { PluginDefinition } from '../../types/plugin.types';

/**
 * 股息筛选插件定义
 */
export const dividendScreenPlugin: PluginDefinition = {
  id: DIVIDEND_PLUGIN_ID,
  name: '股息筛选',
  version: '1.0.0',
  description:
    '左侧导航新增「股息筛选」看板：TTM 股息率排行（东财口径）+ 保留去年分红率、按中报净利增速推算今年股息率；结果落本地插件库，重进页面不联网。',
  author: '内置',
  settings: {
    title: '表格列配置',
    description: '控制结果表格显示哪些列、按什么顺序显示；改动对两个 tab 即时生效。',
    component: DividendColumnSettings,
  },
  apply: async (ctx) => {
    // 建表 + 水合快照完成后才注册页面（页面首屏即可直接读库渲染）
    const repo = await createDividendRepo(ctx.db);

    // 能力对外公开：其他插件 consume('dividend:repo') 即可读同一份快照
    ctx.provide('dividend:repo', repo);

    // 宿主通用搜索服务（自选 tab 搜个股加自选用）；服务缺席时页面自动隐藏搜索入口
    const stockSearch = ctx.consume('app:stock-search');

    ctx.menu.add({
      path: DIVIDEND_MENU_PATH,
      title: DIVIDEND_MENU_TITLE,
      icon: DIVIDEND_MENU_ICON,
      component: DividendScreenView,
      props: { repo, stockSearch, settings: ctx.settings },
    });

    ctx.logger.info('已注册「股息筛选」导航项与看板页面');
  },
};

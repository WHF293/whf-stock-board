/**
 * 插件 dsh-sidebar-watch · 自选盯盘
 *
 * 一个插件同时演示四件事：
 * - **通用数据层**：盯盘候选（含阈值规则）落在本插件独立表
 *   `plugin_dsh_sidebar_watch_watch_candidates`（`ctx.db`，Tauri 端 SQLite / 浏览器端本地仿真），
 *   插件永不直接写 SQL；
 * - **行操作贡献**：`ctx.stockRow` 往自选股表格「操作」列注入「盯盘」开关按钮，
 *   宿主不硬编码本插件（只按注册表渲染图标 / 文案 / 激活态）；
 * - **服务贡献**：`ctx.provide('watch:repo', …)`，其他插件可复用同一份候选池；
 * - **宿主服务消费**：`ctx.consume('app:notify')` 弹右侧浮窗，做阈值到价提醒。
 *
 * 盯盘引擎（取报价 + 判阈值 + 弹提醒）跑在插件层而不是面板组件里，
 * 所以面板折叠、侧栏收起都不影响提醒（见 monitor.ts 的说明）。
 * 卸载插件时，面板 / 行操作按钮 / 命令 / 服务 / 引擎一起消失，宿主代码零改动。
 */
import SidebarWatchPanel from './SidebarWatchPanel.vue';
import { createWatchCandidateRepo } from './service';
import { createWatchMonitor } from './monitor';
import { ROUTE_PATH } from '../../constants/router-meta.constants';
import {
  STOCK_ROW_ACTION_ACTIVE_TITLE,
  STOCK_ROW_ACTION_ICON,
  STOCK_ROW_ACTION_ID,
  STOCK_ROW_ACTION_TITLE,
} from './constants';
import type { PluginDefinition } from '../../types/plugin.types';

/** 该插件注册的面板 id（会在内核里拼成 `dsh-sidebar-watch#watch`） */
export const SIDEBAR_WATCH_PANEL_ID = 'watch';

/**
 * 自选盯盘插件定义
 */
export const sidebarWatchPlugin: PluginDefinition = {
  id: 'dsh-sidebar-watch',
  name: '自选盯盘',
  version: '1.2.0',
  description:
    '左侧栏常驻盯盘清单：在自选股「操作」列点「盯盘」逐只加入候选（候选与阈值存在插件自己的数据表里），可给每只票设价格 / 涨跌幅阈值，到价在右下角弹提醒；单击候选直接开右侧个股详情；另附「打开自选股页」全局快捷键。',
  author: '内置',
  apply: async (ctx) => {
    // 建表 + 水合完成后才注册贡献点：面板与行操作按钮都依赖仓储已就绪
    const repo = await createWatchCandidateRepo(ctx.db);

    // 能力对外公开：其他插件 consume('watch:repo') 即可读写同一份候选池
    ctx.provide('watch:repo', repo);

    // 浮窗服务由宿主提供；缺失时不阻断插件（引擎会降级为只记日志）
    const notify = ctx.consume('app:notify');
    if (!notify) {
      ctx.logger.warn('宿主未提供 app:notify 服务，阈值提醒只在日志里体现');
    }

    const monitor = createWatchMonitor({ repo, notify, logger: ctx.logger });
    // 引擎不在组件里，生命周期挂在插件上：卸载即停轮询、并清掉自己弹过的浮窗
    ctx.onDispose(() => monitor.stop());

    ctx.sidebar.add({
      id: SIDEBAR_WATCH_PANEL_ID,
      title: '自选盯盘',
      icon: 'star',
      mode: 'inline',
      position: 'nav',
      // order 只在「插件面板之间」排序（面板统一渲染在宿主导航菜单之下）
      order: 200,
      component: SidebarWatchPanel,
      props: { repo, monitor },
    });

    // 自选股表格「操作」列的「盯盘」开关（开关型动作：未加入 = 加入，已加入 = 移出）
    ctx.stockRow.add({
      id: STOCK_ROW_ACTION_ID,
      title: STOCK_ROW_ACTION_TITLE,
      activeTitle: STOCK_ROW_ACTION_ACTIVE_TITLE,
      icon: STOCK_ROW_ACTION_ICON,
      isActive: (row) => repo.has(row.symbol),
      run: (row) => {
        repo.toggle(row.symbol, row.name);
      },
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

    ctx.logger.info('已注册左侧栏面板、行操作、watch:repo 服务、盯盘引擎与 1 条命令');
  },
};

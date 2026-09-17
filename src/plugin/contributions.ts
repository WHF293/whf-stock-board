/**
 * 贡献点注册表（对标 dsh 的「能力即插件」：UI / 工具 / 存储都由插件贡献）
 *
 * 本文件把「插件能扩展什么」收敛成八个注册表：
 * - `sidebar`  左侧栏面板（inline 常驻面板 / drawer 入口面板）
 * - `menu`     左侧导航菜单项（带 component 时同时产出页面路由）
 * - `routes`   不进菜单的路由（隐藏页 / 独立窗口页）
 * - `dock`     右侧停靠面板
 * - `commands` 可挂全局快捷键的命令
 * - `stockRows` 股票行操作（自选股表格操作列注入按钮）
 * - `stockDetail` 个股详情扩展区（个股详情面板底部注入插件区块）
 * - `agent`    内置 MCP 服务器（把插件能力暴露给 Agent）
 *
 * 注册表本身是 Vue 响应式的（`shallowReactive` 数组）：插件挂载 / 卸载时
 * 宿主布局（MainLayout / DockPanel）自动增删对应 UI，不需要手动刷新。
 * 内核因此与 Vue 有唯一一处耦合，这是本应用「宿主即 Vue」的合理代价。
 */
import { markRaw, ref, shallowReactive } from 'vue';
import {
  MENU_ITEM_ORDER_DEFAULT,
  SIDEBAR_PANEL_MODE_DEFAULT,
  SIDEBAR_PANEL_ORDER_DEFAULT,
  SIDEBAR_PANEL_POSITION_DEFAULT,
  SIDEBAR_PANEL_VISIBLE_WHEN_COLLAPSED_DEFAULT,
  STOCK_DETAIL_SECTION_ORDER_DEFAULT,
  STOCK_ROW_ACTION_ORDER_DEFAULT,
} from '../constants/plugin.constants';
import { createDisposable } from './disposable';
import type { PluginEventBus } from './events';
import type { DisposableBag } from './disposable';
import type {
  AgentContributor,
  CommandContribution,
  CommandContributor,
  Disposable,
  DockContributor,
  DockPanelContribution,
  MenuContributor,
  MenuItemContribution,
  PluginContributionCount,
  RegisteredCommand,
  RegisteredDockPanel,
  RegisteredMenuItem,
  RegisteredRoute,
  RegisteredSidebarPanel,
  RegisteredStockDetailSection,
  RegisteredStockRowAction,
  RouteContribution,
  RouterContributor,
  SidebarContributor,
  SidebarPanelContribution,
  StockDetailContributor,
  StockDetailSectionContribution,
  StockRowActionContribution,
  StockRowContributor,
} from '../types/plugin.types';
import type { BuiltinMcpServer } from '../agent/mcp/types';

/**
 * 把多个撤销句柄合成一个（任一环节回滚都能整体撤销）
 * @param items 撤销句柄列表
 * @returns 合并后的撤销句柄
 */
const combineDisposables = (items: readonly Disposable[]): Disposable =>
  createDisposable(() => {
    for (const item of items) item.dispose();
  });

/**
 * 取排序后的插入位置：在最后一个 `order <= 目标 order` 的条目之后插入
 *
 * 这样数组恒为按 order 升序、且同 order 保持注册先后（稳定排序的等价实现），
 * 宿主直接 `v-for` 即可，无需每次渲染重新排序。
 * @param items 已排序的条目数组
 * @param order 目标排序权重
 * @returns 应插入的下标
 */
const resolveInsertIndex = <T extends { order: number }>(
  items: readonly T[],
  order: number,
): number => {
  let index = items.length;
  while (index > 0 && items[index - 1].order > order) index -= 1;
  return index;
};

/**
 * 左侧栏面板注册表（按 order 排序的响应式数组）
 */
export class SidebarRegistry {
  /** 已注册的侧栏面板（按 order 升序，同 order 按注册先后） */
  readonly panels = shallowReactive<RegisteredSidebarPanel[]>([]);

  /**
   * 注册一个侧栏面板
   * @param pluginId 归属插件 id
   * @param panel 面板声明
   * @returns 撤销句柄
   */
  add(pluginId: string, panel: SidebarPanelContribution): Disposable {
    const order = panel.order ?? SIDEBAR_PANEL_ORDER_DEFAULT;
    const record: RegisteredSidebarPanel = {
      key: `${pluginId}#${panel.id}`,
      pluginId,
      id: panel.id,
      title: panel.title,
      icon: panel.icon ?? '',
      mode: panel.mode ?? SIDEBAR_PANEL_MODE_DEFAULT,
      position: panel.position ?? SIDEBAR_PANEL_POSITION_DEFAULT,
      order,
      component: markRaw(panel.component),
      props: panel.props ?? {},
      visibleWhenCollapsed:
        panel.visibleWhenCollapsed ?? SIDEBAR_PANEL_VISIBLE_WHEN_COLLAPSED_DEFAULT,
    };
    const key = record.key;
    const removeExisting = this.panels.findIndex((item) => item.key === key);
    if (removeExisting >= 0) this.panels.splice(removeExisting, 1);
    this.panels.splice(resolveInsertIndex(this.panels, order), 0, record);
    return createDisposable(() => {
      const index = this.panels.findIndex((item) => item.key === key);
      if (index >= 0) this.panels.splice(index, 1);
    });
  }
}

/** 左侧导航菜单注册表 */
export class MenuRegistry {
  /** 已注册的菜单项（按 order 升序） */
  readonly items = shallowReactive<RegisteredMenuItem[]>([]);

  /**
   * 注册一个菜单项
   * @param pluginId 归属插件 id
   * @param item 菜单声明
   * @returns 撤销句柄
   */
  add(pluginId: string, item: MenuItemContribution): Disposable {
    const order = item.order ?? MENU_ITEM_ORDER_DEFAULT;
    const record: RegisteredMenuItem = {
      ...item,
      key: `${pluginId}#${item.path}`,
      pluginId,
      icon: item.icon,
      order,
    };
    const key = record.key;
    const existing = this.items.findIndex((entry) => entry.key === key);
    if (existing >= 0) this.items.splice(existing, 1);
    this.items.splice(resolveInsertIndex(this.items, order), 0, record);
    return createDisposable(() => {
      const index = this.items.findIndex((entry) => entry.key === key);
      if (index >= 0) this.items.splice(index, 1);
    });
  }
}

/** 路由注册表（不含排序语义，顺序即注册先后） */
export class RouteRegistry {
  /** 已注册的插件路由 */
  readonly routes = shallowReactive<RegisteredRoute[]>([]);

  /**
   * 版本号：每次增删自增
   *
   * 路由的增删在宿主侧是「调用 router.addRoute / 撤销函数」的副作用，
   * 数组本身被同长度替换时 watch 不易察觉，用显式版本号驱动同步最稳。
   */
  readonly version = ref(0);

  /**
   * 注册一条路由
   * @param pluginId 归属插件 id
   * @param route 路由声明
   * @returns 撤销句柄
   */
  add(pluginId: string, route: RouteContribution): Disposable {
    const record: RegisteredRoute = {
      ...route,
      key: `${pluginId}#${route.path}`,
      pluginId,
      underLayout: route.underLayout ?? true,
    };
    const existing = this.routes.findIndex((item) => item.key === record.key);
    if (existing >= 0) this.routes.splice(existing, 1);
    this.routes.push(record);
    this.version.value += 1;
    return createDisposable(() => {
      const index = this.routes.findIndex((item) => item.key === record.key);
      if (index >= 0) this.routes.splice(index, 1);
      this.version.value += 1;
    });
  }
}

/** 右侧停靠面板注册表 */
export class DockRegistry {
  /** 已注册的停靠面板 */
  readonly panels = shallowReactive<RegisteredDockPanel[]>([]);

  /**
   * 注册一个停靠面板
   * @param pluginId 归属插件 id
   * @param panel 面板声明
   * @returns 撤销句柄
   */
  add(pluginId: string, panel: DockPanelContribution): Disposable {
    const record: RegisteredDockPanel = {
      ...panel,
      props: panel.props ?? {},
      key: `${pluginId}#${panel.id}`,
      pluginId,
    };
    const existing = this.panels.findIndex((item) => item.key === record.key);
    if (existing >= 0) this.panels.splice(existing, 1);
    this.panels.push(record);
    return createDisposable(() => {
      const index = this.panels.findIndex((item) => item.key === record.key);
      if (index >= 0) this.panels.splice(index, 1);
    });
  }
}

/** 股票行操作注册表（自选股等表格的「操作」列由插件注入按钮） */
export class StockRowRegistry {
  /** 已注册的行操作（按 order 升序，同 order 按注册先后） */
  readonly actions = shallowReactive<RegisteredStockRowAction[]>([]);

  /**
   * 注册一个股票行操作
   * @param pluginId 归属插件 id
   * @param action 动作声明
   * @returns 撤销句柄
   */
  add(pluginId: string, action: StockRowActionContribution): Disposable {
    const order = action.order ?? STOCK_ROW_ACTION_ORDER_DEFAULT;
    const record: RegisteredStockRowAction = {
      key: `${pluginId}#${action.id}`,
      pluginId,
      id: action.id,
      title: action.title,
      activeTitle: action.activeTitle ?? action.title,
      icon: action.icon,
      order,
      // 缺省判定恒为「未激活」：宿主渲染时无需再判空
      isActive: action.isActive ?? ((): boolean => false),
      run: action.run,
    };
    const key = record.key;
    const existing = this.actions.findIndex((item) => item.key === key);
    if (existing >= 0) this.actions.splice(existing, 1);
    this.actions.splice(resolveInsertIndex(this.actions, order), 0, record);
    return createDisposable(() => {
      const index = this.actions.findIndex((item) => item.key === key);
      if (index >= 0) this.actions.splice(index, 1);
    });
  }
}

/** 个股详情扩展区注册表（个股详情面板底部的插件区块） */
export class StockDetailRegistry {
  /** 已注册的扩展区块（按 order 升序，同 order 按注册先后） */
  readonly sections = shallowReactive<RegisteredStockDetailSection[]>([]);

  /**
   * 注册一个个股详情扩展区块
   * @param pluginId 归属插件 id
   * @param section 区块声明
   * @returns 撤销句柄
   */
  add(pluginId: string, section: StockDetailSectionContribution): Disposable {
    const order = section.order ?? STOCK_DETAIL_SECTION_ORDER_DEFAULT;
    const record: RegisteredStockDetailSection = {
      key: `${pluginId}#${section.id}`,
      pluginId,
      id: section.id,
      title: section.title,
      order,
      component: markRaw(section.component),
      props: section.props ?? {},
    };
    const key = record.key;
    const existing = this.sections.findIndex((item) => item.key === key);
    if (existing >= 0) this.sections.splice(existing, 1);
    this.sections.splice(resolveInsertIndex(this.sections, order), 0, record);
    return createDisposable(() => {
      const index = this.sections.findIndex((item) => item.key === key);
      if (index >= 0) this.sections.splice(index, 1);
    });
  }
}

/** 命令注册表 */
export class CommandRegistry {
  /** 已注册的命令 */
  readonly commands = shallowReactive<RegisteredCommand[]>([]);

  /**
   * 注册一个命令
   * @param pluginId 归属插件 id
   * @param command 命令声明
   * @returns 撤销句柄
   */
  add(pluginId: string, command: CommandContribution): Disposable {
    const record: RegisteredCommand = {
      ...command,
      key: `${pluginId}#${command.id}`,
      pluginId,
    };
    const existing = this.commands.findIndex((item) => item.key === record.key);
    if (existing >= 0) this.commands.splice(existing, 1);
    this.commands.push(record);
    return createDisposable(() => {
      const index = this.commands.findIndex((item) => item.key === record.key);
      if (index >= 0) this.commands.splice(index, 1);
    });
  }
}

/** Agent 工具注册表（内置 MCP 服务器） */
export class AgentRegistry {
  /** 插件提供的内置 MCP 服务器 */
  readonly servers = shallowReactive<BuiltinMcpServer[]>([]);

  /**
   * server key → 提供它的插件 id
   *
   * 服务器对象本身不带 pluginId（它要原样交给 MCP 运行时），归属关系单独记账。
   */
  private readonly owners = new Map<string, string>();

  /**
   * 注册一台内置 MCP 服务器
   * @param pluginId 归属插件 id
   * @param server 服务器声明
   * @returns 撤销句柄
   */
  addServer(pluginId: string, server: BuiltinMcpServer): Disposable {
    const existing = this.servers.findIndex((item) => item.key === server.key);
    if (existing >= 0) this.servers.splice(existing, 1);
    this.servers.push(server);
    this.owners.set(server.key, pluginId);
    return createDisposable(() => {
      const index = this.servers.findIndex((item) => item.key === server.key);
      if (index >= 0) this.servers.splice(index, 1);
      this.owners.delete(server.key);
    });
  }

  /**
   * 统计某插件贡献的 MCP 服务器数量
   * @param pluginId 插件 id
   * @returns 服务器数量
   */
  countFor(pluginId: string): number {
    let total = 0;
    for (const owner of this.owners.values()) {
      if (owner === pluginId) total += 1;
    }
    return total;
  }
}

/** 单个插件可用的贡献点写入器集合（由内核为每次挂载创建） */
export interface PluginContributorSet {
  /** 左侧栏面板贡献点 */
  sidebar: SidebarContributor;
  /** 左侧导航菜单贡献点 */
  menu: MenuContributor;
  /** 路由贡献点 */
  router: RouterContributor;
  /** 右侧停靠面板贡献点 */
  dock: DockContributor;
  /** 命令贡献点 */
  command: CommandContributor;
  /** 股票行操作贡献点 */
  stockRow: StockRowContributor;
  /** 个股详情扩展区贡献点 */
  stockDetail: StockDetailContributor;
  /** Agent 工具贡献点 */
  agent: AgentContributor;
}

/** 全部贡献点注册表的聚合容器 */
export class PluginContributions {
  /** 左侧栏面板 */
  readonly sidebar = new SidebarRegistry();
  /** 左侧导航菜单 */
  readonly menu = new MenuRegistry();
  /** 隐藏路由 */
  readonly routes = new RouteRegistry();
  /** 右侧停靠面板 */
  readonly dock = new DockRegistry();
  /** 命令 */
  readonly commands = new CommandRegistry();
  /** 股票行操作（表格操作列注入按钮） */
  readonly stockRows = new StockRowRegistry();
  /** 个股详情扩展区 */
  readonly stockDetail = new StockDetailRegistry();
  /** Agent 工具 */
  readonly agent = new AgentRegistry();

  /** 事件总线（侧栏面板变化时对外广播 `sidebar:changed`） */
  private readonly events: PluginEventBus;

  /**
   * @param events 事件总线
   */
  constructor(events: PluginEventBus) {
    this.events = events;
  }

  /**
   * 为某次插件挂载创建贡献点写入器（注册结果自动进副作用袋）
   * @param pluginId 插件 id
   * @param bag 该插件的副作用袋
   * @returns 六个贡献点写入器
   */
  createWriters(pluginId: string, bag: DisposableBag): PluginContributorSet {
    return {
      sidebar: {
        add: (panel) => {
          const disposable = bag.add(this.sidebar.add(pluginId, panel));
          this.events.emit('sidebar:changed', [this.sidebar.panels], pluginId);
          return disposable;
        },
      },
      menu: {
        add: (item) => {
          // 带 component 的菜单项同时产出页面路由：插件作者只声明一次
          const owned: Disposable[] = [this.menu.add(pluginId, item)];
          if (item.component) {
            owned.push(
              this.routes.add(pluginId, {
                path: item.path,
                component: item.component,
                props: item.props,
                meta: { title: item.title },
              }),
            );
          }
          return bag.add(combineDisposables(owned));
        },
      },
      router: {
        add: (route) => bag.add(this.routes.add(pluginId, route)),
      },
      dock: {
        add: (panel) => bag.add(this.dock.add(pluginId, panel)),
      },
      command: {
        add: (command) => bag.add(this.commands.add(pluginId, command)),
      },
      stockRow: {
        add: (action) => bag.add(this.stockRows.add(pluginId, action)),
      },
      stockDetail: {
        add: (section) => bag.add(this.stockDetail.add(pluginId, section)),
      },
      agent: {
        addServer: (server) => bag.add(this.agent.addServer(pluginId, server)),
      },
    };
  }

  /**
   * 统计某插件的贡献点数量（插件管理弹窗 / 插件工坊展示）
   * @param pluginId 插件 id
   * @returns 各贡献点计数
   */
  countFor(pluginId: string): PluginContributionCount {
    const count = <T extends { pluginId: string }>(items: readonly T[]): number =>
      items.filter((item) => item.pluginId === pluginId).length;
    return {
      sidebarPanels: count(this.sidebar.panels),
      menuItems: count(this.menu.items),
      routes: count(this.routes.routes),
      dockPanels: count(this.dock.panels),
      commands: count(this.commands.commands),
      stockRowActions: count(this.stockRows.actions),
      stockDetailSections: count(this.stockDetail.sections),
      agentServers: this.agent.countFor(pluginId),
    };
  }

  /** 清空全部贡献（仅内核整体重置时调用） */
  clear(): void {
    this.sidebar.panels.length = 0;
    this.menu.items.length = 0;
    this.routes.routes.length = 0;
    this.dock.panels.length = 0;
    this.commands.commands.length = 0;
    this.stockRows.actions.length = 0;
    this.stockDetail.sections.length = 0;
    this.agent.servers.length = 0;
  }}

/**
 * 插件上下文实现（插件与内核之间的唯一接口）
 *
 * 每次 `apply(ctx)` 拿到的 ctx 都是**该插件专属**的：它绑定了插件 id、配置、
 * 副作用袋与日志前缀，因此插件内部任何注册都会自动归属到这一次挂载，
 * 卸载时被一并撤销。
 */
import { PLUGIN_LOG_PREFIX, PLUGIN_STORAGE_NAMESPACE_PREFIX } from '../constants/plugin.constants';
import { appStorage } from '../utils/app-local-storage';
import {
  loadPluginStorage,
  savePluginStorageEntry,
  deletePluginStorageEntry,
} from '../api/plugin-storage-db.api';
import { createDisposable } from './disposable';
import { createPluginDatabase } from './database';
import type { DisposableBag } from './disposable';
import type { PluginEventBus } from './events';
import type { PluginServiceContainer } from './services';
import type { PluginContributorSet } from './contributions';
import type {
  AppEventMap,
  AppServiceMap,
  Disposable,
  PluginConfig,
  PluginContext,
  PluginDatabase,
  PluginLogger,
  PluginStorage,
} from '../types/plugin.types';

/**
 * 创建按插件隔离的持久化句柄
 *
 * 双通道：localStorage（`whf:app` 整包的 `plugin:<id>` 命名空间）即时读写保证两端可用，
 * Tauri 端异步镜像进 SQLite（plugin_storage 表）并在启动时覆盖水合。
 * 插件之间互不可见，卸载插件时数据保留（用户重装插件后能接着用）；
 * 插件永远不直接访问 SQL —— 本 API 就是宿主提供给插件的数据持久化通道。
 * @param pluginId 插件 id
 * @returns 插件自有存储
 */
const createPluginStorage = (pluginId: string): PluginStorage => {
  const namespace = `${PLUGIN_STORAGE_NAMESPACE_PREFIX}${pluginId}`;

  /**
   * 读出该插件的整包数据
   * @returns 键值对象（损坏时返回空对象）
   */
  const readAll = (): Record<string, unknown> => {
    const raw = appStorage.getItem(namespace);
    if (!raw) return {};
    try {
      const parsed: unknown = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch (error) {
      console.error(`${PLUGIN_LOG_PREFIX} ${pluginId} 持久化数据损坏，已重置`, error);
      return {};
    }
  };

  /**
   * 回写该插件的整包数据
   * @param value 键值对象
   */
  const writeAll = (value: Record<string, unknown>): void => {
    appStorage.setItem(namespace, JSON.stringify(value));
  };

  // Tauri 端镜像：启动时以 SQLite 覆盖水合，之后每次写操作异步镜像进 plugin_storage 表。
  // 插件只经本 API 存取，永不直接访问 SQL —— 这是宿主提供的数据 API（架构约定，见 AGENTS.md）
  void (async (): Promise<void> => {
    const mirrored = await loadPluginStorage(pluginId);
    if (!mirrored || Object.keys(mirrored).length === 0) return;
    const merged = { ...readAll(), ...mirrored };
    writeAll(merged);
  })();

  return {
    get: <T>(key: string, fallback: T): T => {
      const all = readAll();
      return Object.prototype.hasOwnProperty.call(all, key) ? (all[key] as T) : fallback;
    },
    set: (key: string, value: unknown): void => {
      const all = readAll();
      all[key] = value;
      writeAll(all);
      void savePluginStorageEntry(pluginId, key, JSON.stringify(value));
    },
    remove: (key: string): void => {
      const all = readAll();
      delete all[key];
      writeAll(all);
      void deletePluginStorageEntry(pluginId, key);
    },
  };
};

/**
 * 创建带插件前缀的日志器
 *
 * 前缀固定 `[plugin:<id>] [级别]`，便于在系统日志页按关键字筛出某个插件的输出。
 * 三个级别都走 `console.warn` / `console.error`：项目 ESLint 卡口禁 `console.log`
 * （`no-console` 只放行 warn / error），级别由前缀区分。
 * @param pluginId 插件 id
 * @returns 日志器
 */
const createLogger = (pluginId: string): PluginLogger => {
  const prefix = `${PLUGIN_LOG_PREFIX} ${pluginId}`;
  return {
    info: (message: string, ...args: unknown[]): void =>
      console.warn(`${prefix} [info] ${message}`, ...args),
    warn: (message: string, ...args: unknown[]): void =>
      console.warn(`${prefix} [warn] ${message}`, ...args),
    error: (message: string, ...args: unknown[]): void =>
      console.error(`${prefix} [error] ${message}`, ...args),
  };
};

/** 插件上下文实现 */
export class PluginContextImpl implements PluginContext {
  /** 当前插件 id */
  readonly pluginId: string;

  /** 当前插件配置（只读） */
  readonly config: PluginConfig;

  /** 插件自有持久化 */
  readonly storage: PluginStorage;

  /** 插件通用数据库（每插件独立表，插件永不直接访问 SQL） */
  readonly db: PluginDatabase;

  /** 插件日志器 */
  readonly logger: PluginLogger;

  /** 该插件的副作用袋 */
  private readonly bag: DisposableBag;

  /** 事件总线 */
  private readonly events: PluginEventBus;

  /** 服务容器 */
  private readonly services: PluginServiceContainer;

  /** 该插件的贡献点写入器集合 */
  private readonly contributions: PluginContributorSet;

  /**
   * @param pluginId 插件 id
   * @param config 插件配置
   * @param bag 该插件的副作用袋
   * @param events 事件总线
   * @param services 服务容器
   * @param contributions 贡献点写入器集合
   */
  constructor(
    pluginId: string,
    config: PluginConfig,
    bag: DisposableBag,
    events: PluginEventBus,
    services: PluginServiceContainer,
    contributions: PluginContributorSet,
  ) {
    this.pluginId = pluginId;
    this.config = config;
    this.bag = bag;
    this.events = events;
    this.services = services;
    this.contributions = contributions;
    this.storage = createPluginStorage(pluginId);
    this.db = createPluginDatabase(pluginId);
    this.logger = createLogger(pluginId);
  }

  /**
   * 左侧栏面板贡献点
   * @returns 左侧栏面板贡献点
   */
  get sidebar(): PluginContributorSet['sidebar'] {
    return this.contributions.sidebar;
  }

  /**
   * 顶栏条目贡献点
   * @returns 顶栏条目贡献点
   */
  get header(): PluginContributorSet['header'] {
    return this.contributions.header;
  }

  /**
   * 左侧导航菜单贡献点
   * @returns 左侧导航菜单贡献点
   */
  get menu(): PluginContributorSet['menu'] {
    return this.contributions.menu;
  }

  /**
   * 路由贡献点
   * @returns 路由贡献点
   */
  get router(): PluginContributorSet['router'] {
    return this.contributions.router;
  }

  /**
   * 右侧停靠面板贡献点
   * @returns 右侧停靠面板贡献点
   */
  get dock(): PluginContributorSet['dock'] {
    return this.contributions.dock;
  }

  /**
   * 命令贡献点
   * @returns 命令贡献点
   */
  get command(): PluginContributorSet['command'] {
    return this.contributions.command;
  }

  /**
   * 股票行操作贡献点
   * @returns 股票行操作贡献点
   */
  get stockRow(): PluginContributorSet['stockRow'] {
    return this.contributions.stockRow;
  }

  /**
   * 个股详情扩展区贡献点
   * @returns 个股详情扩展区贡献点
   */
  get stockDetail(): PluginContributorSet['stockDetail'] {
    return this.contributions.stockDetail;
  }

  /**
   * Agent 工具贡献点
   * @returns Agent 工具贡献点
   */
  get agent(): PluginContributorSet['agent'] {
    return this.contributions.agent;
  }

  /**
   * 执行一次带清理的副作用（立即执行，卸载时回调清理函数）
   * @param effect 副作用函数，可返回清理函数
   * @returns 撤销句柄
   */
  effect(effect: () => void | (() => void)): Disposable {
    const cleanup = effect();
    if (typeof cleanup !== 'function') return createDisposable(() => undefined);
    return this.bag.add(createDisposable(cleanup));
  }

  /**
   * 注册「插件卸载时执行」的回调（不立即执行）
   * @param listener 卸载回调
   */
  onDispose(listener: () => void): void {
    this.bag.add(createDisposable(listener));
  }

  /**
   * 贡献一个服务
   * @param name 服务名
   * @param impl 服务实现
   */
  provide<K extends keyof AppServiceMap>(name: K, impl: AppServiceMap[K]): void {
    this.bag.add(this.services.provide(name, impl));
  }

  /**
   * 注入一个服务
   * @param name 服务名
   * @returns 服务实现；未提供时 undefined
   */
  consume<K extends keyof AppServiceMap>(name: K): AppServiceMap[K] | undefined {
    return this.services.consume(name);
  }

  /**
   * 订阅事件
   * @param name 事件名
   * @param handler 处理函数
   * @returns 取消订阅句柄
   */
  on<K extends keyof AppEventMap>(
    name: K,
    handler: (...args: AppEventMap[K]) => void,
  ): Disposable;
  on(name: string, handler: (...args: unknown[]) => void): Disposable;
  on(name: string, handler: (...args: never[]) => void): Disposable {
    return this.bag.add(
      this.events.on(name, handler as (...args: unknown[]) => void),
    );
  }

  /**
   * 广播事件（自动带上当前插件 id 作为来源）
   * @param name 事件名
   * @param args 事件参数
   */
  emit(name: string, ...args: unknown[]): void {
    this.events.emit(name, args, this.pluginId);
  }
}

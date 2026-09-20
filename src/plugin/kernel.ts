/**
 * 插件内核（对标 dsh 的 Cordis Kernel）
 *
 * 内核**不承载任何业务能力**，只做四件事：
 * 1. 注册插件定义（`use` / `unuse`）；
 * 2. 按 `inject` 声明的依赖关系决定挂载顺序与等待关系（`settle` 收敛到不动点）；
 * 3. 挂载时创建插件上下文、卸载时撤销该插件的全部副作用（可逆副作用）；
 * 4. 广播插件生命周期事件，并维护可自省的运行时快照。
 *
 * 因此「新增一个能力」的方式永远是**写一个插件**，而不是给内核打补丁。
 */
import {
  PLUGIN_DISABLED_BY_DEFAULT,
  PLUGIN_ORIGIN,
  PLUGIN_STATUS,
  USER_PLUGIN_AUTHOR_LABEL,
} from '../constants/plugin.constants';
import { ref } from 'vue';
import { DisposableBag } from './disposable';
import { PluginEventBus } from './events';
import { PluginServiceContainer } from './services';
import { PluginContributions } from './contributions';
import { PluginContextImpl } from './context';
import type {
  PluginConfig,
  PluginDefinition,
  PluginOrigin,
  PluginRuntimeInfo,
  PluginRuntimeReader,
  PluginSettingsDeclaration,
  PluginSettingsStore,
  PluginStatus,
} from '../types/plugin.types';

/** 内核中的插件条目 */
interface PluginEntry {
  /** 插件定义 */
  definition: PluginDefinition;
  /** 用户是否启用（由宿主持久化状态驱动） */
  enabled: boolean;
  /** 插件来源（决定运行时信息里的 builtin 标记与管理弹窗能否卸载） */
  origin: PluginOrigin;
  /** 当前运行时状态 */
  status: PluginStatus;
  /** 本次挂载的副作用袋（未挂载时为空袋） */
  bag: DisposableBag;
  /** 已累计撤销的副作用数量（诊断用） */
  disposedEffects: number;
  /** 挂载失败原因 */
  error: string;
  /** 本次挂载的设置存取句柄（仅挂载成功后存在；宿主设置弹窗经此读写） */
  settingsStore?: PluginSettingsStore | undefined;
}

/** 设置弹窗用的插件设置条目（已挂载且声明了 settings 的插件） */
export interface PluginSettingsEntry {
  /** 插件 id */
  id: string;
  /** 插件名 */
  name: string;
  /** 设置声明（清单 settings 字段） */
  declaration: PluginSettingsDeclaration;
  /** 设置存取句柄 */
  store: PluginSettingsStore;
}

/** 挂载选项 */
export interface PluginMountOptions {
  /** 是否启用（缺省 true；持久化黑名单交给宿主判定后传入） */
  enabled?: boolean;
  /** 插件来源（缺省内置；应用内安装的用户插件传 `user`） */
  origin?: PluginOrigin;
}

/**
 * 插件内核
 *
 * 典型用法：
 * ```ts
 * kernel.use(myPlugin);
 * kernel.setEnabled('my-plugin', false); // 用户在设置页关掉
 * ```
 */
export class PluginKernel {
  /** 事件总线（类型化事件） */
  readonly events = new PluginEventBus();

  /** 服务容器（provide / consume） */
  readonly services = new PluginServiceContainer();

  /** 贡献点注册表（UI / 路由 / 命令 / Agent 工具） */
  readonly contributions = new PluginContributions(this.events);

  /** 插件条目表（id → 条目） */
  private readonly entries = new Map<string, PluginEntry>();

  /** 收敛循环重入标记（true 表示正在收敛，内层 settle 直接返回） */
  private settling = false;

  /**
   * 状态版本号：任何插件状态变化后自增
   *
   * 内核本身不依赖 Vue，但宿主需要「插件列表变了」这个信号来刷新 UI
   * （插件管理弹窗、插件工坊）。用一个显式版本号比让内核深度响应式更可控。
   */
  readonly revision = ref(0);

  /** 标记状态已变化，唤醒宿主的响应式计算 */
  private bumpRevision(): void {
    this.revision.value += 1;
  }

  /**
   * 注册（并尝试挂载）一个插件
   *
   * 重复注册同 id 会以**后注册者为准**（先卸载旧定义再挂载新的），
   * 便于开发期热替换实现。
   * @param definition 插件定义
   * @param options 挂载选项
   * @returns 无
   */
  use(definition: PluginDefinition, options: PluginMountOptions = {}): void {
    if (this.entries.has(definition.id)) {
      this.unuse(definition.id);
    }
    this.entries.set(definition.id, {
      definition,
      enabled: options.enabled ?? !PLUGIN_DISABLED_BY_DEFAULT,
      origin: options.origin ?? PLUGIN_ORIGIN.BUILTIN,
      status: PLUGIN_STATUS.PENDING,
      bag: new DisposableBag(),
      disposedEffects: 0,
      error: '',
    });
    this.settle();
  }

  /**
   * 注销一个插件（撤销其全部贡献与副作用）
   * @param id 插件 id
   * @returns 是否确实移除了该插件
   */
  unuse(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    const wasMounted = entry.status === PLUGIN_STATUS.MOUNTED;
    this.teardown(entry);
    this.entries.delete(id);
    if (wasMounted) this.emitUnmounted(entry);
    this.settle();
    return true;
  }

  /**
   * 设置插件的启用状态（用户开关）
   *
   * 关闭会卸载该插件并让依赖它的插件一并转为「等待依赖」；重新打开会重新挂载。
   * @param id 插件 id
   * @param enabled 是否启用
   * @returns 是否命中了该插件
   */
  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    entry.enabled = enabled;
    // 重新启用失败过的插件时清掉失败态，给它一次重试机会
    if (enabled && entry.status === PLUGIN_STATUS.FAILED) {
      entry.status = PLUGIN_STATUS.PENDING;
      entry.error = '';
    }
    this.settle();
    return true;
  }

  /**
   * 重试挂载失败的插件
   * @param id 插件 id
   * @returns 是否命中了该插件
   */
  retry(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry || entry.status !== PLUGIN_STATUS.FAILED) return false;
    entry.status = PLUGIN_STATUS.PENDING;
    entry.error = '';
    this.settle();
    return true;
  }

  /**
   * 插件是否已注册
   * @param id 插件 id
   * @returns 是否已注册
   */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * 取插件运行时信息
   * @param id 插件 id
   * @returns 运行时信息；未注册返回 null
   */
  get(id: string): PluginRuntimeInfo | null {
    const entry = this.entries.get(id);
    return entry ? this.toRuntimeInfo(entry) : null;
  }

  /**
   * 取全部插件运行时信息
   * @returns 运行时信息列表（按 id 升序）
   */
  list(): readonly PluginRuntimeInfo[] {
    return [...this.entries.values()]
      .map((entry) => this.toRuntimeInfo(entry))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * 取内核运行时只读句柄（作为 `kernel:runtime` 服务提供给插件）
   * @returns 只读自省句柄
   */
  reader(): PluginRuntimeReader {
    return {
      list: (): readonly PluginRuntimeInfo[] => this.list(),
      get: (id: string): PluginRuntimeInfo | null => this.get(id),
      listServices: (): readonly string[] => this.services.list(),
      recentEvents: () => this.events.recent(),
    };
  }

  /**
   * 列出「已挂载且声明了设置」的插件（宿主「插件设置」弹窗的数据源）
   * @returns 设置条目（按 id 升序）
   */
  listSettingsPlugins(): readonly PluginSettingsEntry[] {
    return [...this.entries.values()]
      .filter(
        (entry): entry is PluginEntry & { settingsStore: PluginSettingsStore } =>
          entry.status === PLUGIN_STATUS.MOUNTED
          && entry.definition.settings !== undefined
          && entry.settingsStore !== undefined,
      )
      .map((entry) => ({
        id: entry.definition.id,
        name: entry.definition.name,
        declaration: entry.definition.settings as PluginSettingsDeclaration,
        store: entry.settingsStore,
      }))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  /**
   * 收敛挂载状态：反复比对「启用状态 + 依赖状态 → 目标状态」直到不再变化
   *
   * 用不动点循环而不是拓扑排序的原因：插件可以在运行期被禁用 / 重试，
   * 依赖关系是**动态**的；每轮只要有变化就再跑一轮，天然处理级联卸载与级联挂载。
   * 轮数上限 = 插件数 + 1，保证环形依赖（互相 inject）时停在「等待依赖」而不是死循环。
   *
   * 重入保护：挂载过程中的回调可能再次触发 settle（如异步插件挂载完成），
   * 内层直接返回，由最外层循环的下一轮兜底 —— 避免递归深度随插件数增长。
   */
  private settle(): void {
    if (this.settling) return;
    this.settling = true;
    try {
      const maxRounds = this.entries.size + 1;
      for (let round = 0; round < maxRounds; round += 1) {
        let changed = false;
        for (const entry of this.entries.values()) {
          if (this.reconcile(entry)) changed = true;
        }
        if (!changed) return;
      }
    } finally {
      this.settling = false;
      this.bumpRevision();
    }
  }

  /**
   * 把单个插件推进到目标状态
   * @param entry 插件条目
   * @returns 状态是否发生变化（驱动外层继续收敛）
   */
  private reconcile(entry: PluginEntry): boolean {
    // 挂载中的异步插件不动它，避免重复 apply 造成贡献点重复注册
    if (entry.status === PLUGIN_STATUS.MOUNTING) return false;
    // 挂载失败等待用户重试：不自动重试，否则会与 settle 循环互相触发
    if (entry.status === PLUGIN_STATUS.FAILED) return false;

    if (!entry.enabled) {
      if (entry.status === PLUGIN_STATUS.DISABLED) return false;
      const wasMounted = this.teardown(entry);
      entry.status = PLUGIN_STATUS.DISABLED;
      if (wasMounted) this.emitUnmounted(entry);
      return true;
    }

    const deps = entry.definition.inject ?? [];
    const ready = deps.every(
      (depId) => this.entries.get(depId)?.status === PLUGIN_STATUS.MOUNTED,
    );
    if (!ready) {
      if (entry.status === PLUGIN_STATUS.PENDING) return false;
      const wasMounted = this.teardown(entry);
      entry.status = PLUGIN_STATUS.PENDING;
      if (wasMounted) this.emitUnmounted(entry);
      return true;
    }

    if (entry.status === PLUGIN_STATUS.MOUNTED) return false;
    this.mount(entry);
    return true;
  }

  /**
   * 挂载插件：创建上下文 → 执行 apply → 失败则回滚全部副作用
   * @param entry 插件条目
   */
  private mount(entry: PluginEntry): void {
    const { definition } = entry;
    const bag = new DisposableBag();
    const writers = this.contributions.createWriters(definition.id, bag);
    const context = new PluginContextImpl(
      definition.id,
      (definition.config ?? {}) as PluginConfig,
      bag,
      this.events,
      this.services,
      writers,
      definition.settings,
    );

    /**
     * 挂载成功收尾
     */
    const onMounted = (): void => {
      entry.bag = bag;
      entry.status = PLUGIN_STATUS.MOUNTED;
      entry.error = '';
      entry.settingsStore = context.settings;
      this.bumpRevision();
      this.events.emit('plugin:mounted', [this.toRuntimeInfo(entry)], 'kernel');
      this.reconcileSiblings();
    };

    /**
     * 挂载失败收尾：撤销已产生的副作用，避免半挂载脏状态
     * @param error 抛出值
     */
    const onFailed = (error: unknown): void => {
      entry.disposedEffects += bag.size;
      bag.disposeAll();
      entry.status = PLUGIN_STATUS.FAILED;
      entry.error = error instanceof Error ? error.message : String(error);
      this.bumpRevision();
      console.error(`[plugin] ${definition.id} 挂载失败：${entry.error}`, error);
      this.events.emit('plugin:failed', [this.toRuntimeInfo(entry), error], 'kernel');
      this.reconcileSiblings();
    };

    try {
      const result = definition.apply(context);
      if (result && typeof (result as Promise<void>).then === 'function') {
        entry.status = PLUGIN_STATUS.MOUNTING;
        void (result as Promise<void>).then(onMounted, onFailed);
        return;
      }
      onMounted();
    } catch (error) {
      onFailed(error);
    }
  }

  /**
   * 撤销插件的全部副作用（贡献点随之从注册表消失）
   * @param entry 插件条目
   * @returns 撤销前是否处于挂载态（决定是否需要广播卸载事件）
   */
  private teardown(entry: PluginEntry): boolean {
    const wasMounted = entry.status === PLUGIN_STATUS.MOUNTED;
    entry.disposedEffects += entry.bag.size;
    entry.bag.disposeAll();
    entry.bag = new DisposableBag();
    entry.settingsStore = undefined;
    return wasMounted;
  }

  /**
   * 广播插件卸载事件
   * @param entry 插件条目
   */
  private emitUnmounted(entry: PluginEntry): void {
    this.events.emit('plugin:unmounted', [this.toRuntimeInfo(entry)], 'kernel');
  }

  /** 某个插件状态变化后，立刻再跑一轮收敛（让等待中的插件及时挂上 / 让依赖方及时让位） */
  private reconcileSiblings(): void {
    this.settle();
  }

  /**
   * 条目 → 运行时信息快照
   * @param entry 插件条目
   * @returns 运行时信息
   */
  private toRuntimeInfo(entry: PluginEntry): PluginRuntimeInfo {
    const { definition } = entry;
    return {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      description: definition.description,
      author:
        definition.author
        ?? (entry.origin === PLUGIN_ORIGIN.USER ? USER_PLUGIN_AUTHOR_LABEL : '内置'),
      builtin: entry.origin === PLUGIN_ORIGIN.BUILTIN,
      origin: entry.origin,
      status: entry.status,
      inject: definition.inject ?? [],
      error: entry.error,
      contributions: this.contributions.countFor(definition.id),
      disposedEffects: entry.disposedEffects,
    };
  }
}

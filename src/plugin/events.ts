/**
 * 类型化事件总线（对标 Cordis 的 Typed Events）
 *
 * 特点：
 * - 订阅返回 `Disposable`，插件卸载时由内核统一退订（不需要插件自己 off）；
 * - 单次 `emit` 中某个订阅者抛错不会影响其他订阅者（逐个 try / catch）；
 * - 环形缓冲记录最近事件，供「插件工坊」观测与排障（不进业务逻辑）。
 *
 * 事件名约定 `namespace:action`（如 `note:saved` / `sidebar:changed`），
 * 内置事件表见 `types/plugin.types.ts` 的 `AppEventMap`。
 */
import { PLUGIN_EVENT_HISTORY_MAX } from '../constants/plugin.constants';
import { createDisposable } from './disposable';
import type { AppEventMap, Disposable, PluginEventRecord } from '../types/plugin.types';

/** 订阅者函数形态（参数不做过深的类型包装，运行时按 emit 的实参传递） */
type EventHandler = (...args: never[]) => void;

export class PluginEventBus {
  /** 事件名 → 订阅者集合 */
  private readonly handlers = new Map<string, Set<EventHandler>>();

  /** 最近事件环形缓冲（由新到旧，容量 PLUGIN_EVENT_HISTORY_MAX） */
  private readonly history: PluginEventRecord[] = [];

  /**
   * 订阅事件（内置事件名有类型推导，自定义事件名走宽松分支）
   * @param name 事件名
   * @param handler 处理函数
   * @returns 取消订阅句柄
   */
  on<K extends keyof AppEventMap>(
    name: K,
    handler: (...args: AppEventMap[K]) => void,
  ): Disposable;
  on(name: string, handler: (...args: unknown[]) => void): Disposable;
  on(name: string, handler: EventHandler): Disposable {
    let set = this.handlers.get(name);
    if (!set) {
      set = new Set<EventHandler>();
      this.handlers.set(name, set);
    }
    set.add(handler);
    return createDisposable(() => {
      set.delete(handler);
      if (set.size === 0) this.handlers.delete(name);
    });
  }

  /**
   * 广播事件（记录进环形缓冲；单个订阅者抛错不影响其余订阅者）
   * @param name 事件名
   * @param args 事件参数
   * @param source 触发来源插件 id（宿主广播传空串）
   */
  emit(name: string, args: readonly unknown[], source = ''): void {
    this.record(name, source);
    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;
    for (const handler of [...set]) {
      try {
        (handler as (...inner: unknown[]) => void)(...args);
      } catch (error) {
        console.error(`[plugin] 事件 ${name} 的订阅者执行失败`, error);
      }
    }
  }

  /**
   * 记录一条事件到环形缓冲
   * @param name 事件名
   * @param source 触发来源插件 id
   */
  private record(name: string, source: string): void {
    this.history.unshift({ name, at: Date.now(), source });
    if (this.history.length > PLUGIN_EVENT_HISTORY_MAX) {
      this.history.length = PLUGIN_EVENT_HISTORY_MAX;
    }
  }

  /**
   * 取最近事件记录（由新到旧）
   * @param limit 最多返回条数（缺省返回全部缓冲）
   * @returns 事件记录数组（只读副本）
   */
  recent(limit = PLUGIN_EVENT_HISTORY_MAX): readonly PluginEventRecord[] {
    return this.history.slice(0, Math.max(0, limit));
  }

  /**
   * 某事件当前的订阅者数量（诊断用）
   * @param name 事件名
   * @returns 订阅者数量
   */
  countListeners(name: string): number {
    return this.handlers.get(name)?.size ?? 0;
  }

  /** 清空全部订阅者与历史（仅内核整体重置时调用） */
  clear(): void {
    this.handlers.clear();
    this.history.length = 0;
  }
}

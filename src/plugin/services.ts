/**
 * 服务容器（对标 Cordis 的 Service / 依赖注入）
 *
 * 插件之间**不互相 import**，只通过服务名协作：一方 `provide`，另一方 `consume`。
 * 好处是「谁依赖谁」写在声明里而不是文件引用里，因此卸载 / 替换某个能力提供方时，
 * 消费方要么拿到新实现、要么拿到 undefined 自行降级，不会出现隐式耦合。
 *
 * 同名服务后注册者覆盖先注册者（后者撤销时**恢复**前者），保证卸载可逆。
 */
import { createDisposable } from './disposable';
import type { AppServiceMap, Disposable } from '../types/plugin.types';

export class PluginServiceContainer {
  /** 服务名 → 实现（当前生效者） */
  private readonly services = new Map<string, unknown>();

  /** 服务名 → 被覆盖的历史实现栈（栈顶为上一个生效者，卸载时回填） */
  private readonly shadowed = new Map<string, unknown[]>();

  /**
   * 贡献一个服务（同名覆盖，撤销时恢复被覆盖的实现）
   * @param name 服务名
   * @param impl 服务实现
   * @returns 撤销句柄
   */
  provide<K extends keyof AppServiceMap>(name: K, impl: AppServiceMap[K]): Disposable {
    const key = String(name);
    const previous = this.services.get(key);
    if (previous !== undefined) {
      const stack = this.shadowed.get(key) ?? [];
      stack.push(previous);
      this.shadowed.set(key, stack);
    }
    this.services.set(key, impl);
    return createDisposable(() => {
      const stack = this.shadowed.get(key);
      const restored = stack?.pop();
      if (stack && stack.length === 0) this.shadowed.delete(key);
      if (restored !== undefined) {
        this.services.set(key, restored);
      } else {
        this.services.delete(key);
      }
    });
  }

  /**
   * 注入一个服务
   * @param name 服务名
   * @returns 服务实现；未提供时 undefined（消费方应自行降级）
   */
  consume<K extends keyof AppServiceMap>(name: K): AppServiceMap[K] | undefined {
    return this.services.get(String(name)) as AppServiceMap[K] | undefined;
  }

  /**
   * 服务是否已提供
   * @param name 服务名
   * @returns 是否已提供
   */
  has(name: keyof AppServiceMap): boolean {
    return this.services.has(String(name));
  }

  /**
   * 当前生效的服务名列表（观测 / 排障用）
   * @returns 服务名数组（按字典序）
   */
  list(): readonly string[] {
    return [...this.services.keys()].sort();
  }

  /** 清空全部服务（仅内核整体重置时调用） */
  clear(): void {
    this.services.clear();
    this.shadowed.clear();
  }
}

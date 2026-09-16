/**
 * 可逆副作用（Disposable）—— 插件内核的地基之一
 *
 * 对标 Cordis 的 effect 模型：插件的一切注册都产出一个「撤销句柄」，
 * 内核在插件卸载时按**逆序**统一撤销。这样卸载插件等价于把它的贡献全部抹掉，
 * 插件作者不需要写任何反向逻辑，也不会出现「卸载了但监听还在 / 定时器还在跑」的泄漏。
 */
import type { Disposable } from '../types/plugin.types';

/**
 * 由清理函数创建撤销句柄（幂等：重复 dispose 只执行一次清理）
 * @param cleanup 清理函数
 * @returns 撤销句柄
 */
export const createDisposable = (cleanup: () => void): Disposable => {
  let disposed = false;
  return {
    dispose: (): void => {
      if (disposed) return;
      disposed = true;
      cleanup();
    },
  };
};

/** 空撤销句柄（无副作用时返回，避免调用方判空） */
export const NOOP_DISPOSABLE: Disposable = { dispose: (): void => undefined };

/**
 * 副作用袋：收集插件在一次挂载期间产生的全部撤销句柄
 *
 * `disposeAll()` 按**后进先出**顺序撤销——先注册的可能是后注册者的前提
 * （如服务先 provide，再注册依赖该服务的面板），逆序撤销才不会出现
 * 「服务已撤销、消费方还在」的中间态。
 */
export class DisposableBag {
  /** 已收集的撤销句柄（按注册顺序） */
  private readonly items: Disposable[] = [];

  /**
   * 收集一个撤销句柄
   * @param disposable 撤销句柄
   * @returns 原样返回入参，便于链式使用
   */
  add<T extends Disposable>(disposable: T): T {
    this.items.push(disposable);
    return disposable;
  }

  /**
   * 当前已收集的副作用数量
   * @returns 副作用数量
   */
  get size(): number {
    return this.items.length;
  }

  /** 按逆序撤销全部副作用（幂等，撤销后清空袋子） */
  disposeAll(): void {
    for (let index = this.items.length - 1; index >= 0; index -= 1) {
      try {
        this.items[index].dispose();
      } catch (error) {
        console.error('[plugin] 撤销副作用失败', error);
      }
    }
    this.items.length = 0;
  }
}

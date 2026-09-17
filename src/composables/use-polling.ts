import { onActivated, onDeactivated, onScopeDispose } from 'vue';
import { createPollingScheduler } from './polling-scheduler';
import type { PollingOptions, UsePollingReturn } from '../types/polling.types';

/**
 * 受控轮询引擎（组件形态）：交易窗口感知 + 失败退避 + 可见性感知 + 总开关调度
 *
 * 调度策略的实现单源在 `polling-scheduler.ts`（无组件依赖），本函数只补两件事：
 * **KeepAlive 生命周期**（切走暂停 / 回来补刷）与**作用域回收**。
 * 插件等非组件上下文请直接用 `createPollingScheduler`。
 *
 * - 交易窗口感知（tradingAware）：仅在所属市场的轮询窗口内轮询
 *   （A 股：交易日 09:15-15:00；美股：21:30-24:00 与 00:00-04:00），
 *   窗口外自动暂停——挂载时仍会执行一次请求（「非交易时段只请求一次」）
 * - 失败退避：连续失败按 BACKOFF_BASE * 2^n 指数退避（封顶 BACKOFF_MAX），成功归零
 * - 可见性感知：页面隐藏暂停，恢复可见立即补刷一次
 * - 总开关：settings.pollingEnabled 关闭时统一暂停
 *
 * 必须在组件 setup 内调用（依赖 KeepAlive 钩子）。
 * @param options 轮询选项
 * @returns pause/resume 手动控制句柄
 */
export const usePolling = (options: PollingOptions): UsePollingReturn => {
  const scheduler = createPollingScheduler(options);

  // KeepAlive 场景：页面被缓存（切走）时暂停轮询，重新激活时恢复——
  // 避免隐藏页在后台持续请求公共上游
  onDeactivated(() => scheduler.pause());
  onActivated(() => scheduler.activate());

  // 组件作用域销毁时彻底释放窗口 / 可见性监听（计时器本已被 useIntervalFn 回收）
  onScopeDispose(() => scheduler.stop());

  return { pause: scheduler.pause, resume: scheduler.resume };
};

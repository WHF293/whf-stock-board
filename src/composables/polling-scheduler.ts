/**
 * 轮询调度内核（无组件依赖，与 `usePolling` 共用同一份调度策略）
 *
 * 为什么要从 `usePolling` 里抽出来：`usePolling` 依赖 `onActivated` / `onDeactivated`
 * 这两个 KeepAlive 钩子，**必须在组件 setup 里调用**；而插件在 `ctx.apply()` 里没有组件实例，
 * 且盯盘告警恰恰要求「面板折叠、侧栏收起时照样轮询」—— 它不能挂在任何组件的生命周期上。
 *
 * 调度策略（交易窗口感知 / 失败退避 / 可见性感知 / 轮询总开关）只维护这一份：
 * 上游是公共行情接口，退避与窗口判断一旦两边写岔，就会直接顶到频率红线。
 *
 * 生命周期归属：本函数自身不注册任何自动清理。在组件里用由组件作用域回收；
 * 在插件里用请配合 `ctx.effect(() => () => scheduler.stop())`。
 */
import { computed, ref, watch } from 'vue';
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import { useMarketStatusStore } from '../stores/market-status';
import { useSettingsStore } from '../stores/settings';
import { handleSdkError } from '../utils/handle-sdk-error';
import type { PollingOptions, PollingScheduler } from '../types/polling.types';

/**
 * 创建一个轮询调度器
 *
 * 行为与 `usePolling` 完全一致：
 * - 交易窗口感知（tradingAware）：仅所属市场窗口内轮询，窗口外自动暂停；挂载时仍执行一次
 * - 失败退避：连续失败按 `BACKOFF_BASE * 2^n` 指数退避（封顶 `BACKOFF_MAX`），成功归零
 * - 可见性感知：页面隐藏暂停，恢复可见且处于窗口内时立即补刷一次
 * - 总开关：`settings.pollingEnabled` 关闭时暂停
 * @param options 轮询选项
 * @returns 调度句柄（pause / resume / runNow / activate / isEligible / stop）
 */
export const createPollingScheduler = (options: PollingOptions): PollingScheduler => {
  const { task, intervalMs, tradingAware = false, market = 'A', immediate = true } = options;

  const marketStatusStore = useMarketStatusStore();
  const settingsStore = useSettingsStore();
  const visibility = useDocumentVisibility();

  /** 连续失败次数：驱动指数退避，成功后归零 */
  const failureCount = ref(0);
  /** 任务执行互斥标记：上一轮未完成时不重复触发 */
  const isExecuting = ref(false);

  /** 是否处于所属市场的轮询窗口（tradingAware 关闭时恒为 true） */
  const inWindow = computed(() => {
    if (!tradingAware) {
      return true;
    }
    return market === 'US'
      ? marketStatusStore.isUsPollingWindow
      : marketStatusStore.isASharePollingWindow;
  });

  /**
   * 当前生效间隔（毫秒）：
   * 1. 失败退避优先：BACKOFF_BASE * 2^n 封顶 BACKOFF_MAX；
   * 2. 正常档：取「用户设置的刷新间隔」与「本轮询自身下限 intervalMs」的较大值
   */
  const activeInterval = computed(() => {
    if (failureCount.value > 0) {
      return Math.min(
        POLLING_INTERVAL.BACKOFF_BASE * 2 ** failureCount.value,
        POLLING_INTERVAL.BACKOFF_MAX,
      );
    }
    return Math.max(settingsStore.refreshIntervalMs, intervalMs);
  });

  /**
   * 安全执行任务：错误只降级记录（保留上一次成功数据），不打断轮询
   */
  const runNow = async (): Promise<void> => {
    if (isExecuting.value) {
      return;
    }
    isExecuting.value = true;
    try {
      await task();
      failureCount.value = 0;
    } catch (error) {
      failureCount.value += 1;
      console.error('[usePolling]', handleSdkError(error));
    } finally {
      isExecuting.value = false;
    }
  };

  /**
   * 当前是否「允许轮询」（总开关打开且处于窗口内）
   * @returns 是否允许轮询
   */
  const isEligible = (): boolean => settingsStore.pollingEnabled && inWindow.value;

  const { pause, resume } = useIntervalFn(runNow, activeInterval, {
    // 创建即启动计时；immediateCallback 使首次立即执行（窗口外即「只请求一次」）
    immediate: true,
    immediateCallback: immediate,
  });

  // 交易窗口调度：进入窗口恢复并立即补刷；离开窗口暂停（首次 immediate 已请求过一次）
  const stopWindowWatch = watch(
    inWindow,
    (inside) => {
      if (!settingsStore.pollingEnabled) {
        pause();
        return;
      }
      if (inside) {
        resume();
        if (immediate) {
          void runNow();
        }
      } else {
        pause();
      }
    },
    { immediate: true },
  );

  // 可见性调度：隐藏暂停，恢复可见且处于窗口内时立即补刷一次
  const stopVisibilityWatch = watch(visibility, (state) => {
    if (!settingsStore.pollingEnabled) {
      return;
    }
    if (state === 'visible') {
      if (inWindow.value) {
        resume();
        void runNow();
      } else {
        pause();
      }
    } else {
      pause();
    }
  });

  return {
    pause,
    resume,
    runNow,
    isEligible,
    activate: (): void => {
      if (isEligible()) {
        resume();
        void runNow();
      }
    },
    stop: (): void => {
      pause();
      stopWindowWatch();
      stopVisibilityWatch();
    },
  };
};

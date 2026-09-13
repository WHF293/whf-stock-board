import { computed, onActivated, onDeactivated, ref, watch } from 'vue';
import { useDocumentVisibility, useIntervalFn } from '@vueuse/core';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import { useMarketStatusStore } from '../stores/market-status';
import { useSettingsStore } from '../stores/settings';
import { handleSdkError } from '../utils/handle-sdk-error';
import type { PollingOptions, UsePollingReturn } from '../types/polling.types';

/**
 * 受控轮询引擎：交易窗口感知 + 失败退避 + 可见性感知 + 总开关调度
 *
 * - 交易窗口感知（tradingAware）：仅在所属市场的轮询窗口内轮询
 *   （A 股：交易日 09:15-15:00；美股：21:30-24:00 与 00:00-04:00），
 *   窗口外自动暂停——挂载时仍会执行一次请求（「非交易时段只请求一次」）
 * - 失败退避：连续失败按 BACKOFF_BASE * 2^n 指数退避（封顶 BACKOFF_MAX），成功归零
 * - 可见性感知：页面隐藏暂停，恢复可见立即补刷一次
 * - 总开关：settings.pollingEnabled 关闭时统一暂停
 * @param options 轮询选项
 * @returns pause/resume 手动控制句柄
 */
export const usePolling = (options: PollingOptions): UsePollingReturn => {
  const { task, intervalMs, tradingAware = false, market = 'A', immediate = true } = options;

  const marketStatusStore = useMarketStatusStore();
  const settingsStore = useSettingsStore();
  const visibility = useDocumentVisibility();

  /** 连续失败次数：驱动指数退避，成功后归零 */
  const failureCount = ref(0);
  /** 任务执行互斥标记：上一轮未完成时不重复触发 */
  const isExecuting = ref(false);

  /**
   * 是否处于所属市场的轮询窗口（tradingAware 关闭时恒为 true）
   */
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
   * 2. 正常档：取「用户设置的刷新间隔」与「本轮询自身下限 intervalMs」的较大值——
   *    行情类轻轮询完全跟随用户设置，市场宽度类重轮询保持不低于 120s 的克制档
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
  const runSafely = async (): Promise<void> => {
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

  const { pause, resume } = useIntervalFn(runSafely, activeInterval, {
    // 创建即启动计时；immediateCallback 使首次立即执行（窗口外即「只请求一次」）
    immediate: true,
    immediateCallback: immediate,
  });

  // 交易窗口调度：进入窗口恢复并立即补刷；离开窗口暂停（首次 immediate 已请求过一次）
  watch(
    inWindow,
    (inside) => {
      if (!settingsStore.pollingEnabled) {
        pause();
        return;
      }
      if (inside) {
        resume();
        if (immediate) {
          void runSafely();
        }
      } else {
        pause();
      }
    },
    { immediate: true },
  );

  // KeepAlive 场景：页面被缓存（切走）时暂停轮询，重新激活时恢复——
  // 避免隐藏页在后台持续请求公共上游
  onDeactivated(() => pause());
  onActivated(() => {
    if (settingsStore.pollingEnabled && (!tradingAware || inWindow.value)) {
      resume();
      void runSafely();
    }
  });

  // 可见性调度：隐藏暂停，恢复可见且处于窗口内时立即补刷一次
  watch(visibility, (state) => {
    if (!settingsStore.pollingEnabled) {
      return;
    }
    if (state === 'visible') {
      if (inWindow.value) {
        resume();
        void runSafely();
      } else {
        pause();
      }
    } else {
      pause();
    }
  });

  return { pause, resume };
};

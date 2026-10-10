import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue';
import { appStorage } from '../../common/utils/app-local-storage';
import { STORAGE_NS_MOBILE_POLLING } from '../../common/constants/storage-key.constants.ts';
import { MOBILE_POLLING_DEFAULT, MOBILE_POLLING_OPTIONS } from '../constants';

/**
 * 移动端前台轮询（需求稿 v1.1）
 *
 * 间隔四档持久化在 mobile.pollingMs（独立于桌面 refreshIntervalMs：
 * 两端档位与默认值口径不同，互不污染）；轮询仅前台生效——
 * 页面不可见时暂停定时器，回前台若已超间隔立即补一次并重排。
 * 间隔变更在「下一次进入页面 / 回前台」生效（不做跨页热更新）。
 */

const POLLING_VALUES: readonly number[] = MOBILE_POLLING_OPTIONS.map((option) => option.value);

/**
 * 读取持久化的轮询间隔（毫秒）
 * @returns 四档之一；无记录 / 坏数据回落默认 30s
 */
export const readMobilePollingMs = (): number => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_POLLING);
  if (raw === null) return MOBILE_POLLING_DEFAULT;
  try {
    const value = JSON.parse(raw) as unknown;
    return typeof value === 'number' && (POLLING_VALUES as readonly unknown[]).includes(value)
      ? value
      : MOBILE_POLLING_DEFAULT;
  } catch {
    return MOBILE_POLLING_DEFAULT;
  }
};

/**
 * 持久化轮询间隔
 * @param ms 间隔毫秒值（须为 MOBILE_POLLING_OPTIONS 中的 value，非法值忽略）
 */
export const writeMobilePollingMs = (ms: number): void => {
  if (!(POLLING_VALUES as readonly unknown[]).includes(ms)) return;
  appStorage.setItem(STORAGE_NS_MOBILE_POLLING, JSON.stringify(ms));
};

/**
 * 注册前台轮询任务（组件内调用）
 *
 * 生命周期覆盖两套形态：常规组件走 onMounted / onUnmounted；
 * keep-alive 页面走 onActivated / onDeactivated（隐藏页必须停轮询，
 * 否则两个 Tab 会在后台轮流请求上游）。tick 仅在页面可见时执行 task，
 * 回前台 / 重新激活时立即补一次并按持久化间隔重排定时器。
 * @param task 轮询任务（异步任务内部自行处理并发与失败兜底）
 */
export const useMobilePolling = (task: () => void | Promise<void>): void => {
  let timer: number | undefined;

  const stop = (): void => {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  const tick = (): void => {
    if (document.visibilityState === 'visible') void task();
  };

  const start = (): void => {
    stop();
    timer = window.setInterval(tick, readMobilePollingMs());
  };

  const onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    void task();
    start();
  };

  onMounted(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    start();
  });

  onActivated(() => {
    document.addEventListener('visibilitychange', onVisibilityChange);
    void task();
    start();
  });

  onDeactivated(() => {
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });

  onUnmounted(() => {
    stop();
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
};

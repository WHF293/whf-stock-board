import { ref } from 'vue';
import { setNetworkTap } from '../../common/api/network-tap.ts';
import { STORAGE_NS_MOBILE_DEBUG } from '../../common/constants/storage-key.constants.ts';
import { appStorage } from '../../common/utils/app-local-storage.ts';
import { handleNetworkTapEvent } from './network-recorder';

/**
 * 调试模式开关（移动端专属）
 *
 * 「我的」页应用信息卡连点 10 次切换；开启后把请求记录器挂到 proxy-fetch
 * 的旁路钩子上开始捕获，关闭即摘钩（已捕获的记录保留在内存里，面板可手动清）。
 * 开关状态经 appStorage 持久化，重启后保持。
 */

/**
 * 从持久层读调试开关
 * @returns '1' 表示开启
 */
const readPersisted = (): boolean =>
  appStorage.getItem(STORAGE_NS_MOBILE_DEBUG) === '1';

/** 调试模式是否开启（DebugOverlay 的挂载条件，也是面板内开关的数据源） */
export const isDebugMode = ref<boolean>(readPersisted());

/** 当前注册钩子的注销函数（null = 未挂） */
let detach: (() => void) | null = null;

/** 按开关状态挂 / 摘请求捕获钩子 */
const syncTap = (): void => {
  if (isDebugMode.value && detach === null) {
    detach = setNetworkTap(handleNetworkTapEvent);
  } else if (!isDebugMode.value && detach !== null) {
    detach();
    detach = null;
  }
};

// 模块加载即对齐一次：调试开关持久化为开时，冷启动就开始捕获
syncTap();

/**
 * 切换调试模式（持久化 + 挂 / 摘捕获钩子）
 * @param enabled true 开启 / false 关闭
 */
export const setDebugMode = (enabled: boolean): void => {
  isDebugMode.value = enabled;
  appStorage.setItem(STORAGE_NS_MOBILE_DEBUG, enabled ? '1' : '0');
  syncTap();
};

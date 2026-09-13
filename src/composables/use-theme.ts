import { useDark, useToggle } from '@vueuse/core';
import { STORAGE_NS_COLOR_SCHEME } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';

/**
 * 暗色模式切换：class 策略挂 <html class="dark">，偏好持久化到 localStorage
 *
 * BaseChart 等需要感知主题的消费方调用 useDark({ storageKey }) 读取同一状态
 * @returns isDark 当前是否暗色；toggleDark 切换函数
 */
export const useTheme = () => {
  const isDark = useDark({ storageKey: STORAGE_NS_COLOR_SCHEME, storage: appStorage });
  // 首次访问（localStorage 无偏好记录）默认进入黑暗模式
  if (appStorage.getItem(STORAGE_NS_COLOR_SCHEME) === null) {
    isDark.value = true;
  }
  const toggleDark = useToggle(isDark);
  return { isDark, toggleDark };
};

import { useDark, useToggle } from '@vueuse/core';
import { STORAGE_NS_COLOR_SCHEME } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';

/**
 * 从 colorScheme 命名空间原始值解析暗色布尔
 *
 * vueuse 字符串序列化存储（'dark' / 'light' / 'auto'，兼容 JSON 引号形态）；
 * 'auto' 或未知值返回 null（视为无显式偏好）
 * @param raw storage 里的原始值
 * @returns true 暗色 / false 亮色 / null 无显式偏好
 */
export const parseColorScheme = (raw: unknown): boolean | null => {
  if (typeof raw !== 'string') return null;
  const value = raw.replace(/^"(.*)"$/, '$1');
  if (value === 'dark') return true;
  if (value === 'light') return false;
  return null;
};

/**
 * 暗色模式切换：class 策略挂 <html class="dark">，偏好持久化到 localStorage
 *
 * BaseChart 等需要感知主题的消费方调用 useDark({ storageKey }) 读取同一状态
 * @returns isDark 当前是否暗色；toggleDark 切换函数
 */
export const useTheme = () => {
  // ⚠️ 必须在调用 useDark 之前读，且只判「键不存在」：
  // 1. useDark 初始化会往 storage 落值，之后就无法区分「用户没选过」和「用户选过」；
  // 2. 'auto' 是**有效偏好**（vueuse 在「用户所选项恰好等于系统偏好」时会写 'auto'，
  //    见 useDark 的 setter），不能当作「无偏好」覆盖成暗色 ——
  //    否则在系统为浅色的机器上，用户选「白天模式」会被下一次 useTheme() 强行拉回黑暗。
  const noStoredPreference = appStorage.getItem(STORAGE_NS_COLOR_SCHEME) === null;
  const isDark = useDark({ storageKey: STORAGE_NS_COLOR_SCHEME, storage: appStorage });
  // 首次访问（storage 里完全没有该键）默认进入黑暗模式
  if (noStoredPreference) {
    isDark.value = true;
  }
  const toggleDark = useToggle(isDark);
  return { isDark, toggleDark };
};

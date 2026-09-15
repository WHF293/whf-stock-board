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
  const isDark = useDark({ storageKey: STORAGE_NS_COLOR_SCHEME, storage: appStorage });
  // 首次访问（无用户显式偏好）默认进入黑暗模式
  // ⚠️ useDark 初始化时 writeDefaults 会把初始值 'auto' 立即写入 storage，
  // 所以不能只判 null —— 已存的 'auto' 同样视为「无用户偏好」
  if (parseColorScheme(appStorage.getItem(STORAGE_NS_COLOR_SCHEME)) === null) {
    isDark.value = true;
  }
  const toggleDark = useToggle(isDark);
  return { isDark, toggleDark };
};

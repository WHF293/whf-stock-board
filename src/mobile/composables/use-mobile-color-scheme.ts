import { parseColorScheme, useTheme } from '../../common/composables/use-theme';import { STORAGE_NS_COLOR_SCHEME } from '../../common/constants/storage-key.constants.ts';
import { appStorage } from '../../common/utils/app-local-storage';

/** 移动端明暗三档（浅色 / 深色 / 跟随系统；「跟随系统」= storage 写 'auto'） */
export type MobileColorScheme = 'light' | 'dark' | 'auto';

/**
 * 读取当前明暗档位（与桌面 useTheme 共用同一持久化键，无记录回落深色——
 * 桌面 useTheme 首次访问即落值，因此正常总能解析出三档之一）
 * @returns 'light' / 'dark' / 'auto'
 */
export const readMobileColorScheme = (): MobileColorScheme => {
  const parsed = parseColorScheme(appStorage.getItem(STORAGE_NS_COLOR_SCHEME));
  if (parsed === null) return 'dark';
  return parsed ? 'dark' : 'light';
};

/**
 * 设置明暗档位
 *
 * - light / dark：写 useDark 的 isDark（落持久化 + 即时切 class）
 * - auto：storage 直接写 'auto'（vueuse 语义 = 跟随系统），并按系统偏好即时设置当前值；
 *   系统偏好变化不监听（下次进页 / 重开 App 生效），v1 接受该简化
 * @param scheme 明暗档位
 */
export const writeMobileColorScheme = (scheme: MobileColorScheme): void => {
  const { isDark } = useTheme();
  if (scheme === 'auto') {
    appStorage.setItem(STORAGE_NS_COLOR_SCHEME, JSON.stringify('auto'));
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return;
  }
  isDark.value = scheme === 'dark';
};

import { useEventListener, watchImmediate } from '@vueuse/core';
import {
  STORAGE_KEY_APP,
  STORAGE_NS_COLOR_SCHEME,
  STORAGE_NS_SETTINGS,
} from '../constants/storage-key.constants.ts';
import {
  CUSTOM_THEME_COLOR_PATTERN,
  CUSTOM_THEME_WEAK_TINT,
  CSS_VAR_PRIMARY,
} from '../constants/theme-color.constants.ts';
import { parseColorScheme, useTheme } from './use-theme';
import { useSettingsStore } from '../stores/settings';
import { pickContrastText } from '../utils/pick-contrast-text';
import type { ThemeColor } from '../constants/theme-color.constants.ts';
import type { TrendTheme } from '../constants/trend-theme.constants.ts';

/**
 * 全局主题落到 <html>（App 层调用，每个窗口执行一次）
 *
 * 三件事：
 * 1. 暗色 class —— useTheme（useDark，class 策略挂 <html class="dark">，
 *    无偏好记录时默认黑暗模式）；
 * 2. 主题色 —— settings.themeColor 写 <html data-theme>；custom 档额外以内联
 *    CSS 变量下发自定义主色（色值 settings.customThemeColor，亮暗切换重算弱色底）；
 * 3. 涨跌配色 —— settings.trendTheme 写 <html data-trend>。
 *
 * ⚠️ 必须在 App.vue 而非 MainLayout 调用：独立 WebviewWindow（Agent 分析、
 * 热点新闻原文）是独立 app 实例、standalone 布局不经过 MainLayout，
 * 若只在布局里写 <html> 属性，新窗口会回落亮色 + 默认涨跌色
 * （settings store 经 localStorage 整包共享、水合正确，缺的只是应用动作）。
 *
 * 跨窗口实时同步：多窗口共享同一 localStorage（whf:app 整包），主窗口切换
 * 暗色 / 主题色 / 涨跌配色时其余窗口经 storage 事件即时跟随。
 * ⚠️ vueuse 传自定义 storage 对象时只发同文档自定义事件、不监听 window storage
 * 事件（源码 `storage instanceof Storage` 分支），且事件 key 是整包 'whf:app'
 * 而非命名空间 key，所以这里的同步必须自己实现、不能指望 useDark。
 *
 * 防回环：storage 事件只在「其他窗口」写入时触发；本窗口收到后把值写回
 * reactive 状态时若值未变化，Vue 不触发订阅、pinia persist 不回写，
 * 不会形成两窗口 ping-pong。
 */
export const useDocumentThemeSync = (): void => {
  const { isDark } = useTheme();
  const settingsStore = useSettingsStore();

  /**
   * 应用自定义主题色：以内联 CSS 变量覆盖主色（特异性高于一切 CSS 规则）
   *
   * 三件事：主色本体 / 弱色底（color-mix 向透明掺主色，亮暗模式掺不同比例）/
   * 主色上的文字色（按明度自动选白或深，对齐内置黑金手工调 --color-on-primary 的思路）。
   * 弱色底用透明掺色而非实色：不感知具体的 bg 变量，亮暗主题与卡片底色上都自然。
   * @param hex 自定义色值（#rrggbb）
   */
  const applyCustomThemeColor = (hex: string): void => {
    const style = document.documentElement.style;
    if (!CUSTOM_THEME_COLOR_PATTERN.test(hex)) return;
    const tint = (isDark.value ? CUSTOM_THEME_WEAK_TINT.DARK : CUSTOM_THEME_WEAK_TINT.LIGHT) * 100;
    style.setProperty(CSS_VAR_PRIMARY, hex);
    style.setProperty(
      `${CSS_VAR_PRIMARY}-weak`,
      `color-mix(in srgb, ${hex} ${tint}%, transparent)`,
    );
    style.setProperty('--color-on-primary', pickContrastText(hex));
  };

  /** 清除自定义主题色的内联覆盖（切回内置主题时，避免残留变量压住 CSS 规则） */
  const clearCustomThemeColor = (): void => {
    const style = document.documentElement.style;
    style.removeProperty(CSS_VAR_PRIMARY);
    style.removeProperty(`${CSS_VAR_PRIMARY}-weak`);
    style.removeProperty('--color-on-primary');
  };

  // 主题色与明暗双依赖：自定义色值要在明暗切换时重算弱色底掺色比例
  watchImmediate(
    [() => settingsStore.themeColor, () => settingsStore.customThemeColor, isDark],
    ([color, customHex]) => {
      document.documentElement.dataset.theme = color;
      if (color === 'custom') {
        applyCustomThemeColor(customHex);
      } else {
        clearCustomThemeColor();
      }
    },
  );

  watchImmediate(
    () => settingsStore.trendTheme,
    (theme) => {
      document.documentElement.dataset.trend = theme;
    },
  );

  useEventListener(
    window,
    'storage',
    (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY_APP || event.newValue === null) return;
      let bundle: Record<string, unknown>;
      try {
        bundle = JSON.parse(event.newValue) as Record<string, unknown>;
      } catch {
        return; // 坏包忽略
      }
      // 明暗模式跟随（'auto' 视为无显式偏好，不动）
      const dark = parseColorScheme(bundle[STORAGE_NS_COLOR_SCHEME]);
      if (dark !== null && dark !== isDark.value) {
        isDark.value = dark;
      }
      // 主题色 / 涨跌配色跟随（settings 命名空间为 pinia persist 序列化的 JSON 串）
      const settingsRaw = bundle[STORAGE_NS_SETTINGS];
      if (typeof settingsRaw !== 'string') return;
      try {
        const settings = JSON.parse(settingsRaw) as {
          themeColor?: ThemeColor;
          trendTheme?: TrendTheme;
          customThemeColor?: string;
        };
        if (
          typeof settings.themeColor === 'string' &&
          settings.themeColor !== settingsStore.themeColor
        ) {
          settingsStore.themeColor = settings.themeColor;
        }
        if (
          typeof settings.customThemeColor === 'string' &&
          settings.customThemeColor !== settingsStore.customThemeColor
        ) {
          settingsStore.customThemeColor = settings.customThemeColor;
        }
        if (
          typeof settings.trendTheme === 'string' &&
          settings.trendTheme !== settingsStore.trendTheme
        ) {
          settingsStore.trendTheme = settings.trendTheme;
        }
      } catch {
        // settings 坏包忽略
      }
    },
    { passive: true },
  );
};

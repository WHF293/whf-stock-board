/**
 * 运行时读取涨跌语义色（CSS 变量）
 *
 * 图表（ECharts）无法消费 CSS 类，需在构建 option 时读取当前生效的变量值；
 * 涨跌配色主题切换后组件的 computed 依赖 settingsStore.trendTheme 重新求值即可跟随
 */
import { TREND_COLOR_LEVEL } from '../constants/stock-colors.constants';

/** 图表用涨跌色阶集合（值来自 theme.css 的 data-trend 感知变量） */
export interface TrendColorSet {
  upStrong: string;
  up: string;
  upLight: string;
  upPale: string;
  downStrong: string;
  down: string;
  downLight: string;
  downPale: string;
  flat: string;
}

/**
 * 读取当前生效的涨跌色阶（getComputedStyle 实时求值）
 * @returns 涨跌色阶集合
 */
export const readTrendColors = (): TrendColorSet => {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string): string => style.getPropertyValue(name).trim();
  return {
    upStrong: read('--color-up-strong'),
    up: read('--color-up'),
    upLight: read('--color-up-light'),
    upPale: read('--color-up-pale'),
    downStrong: read('--color-down-strong'),
    down: read('--color-down'),
    downLight: read('--color-down-light'),
    downPale: read('--color-down-pale'),
    flat: read('--color-flat'),
  };
};

/**
 * 依据涨跌幅取当前主题下的图表色（三档色阶，与 getTrendColor 同逻辑）
 * @param changePercent 涨跌幅（百分数数值）
 * @returns hex 色值（来自 CSS 变量，随涨跌配色主题变化）
 */
export const getTrendColorCss = (changePercent: number): string => {
  const colors = readTrendColors();
  const abs = Math.abs(changePercent);
  if (changePercent > 0) {
    if (abs >= TREND_COLOR_LEVEL.STRONG) return colors.upStrong;
    if (abs >= TREND_COLOR_LEVEL.MEDIUM) return colors.up;
    return colors.upLight;
  }
  if (changePercent < 0) {
    if (abs >= TREND_COLOR_LEVEL.STRONG) return colors.downStrong;
    if (abs >= TREND_COLOR_LEVEL.MEDIUM) return colors.down;
    return colors.downLight;
  }
  return colors.flat;
};

import { defineStore } from 'pinia';
import { HEATMAP_TOP_DEFAULT } from '../constants/index-symbols.constants';
import { STORAGE_NS_SETTINGS } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import { REFRESH_INTERVAL_DEFAULT } from '../constants/polling.constants';
import { THEME_COLOR_DEFAULT } from '../constants/theme-color.constants';
import type { ThemeColor } from '../constants/theme-color.constants';
import { TREND_THEME_DEFAULT } from '../constants/trend-theme.constants';
import type { TrendTheme } from '../constants/trend-theme.constants';
import { WATERMARK_ENABLED_DEFAULT } from '../constants/watermark.constants';

/** 设置 store 状态 */
interface SettingsState {
  /** 轮询总开关：关闭后全部 usePolling 暂停 */
  pollingEnabled: boolean;
  /** 行情刷新间隔（毫秒）：用户在设置页选择，驱动全部行情类轮询档位 */
  refreshIntervalMs: number;
  /** 板块热力图 Top N：总览页展示的板块数量 */
  heatmapTopN: number;
  /** 主题色（清新绿 / 淡雅蓝 / 淡雅粉 / 极光紫） */
  themeColor: ThemeColor;
  /** 涨跌配色主题（红涨绿跌 / 红跌绿涨 / 红涨蓝跌） */
  trendTheme: TrendTheme;
  /** 全局水印开关（默认开启） */
  watermarkEnabled: boolean;
}

/**
 * 全局设置 store（localStorage 持久化，刷新/下次进入自动恢复）
 */
export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    pollingEnabled: true,
    refreshIntervalMs: REFRESH_INTERVAL_DEFAULT,
    heatmapTopN: HEATMAP_TOP_DEFAULT,
    themeColor: THEME_COLOR_DEFAULT,
    trendTheme: TREND_THEME_DEFAULT,
    watermarkEnabled: WATERMARK_ENABLED_DEFAULT,
  }),

  actions: {
    /**
     * 设置轮询总开关
     * @param enabled true 开启轮询，false 暂停全部轮询
     */
    setPollingEnabled(enabled: boolean): void {
      this.pollingEnabled = enabled;
    },

    /**
     * 设置行情刷新间隔
     * @param intervalMs 间隔毫秒值（取值须为 REFRESH_INTERVAL_OPTIONS 中的 value）
     */
    setRefreshIntervalMs(intervalMs: number): void {
      this.refreshIntervalMs = intervalMs;
    },

    /**
     * 设置板块热力图 Top N
     * @param topN 数量（取值须为 HEATMAP_TOP_OPTIONS 中的值）
     */
    setHeatmapTopN(topN: number): void {
      this.heatmapTopN = topN;
    },

    /**
     * 设置主题色（消费方 watch 后写 <html data-theme>）
     * @param color 主题色
     */
    setThemeColor(color: ThemeColor): void {
      this.themeColor = color;
    },

    /**
     * 设置涨跌配色主题（消费方 watch 后写 <html data-trend>，图表读变量跟随）
     * @param theme 涨跌配色主题
     */
    setTrendTheme(theme: TrendTheme): void {
      this.trendTheme = theme;
    },

    /**
     * 设置全局水印开关
     * @param enabled true 显示水印，false 隐藏
     */
    setWatermarkEnabled(enabled: boolean): void {
      this.watermarkEnabled = enabled;
    },
  },

  persist: {
    key: STORAGE_NS_SETTINGS,
    storage: appStorage,
  },
});

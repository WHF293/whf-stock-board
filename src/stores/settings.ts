import { defineStore } from 'pinia';
import { HEATMAP_TOP_DEFAULT } from '../constants/index-symbols.constants';
import { HEATMAP_VIEW_MODE_DEFAULT } from '../constants/heatmap.constants';
import { STORAGE_NS_SETTINGS } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import { REFRESH_INTERVAL_DEFAULT } from '../constants/polling.constants';
import { THEME_COLOR_DEFAULT } from '../constants/theme-color.constants';
import type { ThemeColor } from '../constants/theme-color.constants';
import { TREND_THEME_DEFAULT } from '../constants/trend-theme.constants';
import type { TrendTheme } from '../constants/trend-theme.constants';
import { WATERMARK_ENABLED_DEFAULT } from '../constants/watermark.constants';
import { SIDEBAR_COLLAPSED_DEFAULT } from '../constants/sidebar.constants';
import { MENU_DEFAULT_ORDER } from '../constants/router-meta.constants';
import { PANORAMA_CN_VIEW_MODE_DEFAULT } from '../constants/panorama.constants';
import type { HeatmapViewMode } from '../types/heatmap.types';
import type { PanoramaCnViewMode } from '../constants/panorama.constants';

/** 设置 store 状态 */
interface SettingsState {
  /** 轮询总开关：关闭后全部 usePolling 暂停 */
  pollingEnabled: boolean;
  /** 行情刷新间隔（毫秒）：用户在设置页选择，驱动全部行情类轮询档位 */
  refreshIntervalMs: number;
  /** 板块热力图 Top N：总览页展示的板块数量 */
  heatmapTopN: number;
  /** 板块热力展示形式：热力图 treemap 或列表表格 */
  heatmapViewMode: HeatmapViewMode;
  /** 行情全景 · A股板块排行展示形式：平铺网格 或 列表表格 */
  panoramaCnViewMode: PanoramaCnViewMode;
  /** 左侧导航栏是否收起（仅桌面端生效，窄屏抽屉不受影响） */
  sidebarCollapsed: boolean;
  /** 左侧导航顺序（存路由 path 数组；默认按 MENU_ITEMS 声明顺序） */
  menuOrder: string[];
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
    heatmapViewMode: HEATMAP_VIEW_MODE_DEFAULT,
    panoramaCnViewMode: PANORAMA_CN_VIEW_MODE_DEFAULT,
    sidebarCollapsed: SIDEBAR_COLLAPSED_DEFAULT,
    menuOrder: [...MENU_DEFAULT_ORDER],
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
     * 设置板块热力展示形式
     * @param mode 展示形式（取值须为 HEATMAP_VIEW_MODE 中的值）
     */
    setHeatmapViewMode(mode: HeatmapViewMode): void {
      this.heatmapViewMode = mode;
    },

    /**
     * 设置行情全景 · A股板块排行展示形式
     * @param mode 展示形式（取值须为 PANORAMA_CN_VIEW_MODE 中的值）
     */
    setPanoramaCnViewMode(mode: PanoramaCnViewMode): void {
      this.panoramaCnViewMode = mode;
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

    /**
     * 设置侧栏收起状态
     * @param collapsed true 仅显示图标，false 显示完整菜单（仅桌面端生效）
     */
    setSidebarCollapsed(collapsed: boolean): void {
      this.sidebarCollapsed = collapsed;
    },

    /** 切换侧栏收起状态 */
    toggleSidebarCollapsed(): void {
      this.sidebarCollapsed = !this.sidebarCollapsed;
    },

    /**
     * 设置左侧导航顺序（持久化，下次进入自动恢复）
     * @param order 编排后的路由 path 数组
     */
    setMenuOrder(order: string[]): void {
      this.menuOrder = [...order];
    },

    /** 重置左侧导航顺序为默认（MENU_ITEMS 声明顺序） */
    resetMenuOrder(): void {
      this.menuOrder = [...MENU_DEFAULT_ORDER];
    },
  },

  persist: {
    key: STORAGE_NS_SETTINGS,
    storage: appStorage,
  },
});

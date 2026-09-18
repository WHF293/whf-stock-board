import { defineStore } from 'pinia';
import { HEATMAP_TOP_DEFAULT } from '../constants/index-symbols.constants';
import { HEATMAP_VIEW_MODE_DEFAULT } from '../constants/heatmap.constants';
import {
  BOARD_CALENDAR_HEAT_BASIS_DEFAULT,
  BOARD_CALENDAR_RANGE_DEFAULT,
} from '../constants/board-calendar.constants';
import { BOARD_DETAIL_RANGE_DEFAULT } from '../constants/board-detail.constants';
import { STORAGE_NS_SETTINGS } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import { REFRESH_INTERVAL_DEFAULT } from '../constants/polling.constants';
import { THEME_COLOR_DEFAULT } from '../constants/theme-color.constants';
import type { ThemeColor } from '../constants/theme-color.constants';
import { TREND_THEME_DEFAULT } from '../constants/trend-theme.constants';
import type { TrendTheme } from '../constants/trend-theme.constants';
import { WATERMARK_ENABLED_DEFAULT } from '../constants/watermark.constants';
import { SIDEBAR_COLLAPSED_DEFAULT } from '../constants/sidebar.constants';
import { WEBLOG_ENABLED_DEFAULT } from '../constants/weblog.constants';
import { MENU_DEFAULT_ORDER } from '../constants/router-meta.constants';
import { HEADER_DEFAULT_ORDER } from '../constants/header.constants';
import { PANORAMA_CN_VIEW_MODE_DEFAULT } from '../constants/panorama.constants';
import {
  CHART_MAIN_INDICATORS_DEFAULT,
  CHART_SUB_INDICATORS_DEFAULT,
} from '../constants/stock-indicator.constants';
import { CHART_PERIOD_DEFAULT, type ChartPeriod } from '../constants/stock-detail.constants';
import type { HeatmapViewMode } from '../types/heatmap.types';
import type { PanoramaCnViewMode } from '../constants/panorama.constants';
import type { BoardCalendarHeatBasis, BoardCalendarRange } from '../types/board-calendar.types';
import type { BoardDetailRange } from '../types/board-detail.types';
import { BOARD_DEFAULT_ORDER, normalizeBoardHidden, normalizeBoardOrder } from '../utils/board-order';

/**
 * 初始设置引导的默认完成态
 *
 * 判定依据：localStorage 里已存在设置持久化包 → 升级老用户（引导只面向新用户），
 * 默认 true 不弹出；全新安装无包 → false，首次启动弹引导。
 * 老包里没有 setupCompleted 字段，pinia persist 水合只覆盖已有键、保留该默认值；
 * 完成引导后写入 true 持久化，此后与普通设置项同生命周期。
 * @returns true 视为已完成引导（不弹出）
 */
const resolveSetupCompletedDefault = (): boolean =>
  appStorage.getItem(STORAGE_NS_SETTINGS) !== null;

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
  /** 左侧导航栏是否收起 */
  sidebarCollapsed: boolean;
  /** 左侧导航顺序（存路由 path 数组；默认按 MENU_ITEMS 声明顺序，插件菜单追加末尾） */
  menuOrder: string[];
  /** 左侧导航中被隐藏的页面 path（编排弹窗里关掉开关的项；侧栏不渲染但路由仍可达） */
  hiddenMenus: string[];
  /** 顶栏顺序（存条目键数组；宿主项为 id、插件条目为 `<pluginId>#<id>`；插件条目追加末尾） */
  headerOrder: string[];
  /** 顶栏中被隐藏的条目键（编排弹窗里关掉开关的项；不渲染） */
  hiddenHeaderItems: string[];
  /** 主题色（清新绿 / 淡雅蓝 / 淡雅粉 / 极光紫） */
  themeColor: ThemeColor;
  /** 涨跌配色主题（红涨绿跌 / 红跌绿涨 / 红涨蓝跌） */
  trendTheme: TrendTheme;
  /** 全局水印开关（默认开启） */
  watermarkEnabled: boolean;
  /** 板块日历 · 热门口径（决定行的排序） */
  boardCalendarHeatBasis: BoardCalendarHeatBasis;
  /** 板块日历 · 展示范围（交易日列数） */
  boardCalendarRange: BoardCalendarRange;
  /** 板块日历 · 板块列顺序（31 个代码的完整排列；等于默认序表示「按热门口径自动排序」） */
  boardCalendarOrder: string[];
  /** 板块日历 · 未勾选的板块代码（不在表格中渲染） */
  boardCalendarHidden: string[];
  /** 板块日历详情 · 展示范围（交易日列数；与看板页的范围各自独立） */
  boardDetailRange: BoardDetailRange;
  /** 股票详情 · 蜡烛模式主图指标清单（如 ['MA']，klinecharts 指标名） */
  chartMainIndicators: string[];
  /** 股票详情 · 蜡烛模式副图指标清单（如 ['VOL', 'MACD_KDJ']，每项独立面板） */
  chartSubIndicators: string[];
  /** 股票详情 · 图表周期（详情页与详情侧栏共用；记住用户上次的选择） */
  detailChartPeriod: ChartPeriod;
  /** 系统日志 · 采集开关（关闭后不再记录报错与行为，仅保留系统类事件） */
  weblogEnabled: boolean;
  /** Agent 分析 · 仅股票问答开关（开启时使用仅股票系统提示词；关闭后移除话题限制） */
  agentStockOnly: boolean;
  /** 初始设置引导是否已完成（首次打开软件时弹出引导弹窗，完成 / 关闭后不再出现） */
  setupCompleted: boolean;
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
    hiddenMenus: [],
    headerOrder: [...HEADER_DEFAULT_ORDER],
    hiddenHeaderItems: [],
    themeColor: THEME_COLOR_DEFAULT,
    trendTheme: TREND_THEME_DEFAULT,
    watermarkEnabled: WATERMARK_ENABLED_DEFAULT,
    boardCalendarHeatBasis: BOARD_CALENDAR_HEAT_BASIS_DEFAULT,
    boardCalendarRange: BOARD_CALENDAR_RANGE_DEFAULT,
    boardCalendarOrder: [...BOARD_DEFAULT_ORDER],
    boardCalendarHidden: [],
    boardDetailRange: BOARD_DETAIL_RANGE_DEFAULT,
    chartMainIndicators: [...CHART_MAIN_INDICATORS_DEFAULT],
    chartSubIndicators: [...CHART_SUB_INDICATORS_DEFAULT],
    detailChartPeriod: CHART_PERIOD_DEFAULT,
    weblogEnabled: WEBLOG_ENABLED_DEFAULT,
    agentStockOnly: true,
    setupCompleted: resolveSetupCompletedDefault(),
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

    /**
     * 设置左侧导航隐藏页集合（编排弹窗的显隐开关；持久化）
     * @param paths 被隐藏的页面 path 数组
     */
    setHiddenMenus(paths: string[]): void {
      this.hiddenMenus = [...paths];
    },

    /** 重置左侧导航：顺序恢复默认、全部页面重新显示 */
    resetMenuOrder(): void {
      this.menuOrder = [...MENU_DEFAULT_ORDER];
      this.hiddenMenus = [];
    },

    /**
     * 设置顶栏顺序（持久化，下次进入自动恢复）
     * @param order 编排后的条目键数组（宿主项 id + 插件条目全局键）
     */
    setHeaderOrder(order: string[]): void {
      this.headerOrder = [...order];
    },

    /**
     * 设置顶栏隐藏条目集合（编排弹窗的显隐开关；持久化）
     * @param keys 被隐藏的条目键数组
     */
    setHiddenHeaderItems(keys: string[]): void {
      this.hiddenHeaderItems = [...keys];
    },

    /** 重置顶栏：顺序恢复默认、全部条目重新显示 */
    resetHeaderOrder(): void {
      this.headerOrder = [...HEADER_DEFAULT_ORDER];
      this.hiddenHeaderItems = [];
    },

    /**
     * 设置板块日历 · 热门口径
     * @param basis 热门口径（取值须为 BOARD_CALENDAR_HEAT_BASIS 中的值）
     */
    setBoardCalendarHeatBasis(basis: BoardCalendarHeatBasis): void {
      this.boardCalendarHeatBasis = basis;
    },

    /**
     * 设置板块日历 · 展示范围
     * @param range 展示范围（取值须为 BOARD_CALENDAR_RANGE 中的值）
     */
    setBoardCalendarRange(range: BoardCalendarRange): void {
      this.boardCalendarRange = range;
    },

    /**
     * 设置板块日历详情 · 展示范围
     * @param range 展示范围（取值须为 BOARD_DETAIL_RANGE 中的值）
     */
    setBoardDetailRange(range: BoardDetailRange): void {
      this.boardDetailRange = range;
    },

    /**
     * 设置板块日历 · 板块列（顺序 + 未勾选项）
     *
     * 顺序等于默认序时表示未自定义行序，表格回到「按热门口径自动排序」。
     * @param order 列顺序（入库前归一化：丢未知、去重、补缺失到末尾）
     * @param hidden 未勾选的板块代码
     */
    setBoardCalendarColumns(order: string[], hidden: string[]): void {
      this.boardCalendarOrder = normalizeBoardOrder(order);
      this.boardCalendarHidden = normalizeBoardHidden(hidden);
    },

    /** 重置板块日历 · 板块列（全部勾选 + 默认顺序 = 恢复按热门口径自动排序） */
    resetBoardCalendarColumns(): void {
      this.boardCalendarOrder = [...BOARD_DEFAULT_ORDER];
      this.boardCalendarHidden = [];
    },

    /**
     * 设置股票详情 · 图表指标配置（主图叠加 + 副图面板，持久化）
     * @param mainIndicators 主图指标名数组
     * @param subIndicators 副图指标名数组
     */
    setChartIndicators(mainIndicators: string[], subIndicators: string[]): void {
      this.chartMainIndicators = [...mainIndicators];
      this.chartSubIndicators = [...subIndicators];
    },

    /**
     * 设置股票详情 · 图表周期（详情页与详情侧栏共用，持久化后下次打开即为该周期）
     *
     * 消费方请走 composables/use-chart-period.ts：它负责把本地选择写回本 store，
     * 并在读取时校验持久化值是否仍为合法周期。
     * @param period 图表周期（取值须为 CHART_PERIOD_OPTIONS 中的 value）
     */
    setDetailChartPeriod(period: ChartPeriod): void {
      this.detailChartPeriod = period;
    },

    /**
     * 设置系统日志采集开关
     *
     * 只改持久化状态；运行期的采集开关由 weblog 模块持有，
     * 设置页在切换时同步调用 `setWeblogEnabled`（避免 store 反向依赖采集模块）。
     * @param enabled true 开启采集
     */
    setWeblogEnabled(enabled: boolean): void {
      this.weblogEnabled = enabled;
    },

  /**
   * 设置 Agent 分析仅股票问答开关
   * @param enabled true 仅股票问答（默认），false 移除话题限制
   */
  setAgentStockOnly(enabled: boolean): void {
    this.agentStockOnly = enabled;
  },

  /** 标记初始设置引导已完成（无论用户点了「开始使用」还是直接关闭，都不再弹出） */
  completeSetup(): void {
    this.setupCompleted = true;
  },
},

  persist: {
    key: STORAGE_NS_SETTINGS,
    storage: appStorage,
  },
});

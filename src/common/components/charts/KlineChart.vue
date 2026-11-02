<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core';
import dayjs from 'dayjs';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  dispose,
  init,
  registerYAxis,
  type AxisCreateTicksParams,
  type AxisRange,
  type AxisTick,
  type Chart,
  type DeepPartial,
  type KLineData,
  type Styles,
  type TooltipLegend,
  type YAxis,
  type YAxisOverride,
  type YAxisTemplate,
} from 'klinecharts';
import {
  AXIS_TICK_COUNT,
  CANDLE_Y_AXIS_TICK_COUNT,
  CHART_AXIS_LINE_COLOR,
  CHART_GRID_LINE_CSS_VAR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants.ts';
import {
  startYAxisTextOverlay,
  type YAxisTextOverlayColors,
} from './axis-text-overlay';
import {
  MINUTE_AXIS_CONFIG,
  TIMELINE_PCT_AXIS_HEADROOM,
  type MinuteAxisMarket,
} from '../../constants/kline.constants.ts';
import { padMinuteBars } from '../../utils/pad-minute-bars';
import { readCssVar } from '../../utils/read-css-var';
import { readTrendColors } from '../../utils/trend-colors';
import { useTheme } from '../../composables/use-theme';
import { useSettingsStore } from '../../stores/settings';
import { isIndexSymbol } from '../../utils/normalize-a-share-code';
import type { TradeMark } from '../../utils/trade-marks';
import {
  INTRADAY_MACD_INDICATOR,
  INTRADAY_VOL_INDICATOR,
  TIMELINE_PRICE_INDICATOR,
} from './indicators/intraday-indicators';
import {
  TRADE_POINT_OVERLAY,
  type TradePointExtend,
} from './overlay-trade-point';
import './indicators/custom-indicators';

/**
 * K 线图（klinecharts 实现）：
 *
 * - timeline 模式（分时 / 五日）：主图分时面积线（淡雅蓝，固定色）+ 均价线；副图成交量 + MACD
 * - candle 模式（5分 / 日K / 周K / 月K）：主图蜡烛 + MA[5,10,30]，副图按配置清单（默认 VOL + MACD&KDJ）
 * - subVolumeOnly：副图强制只留成交量（详情侧栏用），两种模式下均忽略其他副图指标
 *
 * 轴规格：分时/五日为双 Y 轴（2026-11-02 王总指定）——左 = 实时价格、右 = 涨跌幅，
 * 两轴刻度坐标一致（左右网格线标签严格对应）；蜡烛模式 Y 轴在左（4 等分刻度）；
 * X 轴 5 等分；副图不显示 Y 轴刻度线；
 * 十字光标 / X 轴日期：分时/五日为 MM/DD HH:mm，其余为 YYYY/MM/DD
 *
 * 单日分时（intradayAxis）额外把序列补齐到全天固定时间轴，X 轴恒为 09:30~15:00，
 * 不随已发生的分钟数拉伸
 */
const props = defineProps<{
  /** klinecharts K 线序列（时间升序；分钟级附 avgPrice 字段） */
  bars: KLineData[];
  /** 图表模式 */
  mode: 'timeline' | 'candle';
  /** 昨收价（timeline 模式涨跌幅基准；缺失时回退可视区首根收盘） */
  preClose?: number | null;
  /** 外部强制重绘信号（自增 tick）：dock 拖拽结束后父级触发一次 */
  resizeTick?: number;
  /** 高度自适应：容器 h-full 由父级 flex 布局决定实际高度（默认定高 420px） */
  autoHeight?: boolean;
  /**
   * 定高模式的图表高度（px），不传用默认 420（与历史行为一致）。
   * 宽基ETF 等栅格小卡场景用更矮的定高（主图 + 成交量副图）
   */
  height?: number;
  /**
   * 蜡烛模式主图指标清单（klinecharts 指标名，如 ['MA','BOLL']）；
   * 不传用固定默认（MA + VOL + MACD_KDJ，与历史行为一致）。timeline 模式忽略
   */
  mainIndicators?: string[];
  /** 蜡烛模式副图指标清单（每项独立面板）；不传用固定默认。timeline 模式忽略 */
  subIndicators?: string[];
  /**
   * 副图只保留成交量：开启后忽略 subIndicators，蜡烛模式副图固定为 VOL，
   * timeline 模式不再挂 MACD（仅主图 + 均价线 + VOL）。
   * 详情侧栏（停靠面板）用——空间有限，只保留最必要的成交量副图
   */
  subVolumeOnly?: boolean;
  /**
   * 当前标的符号（sh600519 形态）：用于判定分时/五日是否绘制均价线——
   * 指数（sh000xxx / sz399xxx）无均价概念，不绘制；不传默认绘制
   */
  symbol?: string;
  /**
   * 是否使用「全天固定时间轴」（单日分时专用，五日不开）：
   * 序列补齐到 09:30~15:00 的固定分钟格，X 轴不随盘中进度拉伸
   */
  intradayAxis?: boolean;
  /**
   * 分时固定轴市场（cn A 股 / hk 港股）：单日分时的补齐轴、固定刻度、总格数
   * 按市场取配置（MINUTE_AXIS_CONFIG）；不传默认 'cn'，既有 A 股消费方零改动
   */
  market?: MinuteAxisMarket;
  /** 成交 BS/T 标注点（时间升序）；数据或标注变化时吸附最近 bar 重建覆盖物 */
  tradeMarks?: TradeMark[];
  /**
   * 盘中实时最后一根柱（2026-11-02 王总指定：轮询分时接口构建，见 use-kline-live）。
   * 经 loader subscribeBar 通道推送：时间戳相同覆盖最后一根 / 更大追加，
   * 不整图重载、不重置视口与十字光标；父级序列下次全量加载时自然并轨
   */
  liveBar?: KLineData | null;
}>();

const emit = defineEmits<{
  /** 十字光标悬停在 K 线上时发出该根 bar（原始数据）；离开图表时发 null */
  crosshairBar: [bar: KLineData | null];
}>();

const settingsStore = useSettingsStore();

/** 图表容器 */
const containerRef = ref<HTMLDivElement>();
/** klinecharts 实例 */
const chartRef = ref<Chart | null>(null);
/** Y 轴刻度文字着色覆盖层画布（原生刻度文字置透明，由覆盖层重绘，见模板注释） */
const axisTextCanvasRef = ref<HTMLCanvasElement>();
/** 覆盖层 rAF 循环停止句柄（onMounted 启动 / onBeforeUnmount 取消） */
let stopAxisTextOverlay: (() => void) | null = null;

/**
 * loader subscribeBar 通道句柄：图表 init 完成后注册推送回调，
 * setSymbol / setPeriod / resetData / dispose 时注销（v10 增量更新唯一通道——
 * 同时间戳覆盖最后一根 / 更大时间戳追加，不重置视口与十字光标）
 */
let liveBarPush: ((bar: KLineData) => void) | null = null;
/** 触发 loader 重新加载的自增序号（setSymbol 仅在变化时触发 init 加载） */
let loadSeq = 0;

/** 图表默认高度（px）：定高模式未传 height 时的兜底，与历史模板行为一致 */
const DEFAULT_CHART_HEIGHT_PX = 420;

/**
 * 轴刻度距面板上/下边缘的内缩（px）：刻度文本以 coord 为中心绘制，
 * 贴边刻度会有一半被面板边缘裁掉（2026-11-02 王总反馈「y 轴最上/最下数值遮挡」）；
 * 自定义 createTicks 按此值内缩，副图默认刻度由 filterEdgeAxisTicks 过滤
 */
const AXIS_TICK_EDGE_GAP_PX = 12;

/**
 * 容器高度样式：autoHeight 走 h-full + min-height（父级 flex 决定实际高）；
 * 定高模式用 height prop（默认 420）
 */
const containerStyle = computed(() =>
  props.autoHeight
    ? { height: '100%', minHeight: `${DEFAULT_CHART_HEIGHT_PX}px` }
    : { height: `${props.height ?? DEFAULT_CHART_HEIGHT_PX}px` },
);

/** 主图蜡烛面板 id（klinecharts 内置约定） */
const CANDLE_PANE_ID = 'candle_pane';

/** 主图 MA 周期（蜡烛模式） */
const MA_PERIODS = [5, 10, 30];

/**
 * 涨跌幅百分比 y 轴模板（仅 timeline 模式挂载）
 *
 * timeline 模式的数据在传入前已完成转换：close = (price - pre) / pre（昨收涨跌幅小数），
 * 轴上没有价格，只有涨跌幅小数值，因此默认恒等换算即可，仅需格式化刻度文本
 *
 * Y 轴固定以 0% 为中心上下对称：可视区最大绝对涨跌幅 × TIMELINE_PCT_AXIS_HEADROOM
 * 作为统一边界。库内会在 createRange 之后叠加非对称 gap（上 0.2 / 下 0.1），
 * 故这里把 gap 归零，留白全部由 createRange 内的系数提供
 *
 * 刻度固定三条（上界 / 0% / 下界）：水平网格线随之只有这三条，
 * 不再按 nice interval 铺满全轴（分时图只关心极值与昨收基准）
 */
const TIMELINE_PCT_YAXIS: YAxisTemplate = {
  name: 'timeline_pct',
  minSpan: () => 0.0001,
  displayValueToText: (value) => `${(value * 100).toFixed(2)}%`,
  gap: { top: 0, bottom: 0 },
  /**
   * 以 0 为中心重设轴范围（defaultRange 含主图分时线 + 均价线的极值）
   * @param params 轴范围创建参数
   * @param params.defaultRange 库内算出的默认范围（数据极值）
   * @returns 上下对称的轴范围
   */
  createRange: ({ defaultRange }): AxisRange => {
    const bound =
      Math.max(Math.abs(defaultRange.from), Math.abs(defaultRange.to)) *
      TIMELINE_PCT_AXIS_HEADROOM;
    const range = bound * 2;
    return {
      from: -bound,
      to: bound,
      range,
      realFrom: -bound,
      realTo: bound,
      realRange: range,
      displayFrom: -bound,
      displayTo: bound,
      displayRange: range,
    };
  },
  /**
   * 固定三条刻度（上界 / 0% / 下界），像素坐标按线性轴自行换算
   * （库内 defaultTicks 只含 nice interval 落点，不含轴上下界）；
   * 上下刻度内缩 AXIS_TICK_EDGE_GAP_PX，值随内缩坐标反推（避免文本被面板边缘裁半）
   * @param params 轴刻度创建参数
   * @param params.range 轴范围（displayFrom / displayTo / displayRange）
   * @param params.bounding 轴区域尺寸（height 为像素换算基准）
   * @param params.defaultTicks 库内默认刻度（首帧布局未完成时兜底用）
   * @returns 三条刻度（上界 / 0% / 下界）
   */
  createTicks: ({ range, bounding, defaultTicks }) => {
    const { displayTo, displayRange } = range;
    const height = bounding.height;
    if (displayRange <= 0 || height <= 0) return defaultTicks;
    const gap = AXIS_TICK_EDGE_GAP_PX;
    const valueAt = (coord: number): number =>
      displayTo - (coord / height) * displayRange;
    const toText = (value: number): string => `${(value * 100).toFixed(2)}%`;
    return [
      { coord: gap, value: valueAt(gap), text: toText(valueAt(gap)) },
      { coord: height / 2, value: 0, text: toText(0) },
      {
        coord: height - gap,
        value: valueAt(height - gap),
        text: toText(valueAt(height - gap)),
      },
    ];
  },
};

registerYAxis(TIMELINE_PCT_YAXIS);

/** 当前市场的分时固定轴配置（ranges / total / ticks，A 股缺省） */
const minuteAxisConfig = computed(() => MINUTE_AXIS_CONFIG[props.market ?? 'cn']);

/**
 * timeline 模式的展示数据派生（分时 / 五日专用，蜡烛模式原样透传）：
 *
 * - 单日分时（intradayAxis）：先把序列补齐到全天固定时间轴，未发生的分钟为占位 bar，
 *   X 轴因此恒定横跨 09:30~15:00
 * - price：原始价格（转换前的 close）
 * - pre：昨收基准（取 preClose，快照未就绪时回退首根真实收盘）
 * - close：涨跌幅小数 = (price - pre) / pre，保留 3 位小数
 * - avgPrice：均价同步转为涨跌幅小数（与 close 同轴，否则均价线画出范围）
 * - avgPriceRaw：原始均价（tooltip 展示「价格 + 涨跌幅」用）
 *
 * 占位 bar 的 close / avgPrice 均为 NaN：面积线与均价线的绘制会被图表库跳过
 */
/**
 * 分时涨跌幅轴的单 bar 转换（displayBars 全量派生与实时柱推送共用，避免口径漂移）：
 * price = 原始价格；close = 涨跌幅小数 = (price - pre) / pre（保留 3 位）；
 * avgPrice 同步转为涨跌幅小数（与 close 同轴），原始均价存 avgPriceRaw
 * @param bar 原始 bar（close = 价格）
 * @param pre 昨收基准
 * @returns 转换后 bar
 */
const transformTimelineBar = (bar: KLineData, pre: number): KLineData => {
  const round3 = (value: number): number => Number(value.toFixed(3));
  const price = bar.close;
  const avgPriceRaw = typeof bar.avgPrice === 'number' ? bar.avgPrice : null;
  return {
    ...bar,
    price,
    pre,
    close: round3((price - pre) / pre),
    avgPrice:
      avgPriceRaw === null ? bar.avgPrice : round3((avgPriceRaw - pre) / pre),
    avgPriceRaw,
  };
};

const displayBars = computed<KLineData[]>(() => {
  if (props.mode !== 'timeline') return props.bars;
  const bars = props.intradayAxis
    ? padMinuteBars(props.bars, minuteAxisConfig.value.ranges)
    : props.bars;
  const pre = props.preClose ?? props.bars[0]?.close ?? null;
  if (!pre) return bars;
  return bars.map((bar) => transformTimelineBar(bar, pre));
});

/**
 * 是否为分时占位分钟（尚未发生）：占位 bar 的价格为 NaN
 * @param bar K 线
 * @returns 是否无成交数据
 */
const isEmptyBar = (bar: KLineData): boolean => !Number.isFinite(bar.close);

/**
 * 分时 tooltip 自定义：开/高/低/收显示「价格（相对昨收涨跌幅）」，
 * 如 `10.10（+4.23%）`；数据取自 displayBars（price/pre/close 已就位）。
 * 占位分钟（尚未发生）不渲染 tooltip
 * @param data 十字光标邻域数据
 * @param data.current
 * @returns tooltip 图例列表
 */
const timelineCandleTooltipLegends = (data: {
  current: KLineData | null;
}): TooltipLegend[] => {
  const bar = data.current as (KLineData & { price?: number; pre?: number }) | null;
  if (!bar || isEmptyBar(bar)) return [];
  const pre = bar.pre;
  const formatItem = (label: string, price: number | undefined, pct?: number): TooltipLegend => ({
    title: label,
    value: `${price?.toFixed(2) ?? '--'}（${pct === undefined || pct === null ? '--' : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(2)}%`}）`,
  });
  const pctOf = (value: number | undefined): number | undefined =>
    pre && value !== undefined ? (value - pre) / pre : undefined;
  return [
    formatItem('开', bar.open, pctOf(bar.open)),
    formatItem('高', bar.high, pctOf(bar.high)),
    formatItem('低', bar.low, pctOf(bar.low)),
    // close 已是涨跌幅小数，price 才是原始价
    formatItem('收', bar.price, bar.close),
    { title: '成交量', value: String(bar.volume ?? '--') },
  ];
};

/** 当前涨跌色阶（依赖 trendTheme，切换时本 computed 消费方自动重算） */
const trendSet = computed(() => {
  void settingsStore.trendTheme;
  return readTrendColors();
});

const { isDark } = useTheme();

/**
 * 网格线颜色：读主题 token --color-flat-weak（亮 #eef1f5 / 暗 #232a33，极淡灰，
 * 随明暗与主题色变体自动切换）。canvas 内不能直接用 var()，经 readCssVar 解析；
 * 依赖 isDark 使明暗切换时本 computed 失效重算。变量缺失时回退亮色分隔线常量
 */
const gridColor = computed(() => {
  void isDark.value;
  return readCssVar(CHART_GRID_LINE_CSS_VAR) || CHART_SPLIT_LINE_COLOR;
});

/**
 * 构建图表样式（蜡烛涨跌色 / 轴线 / 网格线均取当前主题色）
 * @returns klinecharts 样式覆盖对象
 */
const buildStyles = (): DeepPartial<Styles> => {
  const trend = trendSet.value;
  const isTimeline = props.mode === 'timeline';
  return {
    // 水平网格线全模式开启：分时 / 五日为三条（上下界 + 0%，见 timeline_pct 模板
    // 的 createTicks），蜡烛为四条（上下界 + 三等分两点，见 buildCandleYAxisTicks）；
    // 副图（VOL / MACD）仍按各自默认刻度铺线；纵向网格线仅分时 / 五日开启：
    // 分时 = 固定时刻，五日 = 交易日分界
    grid: {
      horizontal: { show: true, color: gridColor.value },
      vertical: { show: isTimeline, color: gridColor.value },
    },
    candle: {
      type: isTimeline ? 'area' : 'candle_solid',
      bar: {
        upColor: trend.up,
        downColor: trend.down,
        noChangeColor: trend.flat,
        upBorderColor: trend.up,
        downBorderColor: trend.down,
        noChangeBorderColor: trend.flat,
        upWickColor: trend.up,
        downWickColor: trend.down,
        noChangeWickColor: trend.flat,
      },
      area: {
        // 分时 / 五日固定淡雅蓝，不随涨跌配色主题变化
        lineSize: 1,
        lineColor: '#4f83cc',
        value: 'close',
        backgroundColor: [
          { offset: 0, color: 'rgba(79, 131, 204, 0.22)' },
          { offset: 1, color: 'rgba(79, 131, 204, 0.02)' },
        ],
      },
      // 分时 tooltip：开高低收显示「价格（涨跌幅）」；蜡烛模式保留默认模板
      ...(isTimeline
        ? { tooltip: { legend: { template: timelineCandleTooltipLegends } } }
        : {}),
    },
    xAxis: {
      axisLine: { color: CHART_AXIS_LINE_COLOR },
      tickText: { color: CHART_TEXT_COLOR },
      tickLine: { color: CHART_AXIS_LINE_COLOR },
    },
    yAxis: {
      axisLine: { color: CHART_AXIS_LINE_COLOR },
      // 刻度文字置透明（show 保持 true，轴自动宽度照常计算）：
      // 实际显示由轴文字覆盖层按涨跌着色重绘（红涨绿跌，见 axis-text-overlay.ts）
      tickText: { color: 'transparent' },
      tickLine: { color: CHART_AXIS_LINE_COLOR },
    },
    separator: { color: CHART_SPLIT_LINE_COLOR },
  };
};

/** 主图区实际像素宽度（X 轴 bounding 宽度，由 buildXAxisTicks 捕获，见其注释） */
let axisWidth = 0;

/**
 * 分时 X 轴固定刻度的轴下标
 *
 * 按当前市场分时轴刻度（minuteAxisConfig.ticks）的时刻在补齐后的序列里定位
 */
const minuteAxisTickMarks = computed<{ index: number; timestamp: number; label: string }[]>(
  () => {
    const bars = displayBars.value;
    if (!props.intradayAxis || bars.length === 0) return [];
    const day = dayjs(bars[0].timestamp).format('YYYY-MM-DD');
    const marks: { index: number; timestamp: number; label: string }[] = [];
    for (const tick of minuteAxisConfig.value.ticks) {
      const timestamp = dayjs(`${day} ${tick.time}`).valueOf();
      const index = bars.findIndex((bar) => bar.timestamp === timestamp);
      if (index >= 0) marks.push({ index, timestamp, label: tick.label });
    }
    return marks;
  },
);

/**
 * 五日 X 轴刻度的轴下标：每个交易日首根 bar（日期分界）
 *
 * label 为该交易日 MM/DD。首个交易日的分界线与面板左边缘重合
 * （网格线无分隔意义、标签会被裁切），跳过
 */
const fiveDayAxisTickMarks = computed<{ index: number; timestamp: number; label: string }[]>(
  () => {
    const bars = displayBars.value;
    if (props.mode !== 'timeline' || props.intradayAxis || bars.length === 0) return [];
    const marks: { index: number; timestamp: number; label: string }[] = [];
    let prevDay = '';
    bars.forEach((bar, index) => {
      const day = dayjs(bar.timestamp).format('YYYY-MM-DD');
      if (day === prevDay) return;
      prevDay = day;
      if (index === 0) return;
      marks.push({
        index,
        timestamp: bar.timestamp ?? 0,
        label: dayjs(bar.timestamp).format('MM/DD'),
      });
    });
    return marks;
  },
);

/**
 * X 轴刻度：
 *
 * - 单日分时：固定标注全天关键时刻（09:30 / 10:30 / 11:30 / 14:00 / 15:00），
 *   与已发生的分钟数无关；横坐标按「全天固定轴恰好铺满主图区」换算
 * - 五日：每个交易日首根 bar 为分界（MM/DD 标签），坐标按库内
 *   dataIndexToCoordinate 同款线性式换算（(i - from + 0.5) × barSpace + 0.5）
 * - 蜡烛模式：可见区 5 等分（沿用原口径）
 *
 * 顺带捕获 X 轴 bounding 宽度（= 主图区宽度）：分时的 barSpace 要用它把全天
 * 分钟格铺满，直接用容器宽度（含左侧 Y 轴刻度）会把头几根分钟挤出可视区
 * @param params 轴创建参数
 * @returns 刻度序列
 */
const buildXAxisTicks = (params: AxisCreateTicksParams): AxisTick[] => {
  if (props.mode === 'timeline' && params.bounding.width > 0) {
    if (params.bounding.width !== axisWidth) {
      axisWidth = params.bounding.width;
      // 轴宽变化（首次布局 / 容器缩放 / Y 轴刻度宽度变化）后按新宽度重新铺满；
      // 布局中不可重入，下一帧再调整
      void nextTick(() => fitTimelineBarSpace());
    }
    if (props.intradayAxis) {
      const barSpace = axisWidth / minuteAxisConfig.value.total;
      return minuteAxisTickMarks.value.map((mark) => ({
        coord: (mark.index + 0.5) * barSpace,
        value: mark.timestamp,
        text: mark.label,
      }));
    }
    // 五日：barSpace 以图表实例当前值为准（fitTimelineBarSpace 设置的取整值）
    const barSpace = chartRef.value?.getBarSpace().bar ?? 0;
    const marks = fiveDayAxisTickMarks.value;
    if (barSpace <= 0 || marks.length === 0) return params.defaultTicks;
    return marks.map((mark) => ({
      coord: (mark.index - params.range.from + 0.5) * barSpace + 0.5,
      value: mark.timestamp,
      text: mark.label,
    }));
  }
  const from = Math.floor(params.range.realFrom);
  const to = Math.ceil(params.range.realTo);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return params.defaultTicks;
  // 默认刻度不足 N 个（如放大到很少的根数）无法等分，保留默认刻度
  if (params.defaultTicks.length < AXIS_TICK_COUNT) return params.defaultTicks;
  const step = (to - from) / (AXIS_TICK_COUNT - 1);
  const ticks: AxisTick[] = [];
  for (let i = 0; i < AXIS_TICK_COUNT; i += 1) {
    ticks.push({ ...params.defaultTicks[i], value: Math.round(from + step * i) });
  }
  return ticks;
};

/**
 * 按 mode 挂载主图 / 副图指标
 *
 * 蜡烛模式按 mainIndicators / subIndicators 清单挂载（未传时用固定默认，
 * 与历史行为一致）；timeline 模式固定四件套，不参与配置。
 * @param chart 图表实例
 */
/** 分时/五日是否绘制均价线：指数无均价概念，仅个股绘制 */
const showAvgLine = computed(() => !props.symbol || !isIndexSymbol(props.symbol));

/**
 * 分时实时价格轴的实例 id（createYAxis 返回值）
 *
 * ⚠️ 轴的一切后续定位（overrideYAxis 精确命中 / removeYAxis 清理）必须用 id——
 * 模板类构造时 name 已被烧死为 'normal'（YAxisImp.override 的 name 只在首次为空时
 * 生效），传入的 name: 'timeline_price' 不会留在实例上；按 name 找不到、按 paneId
 * 过滤又会命中面板里全部轴（把价格轴一起覆盖成涨跌幅轴，左轴消失）
 */
let timelinePriceAxisId: string | null = null;

/**
 * 分时实时价格轴锚点（昨收 + 对称边界）
 *
 * 与涨跌幅轴同口径：pre 取 preClose（快照未就绪回退首根真实收盘），
 * bound = 价格相对昨收的最大偏差 × 同一 HEADROOM 系数——价格 = 昨收 × (1 + 涨跌幅)
 * 与涨跌幅同为线性映射，两轴刻度坐标一致时左右网格线标签严格对应。
 * 盘中实时柱（props.liveBar，close = 价格）一并计入，轴范围随最新价即时扩张
 *
 * @returns 锚点；无有效数据（盘前全占位 / 无昨收）时为 null
 */
const timelinePriceAnchor = (): { pre: number; bound: number } | null => {
  const pre =
    props.preClose ??
    props.bars.find((bar) => Number.isFinite(bar.close))?.close ??
    Number.NaN;
  if (!Number.isFinite(pre) || pre <= 0) return null;
  let maxPct = 0;
  const consider = (price: number): void => {
    if (Number.isFinite(price)) {
      maxPct = Math.max(maxPct, Math.abs(price / pre - 1));
    }
  };
  for (const bar of displayBars.value) {
    consider((bar as KLineData & { price?: number }).price ?? Number.NaN);
  }
  consider(props.liveBar?.close ?? Number.NaN);
  if (maxPct <= 0) return null;
  return { pre, bound: pre * maxPct * TIMELINE_PCT_AXIS_HEADROOM };
};

/**
 * 分时实时价格轴创建参数（双轴左轴，2026-11-02 王总指定：左 = 实时价格 / 右 = 涨跌幅）
 *
 * 直接以 override 对象传给 createYAxis（含闭包，不注册全局模板——pre 随组件实例走，
 * 详情页与侧栏面板可同时展示不同标的）。范围以锚点对称展开，涨跌幅轴的 gap 已归零，
 * 两轴刻度坐标（上/中/下同内缩）对应同一像素位置。
 * name 仅文档用途——模板类构造时已把 name 烧死为 'normal'，实例上不生效，
 * 后续定位全靠 createYAxis 返回的 id（见 timelinePriceAxisId 注释）
 *
 * @returns 价格轴创建参数（YAxisOverride）
 */
const buildTimelinePriceAxis = (): YAxisOverride => ({
  name: 'timeline_price',
  position: 'left',
  gap: { top: 0, bottom: 0 },
  createRange: ({ defaultRange }): AxisRange => {
    const anchor = timelinePriceAnchor();
    if (!anchor) return defaultRange;
    const { pre, bound } = anchor;
    const range = bound * 2;
    return {
      from: pre - bound,
      to: pre + bound,
      range,
      realFrom: pre - bound,
      realTo: pre + bound,
      realRange: range,
      displayFrom: pre - bound,
      displayTo: pre + bound,
      displayRange: range,
    };
  },
  createTicks: ({ range, bounding, defaultTicks }) => {
    const { displayTo, displayRange } = range;
    const height = bounding.height;
    if (displayRange <= 0 || height <= 0) return defaultTicks;
    const gap = AXIS_TICK_EDGE_GAP_PX;
    const valueAt = (coord: number): number =>
      displayTo - (coord / height) * displayRange;
    return [
      { coord: gap, value: valueAt(gap), text: valueAt(gap).toFixed(2) },
      {
        coord: height / 2,
        value: valueAt(height / 2),
        text: valueAt(height / 2).toFixed(2),
      },
      {
        coord: height - gap,
        value: valueAt(height - gap),
        text: valueAt(height - gap).toFixed(2),
      },
    ];
  },
});

const setupIndicators = (chart: Chart): void => {
  if (props.mode === 'timeline') {
    // 双 y 轴：左 = 实时价格（透明价格线 TIMELINE_PRICE 撑轴数据源），
    // 右 = 涨跌幅（原左轴迁右，见 applyAxisOptions）。
    // 重建路径先按 id 删旧轴（幂等；name 已被模板烧死为 'normal'，按 name 删不中）
    if (timelinePriceAxisId) {
      chart.removeYAxis({ id: timelinePriceAxisId });
    }
    const priceAxisId = chart.createYAxis(buildTimelinePriceAxis());
    timelinePriceAxisId = priceAxisId;
    chart.createIndicator(
      {
        ...TIMELINE_PRICE_INDICATOR,
        paneId: CANDLE_PANE_ID,
        ...(priceAxisId ? { yAxisId: priceAxisId } : {}),
      },
      true,
    );
    // 分时均价线叠加主图（仅个股）；副图成交量 + MACD（subVolumeOnly 时只留成交量）
    if (showAvgLine.value) {
      chart.createIndicator({ name: 'AVG_PRICE', paneId: CANDLE_PANE_ID }, true);
    }
    // 单日分时含「尚未发生」的占位分钟，用空值安全口径的 VOL / MACD，
    // 避免内置实现把 NaN 渲染进指标图例（见 indicators/intraday-indicators）
    chart.createIndicator(props.intradayAxis ? INTRADAY_VOL_INDICATOR : 'VOL');
    if (!props.subVolumeOnly) {
      chart.createIndicator(props.intradayAxis ? INTRADAY_MACD_INDICATOR : 'MACD');
    }
    return;
  }
  const main = props.mainIndicators ?? ['MA'];
  const sub = props.subVolumeOnly
    ? ['VOL']
    : (props.subIndicators ?? ['VOL', 'MACD_KDJ']);
  // 主图指标叠加蜡烛面板（MA 用本项目口径 [5,10,30]，其余走内置默认参数）
  for (const name of main) {
    if (name === 'MA') {
      chart.createIndicator({
        name: 'MA',
        paneId: CANDLE_PANE_ID,
        calcParams: MA_PERIODS,
      });
    } else {
      chart.createIndicator({ name, paneId: CANDLE_PANE_ID });
    }
  }
  // 副图指标：不传 paneId，klinecharts 自动新建独立面板
  for (const name of sub) {
    chart.createIndicator(name);
  }
};

/**
 * 应用轴规格：主图 Y 轴左 + 3 等分；副图隐藏 Y 轴刻度线；
 * X 轴 5 等分；分时/五日主图使用 percentage 涨跌幅轴；分时/五日锁定缩放
 * @param chart
 */
/**
 * 蜡烛模式主图 Y 轴固定刻度：上下界 + 中间三等分两点，共 4 条水平网格线
 *
 * 库内默认刻度按 nice interval 取落点（条数不定且不含轴上下界），
 * 这里改为在轴区间内等分取值，像素按线性轴换算（coord = height × k / (n-1)）；
 * 小数位跟随库内默认刻度文本（价格精度由 symbol 决定）
 * @param params 轴刻度创建参数
 * @returns 固定条数的刻度（首帧无默认刻度时回退 defaultTicks）
 */
const buildCandleYAxisTicks = (params: AxisCreateTicksParams): AxisTick[] => {
  const { displayTo, displayRange } = params.range;
  const height = params.bounding.height;
  const gap = AXIS_TICK_EDGE_GAP_PX;
  if (displayRange <= 0 || height <= gap * 2 || params.defaultTicks.length === 0) {
    return params.defaultTicks;
  }
  const decimals = Math.max(
    0,
    ...params.defaultTicks.map((tick) => tick.text.split('.')[1]?.length ?? 0),
  );
  return Array.from({ length: CANDLE_Y_AXIS_TICK_COUNT }, (_, k) => {
    const value = displayTo - (displayRange * k) / (CANDLE_Y_AXIS_TICK_COUNT - 1);
    // 刻度坐标内缩 AXIS_TICK_EDGE_GAP_PX：贴边刻度文本会被面板边缘裁半
    const coord = gap + ((height - gap * 2) * k) / (CANDLE_Y_AXIS_TICK_COUNT - 1);
    return {
      coord,
      value,
      text: value.toFixed(decimals),
    };
  });
};

/**
 * 副图轴刻度过滤：剔除贴边刻度（库内默认刻度含上下界，矮面板上首末刻度
 * 文本会被面板边缘裁掉一半，2026-11-02 王总反馈 VOL「21M」/ MACD「0.0000」被遮挡）
 * @param params 轴刻度创建参数
 * @returns 过滤后的刻度
 */
const filterEdgeAxisTicks = (params: AxisCreateTicksParams): AxisTick[] => {
  const height = params.bounding.height;
  const gap = AXIS_TICK_EDGE_GAP_PX;
  if (height <= 0) return params.defaultTicks;
  return params.defaultTicks.filter(
    (tick) => tick.coord >= gap && tick.coord <= height - gap,
  );
};

const applyAxisOptions = (chart: Chart): void => {
  const isTimeline = props.mode === 'timeline';
  // 主图 Y 轴：分时/五日为双轴——左 = 实时价格（setupIndicators 里 createYAxis），
  // 右 = 涨跌幅百分比轴（价格空间换算的自定义模板，固定三条刻度）；
  // 蜡烛模式用默认轴（左）但固定四条刻度（buildCandleYAxisTicks）。
  // ⚠️ timeline 分支不能显式传 createTicks: undefined——库内 merge 会把 undefined
  // 覆盖到轴实例上，打掉 timeline_pct 模板自带的 createTicks
  // ⚠️ 必须按 id 精确命中默认轴：不带 id 的 override 按 paneId 匹配面板里**全部**轴，
  // 会把价格轴一起重建为右置涨跌幅轴（左轴消失，右侧两列百分比，2026-11-02 实测翻车）
  const defaultAxis = chart
    .getYAxes({ paneId: CANDLE_PANE_ID })
    .find((axis) => axis.id !== timelinePriceAxisId);
  chart.overrideYAxis({
    paneId: CANDLE_PANE_ID,
    id: defaultAxis?.id,
    position: isTimeline ? 'right' : 'left',
    name: isTimeline ? 'timeline_pct' : 'normal',
    ...(isTimeline ? {} : { createTicks: buildCandleYAxisTicks }),
  });
  if (!isTimeline) {
    // 蜡烛模式不保留分时价格轴（指标已随 removeIndicator 清掉，此处按 id 删轴；
    // name 被模板烧死为 'normal'，按 name 删不中）
    if (timelinePriceAxisId) {
      chart.removeYAxis({ id: timelinePriceAxisId });
      timelinePriceAxisId = null;
    }
  }
  // 副图（成交量 / MACD / MACD&KDJ）：保留轴标但隐藏刻度线；
  // 默认刻度过滤贴边项（矮面板首末刻度文本会被面板边缘裁半）
  chart.getIndicators().forEach((indicator) => {
    if (indicator.paneId === CANDLE_PANE_ID) return;
    chart.overrideYAxis({
      paneId: indicator.paneId,
      position: 'left',
      needWidget: true,
      createTicks: filterEdgeAxisTicks,
    });
  });
  // X 轴刻度：单日分时为全天固定时刻，其余为可见区 5 等分（见 buildXAxisTicks）
  chart.overrideXAxis({ createTicks: buildXAxisTicks });
  // 分时 / 五日：禁用缩放与滚动，固定全量展示（setScrollEnabled(false) 后
  // setDataLoader 内部 resetData 的滚动重置也不可再拖动视窗）
  chart.setZoomEnabled(!isTimeline);
  chart.setScrollEnabled(!isTimeline);
  chart.overrideXAxis({ scrollZoomEnabled: !isTimeline });
};

/**
 * 二分吸附：返回 |timestamp 差| 最小的 bar 下标
 * @param bars K 线序列（时间升序）
 * @param timestamp 目标时间戳
 * @returns 最近 bar 下标
 */
const snapBarIndex = (bars: KLineData[], timestamp: number): number => {
  let lo = 0;
  let hi = bars.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((bars[mid].timestamp ?? 0) < timestamp) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (
    lo > 0 &&
    Math.abs((bars[lo - 1].timestamp ?? 0) - timestamp) <=
      Math.abs((bars[lo].timestamp ?? 0) - timestamp)
  ) {
    return lo - 1;
  }
  return lo;
};

/**
 * 解析标注徽标延伸方向：成交价高于基准价画在下面、低于画在上面
 * （分钟级基准 = 昨收，蜡烛基准 = 当日开盘价，由调用方给定；
 * 基准或成交价缺失 / 恰好相等时按类型兜底：B 向下、S/T 向上）
 * @param mark 标注点
 * @param refPrice 方向判定基准价（分钟级昨收 / 蜡烛当日开盘价）
 * @returns 延伸方向
 */
const resolveMarkSide = (mark: TradeMark, refPrice: number): TradePointExtend['side'] => {
  if (refPrice > 0 && mark.price > 0 && mark.price !== refPrice) {
    return mark.price > refPrice ? 'below' : 'above';
  }
  return mark.type === 'B' ? 'below' : 'above';
};

/**
 * 重建成交 BS/T 标注覆盖物
 *
 * 每个标注吸附到最近 bar（超出容差视为不在可视范围，如五日图外的历史成交）；
 * 延伸方向按「成交价 vs 基准价」判定——分钟级（分时/五日）基准昨收、蜡烛基准当日
 * 开盘价，高于基准 → 徽标画在下方、低于 → 上方；
 * 锚点 value：分时/五日用当分钟涨跌幅（displayBars 已换算的 close），
 * 蜡烛模式向下锚 bar.low / 向上锚 bar.high；
 * 圆点 + 连接线 + 圆角徽标的绘制在覆盖物 createPointFigures 里做（像素级）。
 */
const rebuildTradeOverlays = (): void => {
  const chart = chartRef.value;
  if (!chart) return;
  chart.removeOverlay({ name: TRADE_POINT_OVERLAY });
  const marks = props.tradeMarks ?? [];
  const bars = displayBars.value;
  if (marks.length === 0 || bars.length === 0) return;
  const isTimeline = props.mode === 'timeline';
  const interval =
    bars.length > 1 ? (bars[1].timestamp ?? 0) - (bars[0].timestamp ?? 0) : 0;
  // 分时/五日 1 分钟 bar：容差 3 分钟；蜡烛（日K）容差取 0.9 根 bar（跨周末也能吸附）
  const tolerance = isTimeline ? 3 * 60_000 : Math.max(interval * 0.9, 3 * 3600_000);
  const creates: {
    name: string;
    points: { timestamp?: number; value?: number }[];
    extendData: TradePointExtend;
  }[] = [];
  for (const mark of marks) {
    const index = snapBarIndex(bars, mark.timestamp);
    const bar = bars[index];
    if (!bar || Math.abs((bar.timestamp ?? 0) - mark.timestamp) > tolerance) continue;
    // 方向基准：分钟级取 bar 自带的昨收（displayBars 派生字段 pre，与涨跌幅轴同口径，
    // preClose 快照未就绪时它已回退首根真实收盘）；蜡烛取当日开盘价
    const refPrice = isTimeline
      ? ((bar as KLineData & { pre?: number }).pre ?? 0)
      : (bar.open ?? 0);
    const side = resolveMarkSide(mark, refPrice);
    const value = isTimeline ? bar.close : side === 'below' ? bar.low : bar.high;
    creates.push({
      name: TRADE_POINT_OVERLAY,
      points: [{ timestamp: bar.timestamp, value }],
      extendData: { type: mark.type, side },
    });
  }
  if (creates.length > 0) {
    chart.createOverlay(creates);
  }
};

/**
 * 分时 / 五日 barSpace 适配
 *
 * - 单日分时：按「全天固定轴恰好铺满主图区」取 barSpace（浮点，下限 1px），
 *   并把右侧留白归零，使 09:30~15:00 正好铺满画布
 * - 五日：按数据根数铺满（下限 1px，保持原有取整口径）
 */
const fitTimelineBarSpace = (): void => {
  const chart = chartRef.value;
  if (!chart || props.mode !== 'timeline') return;
  const count = displayBars.value.length;
  if (count === 0) return;
  const width = props.intradayAxis
    ? axisWidth
    : (containerRef.value?.clientWidth ?? 0);
  if (width <= 0) return;
  const barSpace = props.intradayAxis
    ? Math.max(1, width / count)
    : Math.max(1, Math.floor(width / count));
  if (Math.abs(chart.getBarSpace().bar - barSpace) > 0.01) {
    chart.setBarSpace(barSpace);
  }
  if (props.intradayAxis) {
    chart.setOffsetRightDistance(0);
  }
};

/**
 * 注入数据：重设 loader 并以新 ticker 触发 init 加载（v10 数据只能经 loader 通道进入）
 */
const applyData = (): void => {
  const chart = chartRef.value;
  if (!chart) return;
  chart.setDataLoader({
    getBars: ({ callback }) => {
      callback(displayBars.value, { forward: false, backward: false });
      if (props.mode === 'timeline' && displayBars.value.length > 0) {
        // 首屏渲染后再 resize 让父容器高度稳定后画布正确铺开；
        // 分时轴宽由布局回调捕获，barSpace 在下一帧按真实主轴宽度铺满
        nextTick(() => {
          chart.resize();
          fitTimelineBarSpace();
        });
      }
    },
    // 盘中实时柱通道（父级经 liveBar prop 驱动）：push 单根，图表按 ts 原地合并
    subscribeBar: ({ callback }) => {
      liveBarPush = callback;
    },
    unsubscribeBar: () => {
      liveBarPush = null;
    },
  });
  chart.setSymbol({
    ticker: `${props.mode}-${loadSeq++}`,
    pricePrecision: 2,
    volumePrecision: 0,
  });
  chart.setPeriod({ type: 'day', span: 1 });
  rebuildTradeOverlays();
};

/**
 * 两位补零
 * @param n 数字
 * @returns 两位字符串
 */
const pad2 = (n: number): string => n.toString().padStart(2, '0');

/**
 * 跨模式通用十字光标 / X 轴日期格式化
 * @param timestamp 毫秒时间戳
 * @param mode 图表模式
 * @returns 格式化日期文本
 */
const formatCrosshairDate = (
  timestamp: number,
  mode: 'timeline' | 'candle',
): string => {
  const d = new Date(timestamp);
  if (mode === 'timeline') {
    return `${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  }
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())}`;
};

/**
 * 当前模式的日期格式化器（由 setupChart 注入 chart.setFormatter）
 * @returns 格式化日期文本
 * @param params
 * @param params.timestamp
 */
const formatDateByMode = (params: { timestamp: number }): string =>
  formatCrosshairDate(params.timestamp, props.mode);

/**
 * Y 轴刻度文字着色基准（上方涨色 / 下方跌色 / 相等中性，2026-11-02 王总需求）：
 * - 主图（蜡烛面板）轴有基准：分时价格轴 = 昨收（与涨跌幅口径一致）、
 *   分时涨跌幅轴 = 0；蜡烛模式价格轴 = 最新一根柱收盘（现价，随 liveBar 走）
 * - 副图（VOL / MACD 等）轴无涨跌语义，返回 null → 全部中性色
 * @param paneId 面板 id
 * @param axis 轴实例
 * @returns 基准值；null 表示不着色
 */
const resolveAxisBaseline = (paneId: string, axis: YAxis): number | null => {
  if (paneId !== CANDLE_PANE_ID) return null;
  if (props.mode === 'timeline') {
    if (timelinePriceAxisId && axis.id === timelinePriceAxisId) {
      return props.preClose ?? props.bars[0]?.close ?? null;
    }
    return 0;
  }
  // 蜡烛模式取图表实时序列最后一根收盘（liveBar 增量推送后即最新价）
  const dataList = chartRef.value?.getDataList() ?? [];
  const last = dataList[dataList.length - 1]?.close;
  if (Number.isFinite(last)) return last as number;
  const fallback = props.bars[props.bars.length - 1]?.close;
  return Number.isFinite(fallback) ? (fallback as number) : null;
};

/**
 * 覆盖层三色：跟随涨跌色阶主题（切主题经签名比对自动重绘）
 * @returns 涨/跌/中性色
 */
const buildAxisTextColors = (): YAxisTextOverlayColors => ({
  up: trendSet.value.up,
  down: trendSet.value.down,
  neutral: CHART_TEXT_COLOR,
});

onMounted(() => {
  if (!containerRef.value) return;
  const chart = init(containerRef.value, { locale: 'zh-CN' });
  if (!chart) return;
  chartRef.value = chart;

  chart.setStyles(buildStyles());
  setupIndicators(chart);
  applyAxisOptions(chart);
  chart.setFormatter({ formatDate: (timestamp) => formatDateByMode(timestamp) });
  // 十字光标联动：悬停 bar 对外发事件（行情头联动展示），离开发 null；
  // 分时占位分钟（尚未发生）无价格，按未悬停处理，避免行情头展示 NaN
  chart.subscribeAction('onCrosshairChange', (raw) => {
    const data = raw as { kLineData?: KLineData } | undefined;
    const bar = data?.kLineData;
    emit('crosshairBar', bar && !isEmptyBar(bar) ? bar : null);
  });
  applyData();

  // Y 轴刻度文字着色覆盖层（图表实例就绪前后启动均可，未就绪时循环空转）
  stopAxisTextOverlay = startYAxisTextOverlay({
    getChart: () => chartRef.value,
    getCanvas: () => axisTextCanvasRef.value ?? null,
    resolveBaseline: resolveAxisBaseline,
    getColors: buildAxisTextColors,
  });
});

onBeforeUnmount(() => {
  stopAxisTextOverlay?.();
  stopAxisTextOverlay = null;
  if (chartRef.value) {
    dispose(chartRef.value);
    chartRef.value = null;
  }
});

/**
 * 监听容器尺寸变化 → 调 chart.resize() 同步画布。
 * 拖动右侧 dock-panel 调整宽度 / 窗口缩放 / 父级布局变化都会触发。
 * 用 nextTick 避开父级布局尚未稳定时 calcBounding 拿到的中间值
 */
useResizeObserver(containerRef, () => {
  const chart = chartRef.value;
  if (!chart) return;
  nextTick(() => {
    chart.resize();
    fitTimelineBarSpace();
  });
});

/**
 * 重算分时/五日 barSpace 并强制重绘（拖拽结束等场景的确定性兜底，
 * 不依赖 ResizeObserver 的触发时机）
 */
const refitChart = (): void => {
  const chart = chartRef.value;
  if (!chart) return;
  nextTick(() => {
    chart.resize();
    fitTimelineBarSpace();
  });
};

// 拖拽结束信号：强制重绘适配最终布局
watch(
  () => props.resizeTick,
  () => {
    refitChart();
  },
);

// 指标配置变化（蜡烛模式）：清空重建全部指标（与模式切换同路径；
// BOLL 可同时挂主图与副图，整build重建避免按 name 过滤误删同名指标）
watch(
  () => [props.mainIndicators, props.subIndicators] as const,
  () => {
    const chart = chartRef.value;
    if (!chart || props.mode === 'timeline') return;
    chart.removeIndicator({});
    setupIndicators(chart);
    applyAxisOptions(chart);
  },
);

// 均价线显隐变化（timeline 模式下切换指数/个股）：清空重建指标
watch(showAvgLine, () => {
  const chart = chartRef.value;
  if (!chart || props.mode !== 'timeline') return;
  chart.removeIndicator({});
  setupIndicators(chart);
  applyAxisOptions(chart);
});

// 展示数据 / 模式 / 固定时间轴开关变化时整体重新加载（周期 / 标的切换由父组件重新拉取）；
// 模式或轴口径变化时指标集不同（分时 vs 五日 / 蜡烛），先清空重建；
// preClose 异步就绪会触发 displayBars 重算，无需单独 watch
let prevSetupKey = `${props.mode}-${props.intradayAxis}`;
watch(
  () => [displayBars.value, props.mode, props.intradayAxis] as const,
  ([, mode, intradayAxis]) => {
    const chart = chartRef.value;
    if (!chart) return;
    const setupKey = `${mode}-${intradayAxis}`;
    if (setupKey !== prevSetupKey) {
      prevSetupKey = setupKey;
      chart.removeIndicator({});
      setupIndicators(chart);
      applyAxisOptions(chart);
      chart.setStyles(buildStyles());
      chart.setFormatter({ formatDate: (timestamp) => formatDateByMode(timestamp) });
    }
    applyData();
  },
);

// 成交标注变化（切股重拉 / 账户筛选后）：只重建标注覆盖物，不动数据
watch(
  () => props.tradeMarks,
  () => {
    rebuildTradeOverlays();
  },
);

// 盘中实时柱（2026-11-02 王总指定，轮询分时接口构建）：经 subscribeBar 原地合并——
// 同时间戳覆盖最后一根 / 更大追加；timeline 模式先做涨跌幅轴转换（与 displayBars 同口径，
// 分时固定轴上占位分钟按相同时间戳被真值替换）。init 回调完成前推送会被丢弃，无需处理
watch(
  () => props.liveBar,
  (bar) => {
    if (!bar || !liveBarPush) return;
    if (props.mode !== 'timeline') {
      liveBarPush(bar);
      return;
    }
    const pre = props.preClose ?? props.bars[0]?.close ?? null;
    if (!pre) return;
    liveBarPush(transformTimelineBar(bar, pre));
  },
);

// 涨跌配色主题 / 明暗主题变化时重设样式（网格线颜色取自 CSS 变量，需重新解析）
watch([trendSet, isDark], () => {
  chartRef.value?.setStyles(buildStyles());
});

/**
 * 暴露图表实例（画线工具等 overlay 扩展消费）：
 * 实例生命周期与组件一致（不随主题 / 模式切换重建，只 setStyles / applyData），
 * 外部拿到的引用长期有效；组件卸载后 chart.value 为 null
 */
defineExpose({
  /** klinecharts 图表实例（挂载前 / 卸载后为 null） */
  chart: chartRef,
});
</script>

<template>
  <!-- KLineChart canvas 内部会铺满父级可见区域；高度由 containerStyle 决定（默认 420px） -->
  <div ref="containerRef" class="relative w-full" :style="containerStyle">
    <!--
      Y 轴刻度文字着色覆盖层（红涨绿跌，2026-11-02 王总需求）：
      原生刻度文字被样式置透明，由该画布按刻度值相对基准重绘着色文字；
      原理与几何来源见 axis-text-overlay.ts 顶部注释
    -->
    <canvas
      ref="axisTextCanvasRef"
      class="pointer-events-none absolute inset-0 z-10 h-full w-full"
    />
  </div>
</template>

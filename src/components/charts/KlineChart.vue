<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  dispose,
  init,
  registerYAxis,
  type AxisCreateTicksParams,
  type Chart,
  type DeepPartial,
  type KLineData,
  type Styles,
  type YAxisTemplate,
} from 'klinecharts';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants';
import { readTrendColors } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import '../charts/indicators/custom-indicators';

/**
 * K 线图（klinecharts 实现）：
 *
 * - timeline 模式（分时 / 五日）：主图分时面积线（淡雅蓝，固定色）+ 均价线；副图成交量 + MACD
 * - candle 模式（5分 / 日K / 周K / 月K）：主图蜡烛 + MA[5,10,30]，副图成交量 + MACD&KDJ（含买/卖标注）
 *
 * 轴规格：Y 轴显示在左侧（3 等分刻度），X 轴 5 等分；副图不显示 Y 轴刻度线；
 * 十字光标 / X 轴日期：分时/五日为 MM/DD HH:mm，其余为 YYYY/MM/DD
 */
const props = defineProps<{
  /** klinecharts K 线序列（时间升序；分钟级附 avgPrice 字段） */
  bars: KLineData[];
  /** 图表模式 */
  mode: 'timeline' | 'candle';
}>();

const settingsStore = useSettingsStore();

/** 图表容器 */
const containerRef = ref<HTMLDivElement>();
/** klinecharts 实例 */
const chartRef = ref<Chart | null>(null);
/** 触发 loader 重新加载的自增序号（setSymbol 仅在变化时触发 init 加载） */
let loadSeq = 0;

/** 主图蜡烛面板 id（klinecharts 内置约定） */
const CANDLE_PANE_ID = 'candle_pane';

/** 主图 MA 周期（蜡烛模式） */
const MA_PERIODS = [5, 10, 30];

/**
 * 涨跌幅百分比 y 轴模板（仅 timeline 模式挂载）
 *
 * 不能用内置 percentage 轴：其 convertToPixel 把入参当百分比值换算，
 * 而面积线 / 指标绘制传入的是原始价格，会被画到面板外（曲线不可见）。
 * 本模板只映射 display 空间（刻度文本 = 相对可视区首根收盘的涨跌幅%），
 * 像素换算（real 空间）保持价格原值，曲线 / 均价线 / 十字光标均正常
 */
const TIMELINE_PCT_YAXIS: YAxisTemplate = {
  name: 'timeline_pct',
  minSpan: () => 0.01,
  displayValueToText: (value) => `${value.toFixed(2)}%`,
  createRange: ({ chart, defaultRange }) => {
    const base = chart.getDataList()[chart.getVisibleRange().from]?.close;
    if (!base) return defaultRange;
    const toPercent = (price: number): number => ((price - base) / base) * 100;
    const displayFrom = toPercent(defaultRange.from);
    const displayTo = toPercent(defaultRange.to);
    return {
      ...defaultRange,
      displayFrom,
      displayTo,
      displayRange: displayTo - displayFrom,
    };
  },
};

registerYAxis(TIMELINE_PCT_YAXIS);

/** 当前涨跌色阶（依赖 trendTheme，切换时本 computed 消费方自动重算） */
const trendSet = computed(() => {
  void settingsStore.trendTheme;
  return readTrendColors();
});

/**
 * 构建图表样式（蜡烛涨跌色 / 轴线 / 网格线均取当前主题色）
 * @returns klinecharts 样式覆盖对象
 */
const buildStyles = (): DeepPartial<Styles> => {
  const trend = trendSet.value;
  const isTimeline = props.mode === 'timeline';
  return {
    grid: { horizontal: { color: CHART_SPLIT_LINE_COLOR }, vertical: { show: false } },
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
    },
    xAxis: {
      axisLine: { color: CHART_AXIS_LINE_COLOR },
      tickText: { color: CHART_TEXT_COLOR },
      tickLine: { color: CHART_AXIS_LINE_COLOR },
    },
    yAxis: {
      axisLine: { color: CHART_AXIS_LINE_COLOR },
      tickText: { color: CHART_TEXT_COLOR },
      tickLine: { color: CHART_AXIS_LINE_COLOR },
    },
    separator: { color: CHART_SPLIT_LINE_COLOR },
  };
};

/**
 * 3 等分 Y 轴：根据可见范围线性插值出 3 个等距刻度。
 * 库内 defaultTicks 已按正常 niceInterval 算好 text，本回调保留其渲染行为，
 * 仅覆盖 value 字段（决定屏幕坐标的源数据点）
 * @param params 轴创建参数
 * @returns 等距刻度序列
 */
const buildYAxisTicks = (params: AxisCreateTicksParams) => {
  const from = params.range.displayFrom;
  const to = params.range.displayTo;
  if (Number.isNaN(from) || Number.isNaN(to) || to === from) return params.defaultTicks;
  return [from, (from + to) / 2, to].map((value, index) => ({
    ...params.defaultTicks[index],
    value,
  }));
};

/**
 * 5 等分 X 轴：依据可见数据下标均匀分布 5 个刻度
 * @param params 轴创建参数
 * @returns 等距刻度序列
 */
const buildXAxisTicks = (params: AxisCreateTicksParams) => {
  const from = Math.floor(params.range.realFrom);
  const to = Math.ceil(params.range.realTo);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return params.defaultTicks;
  const step = (to - from) / 4;
  const out = [];
  for (let i = 0; i < 5; i += 1) {
    const index = Math.round(from + step * i);
    out.push({ ...params.defaultTicks[i], value: index });
  }
  return out;
};

/**
 * 按 mode 挂载主图 / 副图指标
 * @param chart 图表实例
 */
const setupIndicators = (chart: Chart): void => {
  if (props.mode === 'timeline') {
    // 分时均价线叠加主图；副图成交量 + MACD
    chart.createIndicator({ name: 'AVG_PRICE', paneId: CANDLE_PANE_ID }, true);
    chart.createIndicator('VOL');
    chart.createIndicator('MACD');
    return;
  }
  // 蜡烛模式：主图 MA[5,10,30]；副图成交量 + MACD&KDJ 复合指标
  chart.createIndicator({
    name: 'MA',
    paneId: CANDLE_PANE_ID,
    calcParams: MA_PERIODS,
  });
  chart.createIndicator('VOL');
  chart.createIndicator('MACD_KDJ');
};

/**
 * 应用轴规格：主图 Y 轴左 + 3 等分；副图隐藏 Y 轴刻度线；
 * X 轴 5 等分；分时/五日主图使用 percentage 涨跌幅轴；分时/五日锁定缩放
 */
const applyAxisOptions = (chart: Chart): void => {
  const isTimeline = props.mode === 'timeline';
  // 主图 Y 轴：左 + 3 等分；分时/五日切换到涨跌幅百分比轴（价格空间换算的自定义模板）
  chart.overrideYAxis({
    paneId: CANDLE_PANE_ID,
    position: 'left',
    name: isTimeline ? 'timeline_pct' : 'normal',
    createTicks: buildYAxisTicks,
  });
  // 副图（成交量 / MACD / MACD&KDJ）：保留轴标但隐藏刻度线
  chart.getIndicators().forEach((indicator) => {
    if (indicator.paneId === CANDLE_PANE_ID) return;
    chart.overrideYAxis({
      paneId: indicator.paneId,
      position: 'left',
      needWidget: true,
      createTicks: buildYAxisTicks,
    });
  });
  // X 轴 5 等分
  chart.overrideXAxis({ createTicks: buildXAxisTicks });
  // 分时 / 五日：禁用 X 轴缩放（klinecharts v10 主图默认 isStack=true 会整图缩放，副图通过 scrollZoomEnabled 关闭）
  chart.setZoomEnabled(!isTimeline);
  chart.overrideXAxis({ scrollZoomEnabled: !isTimeline });
};

/**
 * 注入数据：重设 loader 并以新 ticker 触发 init 加载（v10 数据只能经 loader 通道进入）
 */
const applyData = (): void => {
  const chart = chartRef.value;
  if (!chart) return;
  chart.setDataLoader({
    getBars: ({ callback }) => {
      callback(props.bars, { forward: false, backward: false });
    },
  });
  chart.setSymbol({
    ticker: `${props.mode}-${loadSeq++}`,
    pricePrecision: 2,
    volumePrecision: 0,
  });
  chart.setPeriod({ type: 'day', span: 1 });
};

/** 两位补零 */
const pad2 = (n: number): string => n.toString().padStart(2, '0');

/** 跨模式通用十字光标 / X 轴日期格式化 */
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

/** 当前模式的日期格式化器（由 setupChart 注入 chart.setFormatter） */
const formatDateByMode = (params: { timestamp: number }): string =>
  formatCrosshairDate(params.timestamp, props.mode);

onMounted(() => {
  if (!containerRef.value) return;
  const chart = init(containerRef.value, { locale: 'zh-CN' });
  if (!chart) return;
  chartRef.value = chart;

  chart.setStyles(buildStyles());
  setupIndicators(chart);
  applyAxisOptions(chart);
  chart.setFormatter({ formatDate: (timestamp) => formatDateByMode(timestamp) });
  applyData();
});

onBeforeUnmount(() => {
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
  nextTick(() => chart.resize());
});

// 数据或模式变化时整体重新加载（周期 / 标的切换由父组件重新拉取）；
// 模式变化时指标集不同，先清空重建
let prevMode = props.mode;
watch(
  () => [props.bars, props.mode] as const,
  ([, mode]) => {
    const chart = chartRef.value;
    if (!chart) return;
    if (mode !== prevMode) {
      prevMode = mode;
      chart.removeIndicator({});
      setupIndicators(chart);
      applyAxisOptions(chart);
      chart.setStyles(buildStyles());
      chart.setFormatter({ formatDate: (timestamp) => formatDateByMode(timestamp) });
    }
    applyData();
  },
);

// 涨跌配色主题切换时重建样式（蜡烛模式跟随，分时/五日面积线固定色不受影响）
watch(trendSet, () => {
  chartRef.value?.setStyles(buildStyles());
});
</script>

<template>
  <!-- 容器始终保留 ≥ 480px 高度；KLineChart canvas 内部会铺满父级可见区域 -->
  <div
    ref="containerRef"
    class="h-[480px] min-h-[480px] w-full"
  />
</template>

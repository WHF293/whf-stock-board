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
  type TooltipLegend,
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
  /** 昨收价（timeline 模式涨跌幅基准；缺失时回退可视区首根收盘） */
  preClose?: number | null;
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
/** 触发 loader 重新加载的自增序号（setSymbol 仅在变化时触发 init 加载） */
let loadSeq = 0;

/** 主图蜡烛面板 id（klinecharts 内置约定） */
const CANDLE_PANE_ID = 'candle_pane';

/** 主图 MA 周期（蜡烛模式） */
const MA_PERIODS = [5, 10, 30];

/**
 * 涨跌幅百分比 y 轴模板（仅 timeline 模式挂载）
 *
 * timeline 模式的数据在传入前已完成转换：close = (price - pre) / pre（昨收涨跌幅小数），
 * 轴上没有价格，只有涨跌幅小数值，因此默认恒等换算即可，仅需格式化刻度文本
 */
const TIMELINE_PCT_YAXIS: YAxisTemplate = {
  name: 'timeline_pct',
  minSpan: () => 0.0001,
  displayValueToText: (value) => `${(value * 100).toFixed(2)}%`,
};

registerYAxis(TIMELINE_PCT_YAXIS);

/**
 * timeline 模式的展示数据派生（分时 / 五日专用，蜡烛模式原样透传）：
 *
 * - price：原始价格（转换前的 close）
 * - pre：昨收基准（取 preClose，快照未就绪时回退首根收盘）
 * - close：涨跌幅小数 = (price - pre) / pre，保留 3 位小数
 * - avgPrice：均价同步转为涨跌幅小数（与 close 同轴，否则均价线画出范围）
 * - avgPriceRaw：原始均价（tooltip 展示「价格 + 涨跌幅」用）
 */
const displayBars = computed<KLineData[]>(() => {
  if (props.mode !== 'timeline') return props.bars;
  const pre = props.preClose ?? props.bars[0]?.close ?? null;
  if (!pre) return props.bars;
  const round3 = (value: number): number => Number(value.toFixed(3));
  return props.bars.map((bar) => {
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
  });
});

/**
 * 分时 tooltip 自定义：开/高/低/收显示「价格（相对昨收涨跌幅）」，
 * 如 `10.10（+4.23%）`；数据取自 displayBars（price/pre/close 已就位）
 * @param data 十字光标邻域数据
 * @param data.current
 * @returns tooltip 图例列表
 */
const timelineCandleTooltipLegends = (data: {
  current: KLineData | null;
}): TooltipLegend[] => {
  const bar = data.current as (KLineData & { price?: number; pre?: number }) | null;
  if (!bar) return [];
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

/**
 * 构建图表样式（蜡烛涨跌色 / 轴线 / 网格线均取当前主题色）
 * @returns klinecharts 样式覆盖对象
 */
const buildStyles = (): DeepPartial<Styles> => {
  const trend = trendSet.value;
  const isTimeline = props.mode === 'timeline';
  return {
    // 水平网格线不显示
    grid: { horizontal: { show: false }, vertical: { show: false } },
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
      tickText: { color: CHART_TEXT_COLOR },
      tickLine: { color: CHART_AXIS_LINE_COLOR },
    },
    separator: { color: CHART_SPLIT_LINE_COLOR },
  };
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
 * @param chart
 */
const applyAxisOptions = (chart: Chart): void => {
  const isTimeline = props.mode === 'timeline';
  // 主图 Y 轴：左 + 3 等分；分时/五日切换到涨跌幅百分比轴（价格空间换算的自定义模板）
  chart.overrideYAxis({
    paneId: CANDLE_PANE_ID,
    position: 'left',
    name: isTimeline ? 'timeline_pct' : 'normal',
  });
  // 副图（成交量 / MACD / MACD&KDJ）：保留轴标但隐藏刻度线
  chart.getIndicators().forEach((indicator) => {
    if (indicator.paneId === CANDLE_PANE_ID) return;
    chart.overrideYAxis({
      paneId: indicator.paneId,
      position: 'left',
      needWidget: true,
    });
  });
  // X 轴 5 等分
  chart.overrideXAxis({ createTicks: buildXAxisTicks });
  // 分时 / 五日：禁用缩放与滚动，固定全量展示（setScrollEnabled(false) 后
  // setDataLoader 内部 resetData 的滚动重置也不可再拖动视窗）
  chart.setZoomEnabled(!isTimeline);
  chart.setScrollEnabled(!isTimeline);
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
      callback(displayBars.value, { forward: false, backward: false });
      // 分时 / 五日：按容器宽度反推 bar 宽度，保证全部数据一屏显示
      if (props.mode === 'timeline' && displayBars.value.length > 0) {
        const width = containerRef.value?.clientWidth ?? 0;
        const barSpace = Math.max(1, Math.floor(width / displayBars.value.length));
        chart.setBarSpace(Math.min(barSpace, 20));
        chart.scrollToRealTime();
      }
    },
  });
  chart.setSymbol({
    ticker: `${props.mode}-${loadSeq++}`,
    pricePrecision: 2,
    volumePrecision: 0,
  });
  chart.setPeriod({ type: 'day', span: 1 });
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

onMounted(() => {
  if (!containerRef.value) return;
  const chart = init(containerRef.value, { locale: 'zh-CN' });
  if (!chart) return;
  chartRef.value = chart;

  chart.setStyles(buildStyles());
  setupIndicators(chart);
  applyAxisOptions(chart);
  chart.setFormatter({ formatDate: (timestamp) => formatDateByMode(timestamp) });
  // 十字光标联动：悬停 bar 对外发事件（行情头联动展示），离开发 null
  chart.subscribeAction('onCrosshairChange', (raw) => {
    const data = raw as { kLineData?: KLineData } | undefined;
    emit('crosshairBar', data?.kLineData ?? null);
  });
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

// 展示数据或模式变化时整体重新加载（周期 / 标的切换由父组件重新拉取）；
// 模式变化时指标集不同，先清空重建；
// preClose 异步就绪会触发 displayBars 重算，无需单独 watch
let prevMode = props.mode;
watch(
  () => [displayBars.value, props.mode] as const,
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

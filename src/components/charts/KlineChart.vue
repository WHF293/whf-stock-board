<script setup lang="ts">
import { computed } from 'vue';import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
  PRICE_AXIS_PAD_RATIO,
  PRICE_AXIS_SPLIT,
} from '../../constants/chart.constants';
import { readTrendColors } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import {
  KLINE_VISIBLE_BARS,
  MA_FAST_PERIOD,
  MA_SLOW_PERIOD,
} from '../../constants/kline.constants';
import { SIGNAL_META } from '../../constants/signal.constants';
import type { HistoryKline, KlineSignal, KlineWithIndicators } from '../../types/kline.types';
import BaseChart from './BaseChart.vue';

/**
 * K 线图：蜡烛 + MA[5,20] + 成交量 + MACD 三区联动，金叉/死叉信号以三角标记叠加，
 * dataZoom 支持缩放平移（默认展示最近 KLINE_VISIBLE_BARS 根）；
 * 涨跌色读 CSS 变量，随涨跌配色主题即时跟随
 */
const props = defineProps<{
  /** 附加 MA / MACD 指标的 K 线序列（时间升序） */
  klines: KlineWithIndicators<HistoryKline>[];
  /** 技术信号列表（与 K 线同周期 / 复权口径） */
  signals: KlineSignal[];
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = 480;

/** 当前涨跌色阶（依赖 trendTheme，切换时本 computed 消费方自动重算） */
const trendSet = computed(() => {
  void settingsStore.trendTheme;
  return readTrendColors();
});

/** 信号日期 -> K 线下标映射 */
const signalIndexByDate = computed(() => {
  const map = new Map(props.klines.map((bar, index) => [bar.date, index]));
  return (date: string): number | null => map.get(date) ?? null;
});

/** 金叉类信号散点（主图低价位下方，向上三角） */
const goldenPoints = computed(() =>
  props.signals
    .map((signal) => {
      const index = signalIndexByDate.value(signal.date);
      if (index === null || SIGNAL_META[signal.type].direction !== 'up') return null;
      const bar = props.klines[index];
      return [index, (bar.low ?? bar.close ?? 0) * 0.995] as [number, number];
    })
    .filter((point): point is [number, number] => point !== null),
);

/** 死叉类信号散点（主图高价位上方，向下三角） */
const deathPoints = computed(() =>
  props.signals
    .map((signal) => {
      const index = signalIndexByDate.value(signal.date);
      if (index === null || SIGNAL_META[signal.type].direction !== 'down') return null;
      const bar = props.klines[index];
      return [index, (bar.high ?? bar.close ?? 0) * 1.005] as [number, number];
    })
    .filter((point): point is [number, number] => point !== null),
);

/** 成交量柱颜色与 K 线阴阳一致（收 >= 开 红涨色，否则绿跌色） */
const volumeData = computed(() =>
  props.klines.map((bar) => ({
    value: bar.volume ?? 0,
    itemStyle: {
      color: (bar.close ?? 0) >= (bar.open ?? 0) ? trendSet.value.upPale : trendSet.value.downPale,
    },
  })),
);

/** MACD 柱（DIF-DEA，正涨色负跌色） */
const macdBarData = computed(() =>
  props.klines.map((bar) => ({
    value: bar.macd?.macd ?? null,
    itemStyle: { color: (bar.macd?.macd ?? 0) >= 0 ? trendSet.value.up : trendSet.value.down },
  })),
);

/** 初始缩放窗口起点（百分比），保证默认展示最近 KLINE_VISIBLE_BARS 根 */
const zoomStart = computed(() =>
  props.klines.length > KLINE_VISIBLE_BARS
    ? Math.round(((props.klines.length - KLINE_VISIBLE_BARS) / props.klines.length) * 100)
    : 0,
);

const option = computed<EChartsCoreOption>(() => {
  const categories = props.klines.map((bar) => bar.date);
  const maFastKey = `ma${MA_FAST_PERIOD}` as const;
  const maSlowKey = `ma${MA_SLOW_PERIOD}` as const;

  // 主图价格轴精确三等分：以 K 线高低 + MA 取值范围向外扩 5% 后均分三段
  const priceValues = props.klines.flatMap((bar) =>
    [bar.low, bar.high, bar.ma?.[maFastKey], bar.ma?.[maSlowKey]].filter(
      (value): value is number => value !== null && value !== undefined,
    ),
  );
  const priceMin = priceValues.length > 0 ? Math.min(...priceValues) : 0;
  const priceMax = priceValues.length > 0 ? Math.max(...priceValues) : 1;
  const pricePad = (priceMax - priceMin) * PRICE_AXIS_PAD_RATIO;
  const priceAxisMin = priceMin - pricePad;
  const priceAxisMax = priceMax + pricePad;
  const priceAxisInterval = (priceAxisMax - priceAxisMin) / PRICE_AXIS_SPLIT;
  return {
    animation: false,
    tooltip: { trigger: 'axis', axisPointer: { type: 'cross' } },
    axisPointer: { link: [{ xAxisIndex: 'all' }] },
    grid: [
      { left: 8, right: 56, top: 12, height: '48%', containLabel: true },
      { left: 8, right: 56, top: '64%', height: '12%', containLabel: true },
      { left: 8, right: 56, top: '80%', height: '12%', containLabel: true },
    ],
    xAxis: [0, 1, 2].map((i) => ({
      type: 'category',
      gridIndex: i,
      data: categories,
      axisLabel: { color: CHART_TEXT_COLOR, show: i === 2 },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    })),
    yAxis: [0, 1, 2].map((i) => ({
      type: 'value',
      gridIndex: i,
      scale: true,
      // 主图价格轴精确三等分；成交 / MACD 区不显示刻度与横线
      ...(i === 0
        ? { min: priceAxisMin, max: priceAxisMax, interval: priceAxisInterval }
        : { axisLabel: { show: false }, splitLine: { show: false } }),
      ...(i === 0
        ? {
            axisLabel: {
              color: CHART_TEXT_COLOR,
              // 三等分区间除法可能产生小数尾巴，统一两位小数
              formatter: (value: number) => value.toFixed(2),
            },
            splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
          }
        : {}),
    })),
    dataZoom: [
      { type: 'inside', xAxisIndex: [0, 1, 2], start: zoomStart.value, end: 100 },
      { type: 'slider', xAxisIndex: [0, 1, 2], start: zoomStart.value, end: 100, bottom: 0 },
    ],
    series: [
      {
        name: 'K线',
        type: 'candlestick',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: props.klines.map((bar) => [bar.open, bar.close, bar.low, bar.high]),
        itemStyle: {
          color: trendSet.value.up,
          color0: trendSet.value.down,
          borderColor: trendSet.value.up,
          borderColor0: trendSet.value.down,
        },
      },
      {
        name: `MA${MA_FAST_PERIOD}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: props.klines.map((bar) => bar.ma?.[maFastKey] ?? null),
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1 },
        itemStyle: { color: '#f59e0b' },
      },
      {
        name: `MA${MA_SLOW_PERIOD}`,
        type: 'line',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: props.klines.map((bar) => bar.ma?.[maSlowKey] ?? null),
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1 },
        itemStyle: { color: '#6366f1' },
      },
      {
        name: '金叉',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: goldenPoints.value,
        symbol: 'triangle',
        symbolSize: 10,
        symbolOffset: [0, '60%'],
        itemStyle: { color: trendSet.value.up },
        z: 10,
      },
      {
        name: '死叉',
        type: 'scatter',
        xAxisIndex: 0,
        yAxisIndex: 0,
        data: deathPoints.value,
        symbol: 'triangle',
        symbolSize: 10,
        symbolRotate: 180,
        symbolOffset: [0, '-60%'],
        itemStyle: { color: trendSet.value.down },
        z: 10,
      },
      {
        name: '成交量',
        type: 'bar',
        xAxisIndex: 1,
        yAxisIndex: 1,
        data: volumeData.value,
      },
      {
        name: 'MACD',
        type: 'bar',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: macdBarData.value,
      },
      {
        name: 'DIF',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: props.klines.map((bar) => bar.macd?.dif ?? null),
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1 },
        itemStyle: { color: '#f59e0b' },
      },
      {
        name: 'DEA',
        type: 'line',
        xAxisIndex: 2,
        yAxisIndex: 2,
        data: props.klines.map((bar) => bar.macd?.dea ?? null),
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1 },
        itemStyle: { color: '#6366f1' },
      },
    ],
  };
});
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>

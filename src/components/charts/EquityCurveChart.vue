<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants';
import { readTrendColors } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import BaseChart from './BaseChart.vue';

/**
 * 回测权益曲线：策略权益 vs 买入持有基准，双线对比；策略线颜色随涨跌配色主题
 */
const props = defineProps<{
  /** 日期序列 */
  dates: string[];
  /** 策略权益曲线（元） */
  equityCurve: number[];
  /** 买入持有基准曲线（元） */
  buyHoldCurve: number[];
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = 260;

/** 当前涨跌色阶（依赖 trendTheme） */
const trendSet = computed(() => {
  void settingsStore.trendTheme;
  return readTrendColors();
});

/** 策略最终收益（%），决定策略线颜色 */
const strategyReturn = computed(() => {
  const curve = props.equityCurve;
  if (curve.length < 2 || curve[0] === 0) return 0;
  return ((curve.at(-1)! - curve[0]) / curve[0]) * 100;
});

const option = computed<EChartsCoreOption>(() => ({
  tooltip: { trigger: 'axis' },
  legend: { data: ['策略权益', '买入持有基准'], textStyle: { color: CHART_TEXT_COLOR }, top: 0 },
  grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
  xAxis: {
    type: 'category',
    data: props.dates,
    axisLabel: { color: CHART_TEXT_COLOR },
    axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value',
    scale: true,
    axisLabel: { color: CHART_TEXT_COLOR },
    splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
  },
  series: [
    {
      name: '策略权益',
      type: 'line',
      data: props.equityCurve,
      showSymbol: false,
      lineStyle: { width: 1.5 },
      itemStyle: { color: strategyReturn.value >= 0 ? trendSet.value.up : trendSet.value.down },
    },
    {
      name: '买入持有基准',
      type: 'line',
      data: props.buyHoldCurve,
      showSymbol: false,
      lineStyle: { width: 1, type: 'dashed' },
      itemStyle: { color: '#8a94a6' },
    },
  ],
}));
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>

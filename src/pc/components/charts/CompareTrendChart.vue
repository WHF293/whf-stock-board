<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import { COMPARE_SERIES_COLORS } from '../../../common/constants/compare.constants.ts';
import BaseChart from './BaseChart.vue';

/**
 * 自选多票归一化叠加对比曲线：每票一条线（基准 100），颜色按勾选顺序取色板
 *
 * tooltip 走 axis 触发；图例点击显隐由 ECharts 内建；数据整体更换用 notMerge
 * （票组合变化时系列数会增减，增量合并会残留旧系列）
 */
const props = defineProps<{
  /** 横轴日期序列（YYYY-MM-DD 升序） */
  dates: string[];
  /** 各票归一化序列（key = 完整符号；无值位置 null 断线） */
  values: Record<string, (number | null)[]>;
  /** 各票展示名（key = 完整符号） */
  names: Record<string, string>;
}>();

const option = computed<EChartsCoreOption>(() => {
  const symbols = Object.keys(props.values);
  return {
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value: unknown) =>
        typeof value === 'number' ? value.toFixed(2) : '—',
    },
    legend: {
      data: symbols.map((symbol) => props.names[symbol] ?? symbol),
      textStyle: { color: CHART_TEXT_COLOR },
      top: 0,
      type: 'scroll',
    },
    grid: { left: 8, right: 16, top: 32, bottom: 8, containLabel: true },
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
      axisLabel: { color: CHART_TEXT_COLOR, formatter: '{value}' },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: symbols.map((symbol, index) => ({
      name: props.names[symbol] ?? symbol,
      type: 'line',
      data: props.values[symbol],
      showSymbol: false,
      connectNulls: false,
      lineStyle: { width: 1.5 },
      itemStyle: { color: COMPARE_SERIES_COLORS[index % COMPARE_SERIES_COLORS.length] },
    })),
  };
});
</script>

<template>
  <BaseChart :options="option" not-merge class="h-full min-h-0 w-full" />
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import { readTrendColors } from '../../../common/utils/trend-colors';
import type { HuijinFlowDayPoint } from '../../../common/types/huijin-etf-flow.types.ts';
import BaseChart from './BaseChart.vue';

/**
 * 每日汇金持仓变化（估算）柱状图：日估算资金变动（亿元），零线基准；
 * 正负柱色走涨跌语义变量（readTrendColors 实时读取，随 data-trend 主题切换跟随）
 */
const { days, height = 200 } = defineProps<{
  /** 日序列（日期升序，近 N 日窗口已由调用方截取） */
  days: HuijinFlowDayPoint[];
  /** 图表高度（像素） */
  height?: number;
}>();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = height;

/** 零线基准（流入 / 流出分界） */
const ZERO_BASELINE = 0;

const option = computed<EChartsCoreOption>(() => {
  const colors = readTrendColors();
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const item = (params as { axisValue: string; value: number }[])[0];
        if (!item) {
          return '';
        }
        const signed = item.value > 0 ? `+${item.value}` : `${item.value}`;
        return `${item.axisValue}<br/>估算汇金资金变动：${signed} 亿元`;
      },
    },
    grid: { left: 8, right: 16, top: 16, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: days.map((day) => day.date.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT_COLOR, formatter: (value: number) => `${value}亿` },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        name: '估算汇金资金变动',
        type: 'bar',
        data: days.map((day) => ({
          value: day.estAmountYi,
          itemStyle: { color: day.estAmountYi >= 0 ? colors.up : colors.down },
        })),
        barMaxWidth: 18,
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: CHART_AXIS_LINE_COLOR, type: 'solid', width: 1 },
          data: [{ yAxis: ZERO_BASELINE }],
        },
      },
    ],
  };
});
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>

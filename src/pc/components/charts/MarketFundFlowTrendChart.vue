<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_BLUE,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import { YUAN_PER_YI } from '../../../common/constants/format.constants.ts';
import { formatYuanWithSign } from '../../../common/utils/format-yuan';
import type { MarketFundFlow } from '../../../common/types/flow.types.ts';
import BaseChart from './BaseChart.vue';

/**
 * 大盘资金流趋势折线图：主力净流入（亿）近 N 日走势，零线基准；
 * 曲线固定蓝色（不随主题与主题色变化，2026-10-13 王总指定）
 */
const { days, height = 260 } = defineProps<{
  /** 大盘资金流序列（日期升序，近 N 日） */
  days: MarketFundFlow[];
  /** 图表高度（像素）；调用方传值可与同卡片表格高度对齐避免布局跳动 */
  height?: number;
}>();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = height;

/** 零线基准（主力净流入正负分界） */
const ZERO_BASELINE = 0;

const option = computed<EChartsCoreOption>(() => {
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; value: number }[];
        const item = list[0];
        if (!item) {
          return '';
        }
        return `${item.axisValue}<br/>主力净流入：${formatYuanWithSign(item.value)}`;
      },
    },
    grid: { left: 8, right: 16, top: 20, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: days.map((day) => day.date.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        // 上游单位为元，换算为亿展示
        formatter: (value: number) => `${(value / YUAN_PER_YI).toFixed(0)}亿`,
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        name: '主力净流入',
        type: 'line',
        data: days.map((day) => day.mainNetInflow),
        smooth: true,
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { width: 2, color: CHART_LINE_BLUE },
        itemStyle: { color: CHART_LINE_BLUE },
        areaStyle: { opacity: 0.08, color: CHART_LINE_BLUE },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { type: 'dashed', color: CHART_TEXT_COLOR, opacity: 0.6 },
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

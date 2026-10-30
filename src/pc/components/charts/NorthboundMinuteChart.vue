<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_BLUE,
  CHART_LINE_GREEN,
  CHART_LINE_TEAL,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import { formatNorthboundAmount } from '../../../common/utils/format-northbound-amount.ts';
import type { NorthboundMinuteItem } from '../../../common/types/northbound.types.ts';
import BaseChart from './BaseChart.vue';

/**
 * 沪深港通分时净流入图（资金流向页行 3 右）
 *
 * 合计净流入为面积主线（青绿 = 主题色系），沪/深两通道为细线；
 * x 轴按上游返回时间序列（北向 9:30-15:00 共 241 点 / 南向 9:00-16:10 共 371 点），
 * 不做 A 股固定 238 格轴；上游单位为万元，tooltip 换算展示
 */

const { rows, height = 160 } = defineProps<{
  /** 分时序列（上游原始行，time 升序） */
  rows: NorthboundMinuteItem[];
  /** 图表高度（像素） */
  height?: number;
}>();

/** 三系列配色：合计主线 / 沪细线 / 深细线 */
const SERIES_COLORS = [CHART_LINE_TEAL, CHART_LINE_BLUE, CHART_LINE_GREEN] as const;

const option = computed<EChartsCoreOption>(() => ({
  animation: false,
  legend: {
    show: true,
    top: 0,
    right: 0,
    itemWidth: 12,
    itemHeight: 2,
    textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 },
  },
  tooltip: {
    trigger: 'axis',
    formatter: (params: unknown) => {
      const list = params as { axisValue: string; value: number | null; marker: string; seriesName: string }[];
      const time = list[0]?.axisValue ?? '';
      const lines = list
        .filter((item) => item.value !== null)
        .map(
          (item) =>
            `${item.marker}${item.seriesName}：${formatNorthboundAmount({ value: item.value, source: 'wan' })}`,
        );
      return [time, ...lines].join('<br/>');
    },
  },
  grid: { left: 8, right: 16, top: 22, bottom: 0, containLabel: true },
  xAxis: {
    type: 'category',
    data: rows.map((row) => row.time),
    axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
    axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
    axisTick: { show: false },
    boundaryGap: false,
  },
  yAxis: {
    type: 'value',
    scale: true,
    axisLabel: {
      color: CHART_TEXT_COLOR,
      fontSize: 10,
      // 上游单位万元，轴标签换算为亿元展示
      formatter: (value: number) =>
        formatNorthboundAmount({ value, source: 'wan' }).replace(' ', ''),
    },
    splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
  },
  series: [
    {
      name: '合计',
      type: 'line',
      data: rows.map((row) => row.totalNetInflow),
      showSymbol: false,
      lineStyle: { width: 2, color: SERIES_COLORS[0] },
      itemStyle: { color: SERIES_COLORS[0] },
      areaStyle: { opacity: 0.1, color: SERIES_COLORS[0] },
      connectNulls: false,
    },
    {
      name: '沪',
      type: 'line',
      data: rows.map((row) => row.shanghaiNetInflow),
      showSymbol: false,
      lineStyle: { width: 1, opacity: 0.7, color: SERIES_COLORS[1] },
      itemStyle: { color: SERIES_COLORS[1] },
      connectNulls: false,
    },
    {
      name: '深',
      type: 'line',
      data: rows.map((row) => row.shenzhenNetInflow),
      showSymbol: false,
      lineStyle: { width: 1, opacity: 0.7, color: SERIES_COLORS[2] },
      itemStyle: { color: SERIES_COLORS[2] },
      connectNulls: false,
    },
  ],
}));
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${height}px` }" />
</template>

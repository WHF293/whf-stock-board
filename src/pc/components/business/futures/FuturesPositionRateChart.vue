<script setup lang="ts">
import { computed } from 'vue';
import BaseChart from '../../charts/BaseChart.vue';
import { DOWN_COLOR, UP_COLOR } from '../../../../common/constants/stock-colors.constants.ts';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import type { FuturesPositionRateItem } from '../../../../common/types/futures.types.ts';
import type { EChartsCoreOption } from 'echarts/core';

/**
 * 期货总览 · 主力持仓多空比横向堆叠条形图
 *
 * 一条一品种（主力合约）：多单占比（红）+ 空单占比（绿）= 100%；数据来自
 * 前 20 会员持仓统计（同上游口径）。预览（卡片）与全量（弹窗）共用本组件。
 */
const props = defineProps<{
  /** 多空比条目（组件内部按多占比降序） */
  items: readonly FuturesPositionRateItem[];
  /** 图表高度（px，内联 style 注入 BaseChart，勿用 class——会与根节点 h-full 打架） */
  heightPx: number;
}>();

/** 排序后的条目（多占比降序：偏多品种在最上） */
const sorted = computed(() => [...props.items].sort((a, b) => b.longRate - a.longRate));

/** ECharts 配置 */
const option = computed<EChartsCoreOption | null>(() => {
  if (sorted.value.length === 0) {
    return null;
  }
  return {
    grid: { left: 8, right: 40, top: 4, bottom: 4, containLabel: true },
    legend: { top: 0, textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 } },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: unknown) => `${Number(value).toFixed(2)}%`,
    },
    xAxis: {
      type: 'value',
      max: 100,
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: '{value}%' },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    yAxis: {
      type: 'category',
      data: sorted.value.map((item) => item.name),
      axisTick: { show: false },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, width: 64, overflow: 'truncate' },
    },
    series: [
      {
        name: '多单占比',
        type: 'bar',
        stack: 'rate',
        data: sorted.value.map((item) => item.longRate),
        barMaxWidth: 10,
        itemStyle: { color: UP_COLOR },
        label: { show: true, position: 'inside', formatter: (p: { data: number }) => `${p.data.toFixed(1)}`, color: '#fff', fontSize: 9 },
      },
      {
        name: '空单占比',
        type: 'bar',
        stack: 'rate',
        data: sorted.value.map((item) => Number((100 - item.longRate).toFixed(2))),
        barMaxWidth: 10,
        itemStyle: { color: DOWN_COLOR },
      },
    ],
  };
});
</script>

<template>
  <div v-if="option" class="w-full" :style="{ height: `${heightPx}px` }">
    <BaseChart :options="option" :style="{ height: `${heightPx}px` }" />
  </div>
  <div v-else class="grid h-full place-items-center text-xs text-text-tertiary">暂无数据</div>
</template>

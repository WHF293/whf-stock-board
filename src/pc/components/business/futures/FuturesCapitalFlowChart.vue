<script setup lang="ts">
import { computed } from 'vue';
import BaseChart from '../../charts/BaseChart.vue';
import { DOWN_COLOR, UP_COLOR } from '../../../../common/constants/stock-colors.constants.ts';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import type { FuturesCapitalFlowItem } from '../../../../common/types/futures.types.ts';
import type { EChartsCoreOption } from 'echarts/core';

/**
 * 期货总览 · 品种资金流向横向条形图
 *
 * 一条一品种：净流入红 / 净流出绿（跟随全站涨跌主题）；预览（卡片）与
 * 全量（弹窗）共用本组件，仅高度与数据条数不同。上游 capital 单位为元，
 * 轴与 tooltip 统一换算成「亿」。
 */
const props = defineProps<{
  /** 品种资金流向条目（组件内部排序，负值在下正值在上） */
  items: readonly FuturesCapitalFlowItem[];
  /** 图表高度（px，内联 style 注入 BaseChart，勿用 class——会与根节点 h-full 打架） */
  heightPx: number;
}>();

/**
 * 资金净流向（亿）文案
 * @param value 金额（元）
 * @returns 亿为单位文案
 */
const toYi = (value: number): string => `${(value / 1e8).toFixed(2)}亿`;

/** 排序后的条目（升序：流出最大在最下，流入最大在最上，同上游排序） */
const sorted = computed(() =>
  [...props.items].filter((item) => item.capital !== 0).sort((a, b) => a.capital - b.capital),
);

/** ECharts 配置 */
const option = computed<EChartsCoreOption | null>(() => {
  if (sorted.value.length === 0) {
    return null;
  }
  return {
    grid: { left: 8, right: 48, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: unknown) => toYi(Number(value)),
    },
    xAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (v: number) => `${(v / 1e8).toFixed(0)}亿` },
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
        type: 'bar',
        data: sorted.value.map((item) => ({
          value: item.capital,
          itemStyle: { color: item.capital > 0 ? UP_COLOR : DOWN_COLOR, borderRadius: item.capital > 0 ? [0, 3, 3, 0] : [3, 0, 0, 3] },
        })),
        barMaxWidth: 10,
        barMinHeight: 2,
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

<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
  CHART_GOLD,
  CHART_SILVER,
} from '../../../common/constants/chart.constants.ts';
import BaseChart from './BaseChart.vue';

/**
 * 当日金价 · 品牌横向分组柱状图（「全部」视图）
 *
 * 一行一个品牌，足金饰品（金柱）/ 投资金条（银灰柱）两系列对比；
 * 国内基准金价（中国黄金基础金价）以 markLine 横贯，品牌溢价一眼可见；
 * 无金条行情的品牌该柱缺行（tooltip 显示 `--` 口径由上游数据为空自然缺失）
 */
const props = defineProps<{
  /** 品牌报价列表（顺序 = GOLD_BRAND_CODES 声明序，自上而下渲染） */
  brands: { label: string; ornamentPrice: number | null; barPrice: number | null }[];
  /** 国内基准金价（元/克；null 时不画基准线） */
  basisPrice: number | null;
}>();

/** 横向柱状图的类目轴自下而上排布，反转一次让首个品牌显示在最上 */
const yLabels = computed(() => props.brands.map((brand) => brand.label).reverse());

/**
 * tooltip 行文案（缺行 `--`，有值带单位）
 * @param seriesName 系列名
 * @param value 数值原值
 * @returns 展示文案
 */
const formatTooltipRow = (seriesName: string, value: unknown): string =>
  typeof value === 'number' ? `${seriesName}：${value.toFixed(2)} 元/克` : `${seriesName}：--`;

const option = computed<EChartsCoreOption>(() => ({
  legend: { top: 0, textStyle: { color: CHART_TEXT_COLOR }, itemWidth: 14, itemHeight: 9 },
  tooltip: {
    trigger: 'axis',
    axisPointer: { type: 'shadow' },
    formatter: (params: unknown): string => {
      const rows = Array.isArray(params) ? params : [params];
      const lines = rows.map((item) => {
        const p = item as { seriesName?: string; value?: unknown };
        return formatTooltipRow(p.seriesName ?? '', p.value);
      });
      return lines.join('<br/>');
    },
  },
  grid: { left: 8, right: 56, top: 28, bottom: 8, containLabel: true },
  xAxis: {
    type: 'value',
    scale: true,
    axisLabel: { color: CHART_TEXT_COLOR, formatter: (value: number) => `${value}` },
    splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
  },
  yAxis: {
    type: 'category',
    data: yLabels.value,
    axisLabel: { color: CHART_TEXT_COLOR },
    axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
    axisTick: { show: false },
  },
  series: [
    {
      name: '足金饰品',
      type: 'bar',
      data: props.brands.map((brand) => brand.ornamentPrice).reverse(),
      itemStyle: { color: CHART_GOLD, borderRadius: [0, 3, 3, 0] },
      barGap: '10%',
      ...(props.basisPrice !== null
        ? {
            markLine: {
              silent: true,
              symbol: 'none',
              lineStyle: { color: CHART_SILVER, type: 'dashed' },
              label: { color: CHART_TEXT_COLOR, formatter: `基准 ${props.basisPrice.toFixed(0)}` },
              data: [{ xAxis: props.basisPrice }],
            },
          }
        : {}),
    },
    {
      name: '投资金条',
      type: 'bar',
      data: props.brands.map((brand) => brand.barPrice).reverse(),
      itemStyle: { color: CHART_SILVER, borderRadius: [0, 3, 3, 0] },
    },
  ],
}));
</script>

<template>
  <!-- 高度由父容器决定（BaseChart 根元素 h-full），卡片内随剩余高度自适应 -->
  <BaseChart :options="option" />
</template>

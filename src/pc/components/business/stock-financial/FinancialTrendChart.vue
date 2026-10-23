<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseChart from '../../charts/BaseChart.vue';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import {
  FINANCIAL_TREND_SERIES_COLORS,
} from '../../../../common/constants/financial.constants.ts';
import { YUAN_PER_YI } from '../../../../common/constants/format.constants.ts';
import type { FinancialSummaryRow } from '../../../../common/types/financial.types.ts';

/**
 * 营收 / 归母净利多期趋势柱状图（详情页财务 Tab）
 *
 * 双系列柱状（最近 N 期，横轴报告期升序），数值单位亿元（2 位小数）；
 * 系列色用固定 teal + 蓝灰（不占涨跌语义色，避免被误读为涨跌），随暗色重建由 BaseChart 承担
 */
const props = defineProps<{
  /** 财务摘要行（报告期倒序，组件内部翻转为升序） */
  rows: FinancialSummaryRow[];
}>();

/** 报告期升序（最旧在左，趋势向右生长） */
const ascRows = computed(() => [...props.rows].reverse());

/**
 * 元 → 亿数值（柱顶与 tooltip 共用，2 位小数）
 * @param valueYuan 金额原值（单位：元）
 * @returns 亿元数值（2 位小数）；null 原样返回
 */
const toYi = (valueYuan: number | null): number | null =>
  valueYuan === null ? null : Number((valueYuan / YUAN_PER_YI).toFixed(2));

const option = computed<EChartsCoreOption>(() => ({
  tooltip: {
    trigger: 'axis',
    valueFormatter: (value: unknown) =>
      typeof value === 'number' ? `${value.toFixed(2)}亿` : '--',
  },
  legend: {
    data: ['营业总收入', '归母净利润'],
    textStyle: { color: CHART_TEXT_COLOR },
    top: 0,
  },
  grid: { left: 8, right: 16, top: 30, bottom: 4, containLabel: true },
  xAxis: {
    type: 'category',
    data: ascRows.value.map((row) => row.reportDate),
    axisLabel: { color: CHART_TEXT_COLOR },
    axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: CHART_TEXT_COLOR, formatter: '{value}' },
    splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
  },
  series: [
    {
      name: '营业总收入',
      type: 'bar',
      data: ascRows.value.map((row) => toYi(row.totalOperateIncome)),
      itemStyle: { color: FINANCIAL_TREND_SERIES_COLORS[0], borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 26,
    },
    {
      name: '归母净利润',
      type: 'bar',
      data: ascRows.value.map((row) => toYi(row.parentNetprofit)),
      itemStyle: { color: FINANCIAL_TREND_SERIES_COLORS[1], borderRadius: [3, 3, 0, 0] },
      barMaxWidth: 26,
    },
  ],
}));
</script>

<template>
  <BaseChart :options="option" not-merge class="h-52 w-full" />
</template>

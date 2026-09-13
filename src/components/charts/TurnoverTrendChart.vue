<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants';
import { CSS_VAR_PRIMARY } from '../../constants/theme-color.constants';
import { YUAN_PER_YI } from '../../constants/format.constants';
import { readCssVar } from '../../utils/read-css-var';
import { useSettingsStore } from '../../stores/settings';
import type { TurnoverDayItem } from '../../types/turnover.types';
import BaseChart from './BaseChart.vue';

/**
 * 沪深两市成交额趋势折线图：逐日 总 / 上证 / 深证 三条成交额（亿）曲线，近 N 个交易日走势；
 * 折线用主题色（运行时读 CSS 变量，切主题即时跟随），上证 / 深证用固定区分色
 */
const { days, height = 260 } = defineProps<{
  /** 成交额序列（日期升序，近 N 个交易日） */
  days: TurnoverDayItem[];
  /** 图表高度（像素）；调用方传值可与同卡片表格高度对齐避免布局跳动 */
  height?: number;
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = height;

/** 亿元换算保留位数（展示值） */
const YI_DECIMALS = 2;

/** 副系列固定配色（保证深色 / 浅色主题下均可读） */
const SH_COLOR = '#f97316'; // 上证：橙
const SZ_COLOR = '#22d3ee'; // 深证：青

/**
 * 元 -> 亿元并保留小数
 * @param value 成交额（元）
 * @returns 亿元字符串（含「亿」单位）
 */
const toYi = (value: number): string => `${(value / YUAN_PER_YI).toFixed(YI_DECIMALS)}亿`;

const option = computed<EChartsCoreOption>(() => {
  // 依赖 themeColor：切换主题色后本 computed 重新求值
  void settingsStore.themeColor;
  const primary = readCssVar(CSS_VAR_PRIMARY);
  return {
    animation: false,
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; seriesName: string; value: number; color: string }[];
        if (!list.length) {
          return '';
        }
        const lines = list
          .map((it) => `<span style="color:${it.color}">●</span> ${it.seriesName}：${toYi(it.value)}`)
          .join('<br/>');
        return `${list[0].axisValue}<br/>${lines}`;
      },
    },
    legend: {
      data: ['两市总成交额', '上证成交额', '深证成交额'],
      textStyle: { color: CHART_TEXT_COLOR },
      top: 0,
      right: 0,
      itemWidth: 14,
      itemHeight: 8,
    },
    grid: { left: 8, right: 16, top: 28, bottom: 0, containLabel: true },
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
        name: '两市总成交额',
        type: 'line',
        data: days.map((day) => day.totalAmount),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2, color: primary },
        itemStyle: { color: primary },
        areaStyle: { opacity: 0.08, color: primary },
      },
      {
        name: '上证成交额',
        type: 'line',
        data: days.map((day) => day.shanghaiAmount),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: SH_COLOR },
        itemStyle: { color: SH_COLOR },
      },
      {
        name: '深证成交额',
        type: 'line',
        data: days.map((day) => day.shenzhenAmount),
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 1.5, color: SZ_COLOR },
        itemStyle: { color: SZ_COLOR },
      },
    ],
  };
});
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>

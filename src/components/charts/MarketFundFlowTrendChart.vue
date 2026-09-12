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
import { formatYuanWithSign } from '../../utils/format-yuan';
import { readCssVar } from '../../utils/read-css-var';
import { useSettingsStore } from '../../stores/settings';
import type { MarketFundFlow } from '../../types/flow.types';
import BaseChart from './BaseChart.vue';

/**
 * 大盘资金流趋势折线图：主力净流入（亿）近 N 日走势，零线基准；
 * 折线用主题色（运行时读 CSS 变量，切主题即时跟随）
 */
const props = defineProps<{
  /** 大盘资金流序列（日期升序，近 N 日） */
  days: MarketFundFlow[];
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = 260;

/** 零线基准（主力净流入正负分界） */
const ZERO_BASELINE = 0;

const option = computed<EChartsCoreOption>(() => {
  // 依赖 themeColor：切换主题色后本 computed 重新求值
  void settingsStore.themeColor;
  const primary = readCssVar(CSS_VAR_PRIMARY);
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
      data: props.days.map((day) => day.date.slice(5)),
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
        data: props.days.map((day) => day.mainNetInflow),
        smooth: true,
        showSymbol: true,
        symbolSize: 6,
        lineStyle: { width: 2, color: primary },
        itemStyle: { color: primary },
        areaStyle: { opacity: 0.08, color: primary },
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

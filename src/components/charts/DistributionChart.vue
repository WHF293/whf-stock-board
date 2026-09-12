<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants';
import { readTrendColors, type TrendColorSet } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import type { DistributionCount } from '../../types/distribution.types';
import BaseChart from './BaseChart.vue';

/**
 * 涨跌分布柱状图：逐桶使用涨跌语义色阶（读 CSS 变量，随涨跌配色主题即时跟随）
 */
const props = defineProps<{
  /** 分桶计数结果 */
  data: DistributionCount[];
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = 220;

/** 当前涨跌色阶（依赖 trendTheme） */
const trendSet = computed(() => {
  void settingsStore.trendTheme;
  return readTrendColors();
});

/** 桶 key -> 色阶键映射（从深跌到深涨） */
const BUCKET_TONE_KEY: Record<string, keyof TrendColorSet> = {
  deep_down: 'downStrong',
  down_5_7: 'down',
  down_3_5: 'downLight',
  down_0_3: 'downPale',
  up_0_3: 'upPale',
  up_3_5: 'upLight',
  up_5_7: 'up',
  deep_up: 'upStrong',
};

const option = computed<EChartsCoreOption>(() => ({
  tooltip: { trigger: 'axis' },
  grid: { left: 8, right: 8, top: 24, bottom: 8, containLabel: true },
  xAxis: {
    type: 'category',
    data: props.data.map((bucket) => bucket.label),
    axisLabel: { color: CHART_TEXT_COLOR },
    axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
    axisTick: { show: false },
  },
  yAxis: {
    type: 'value',
    axisLabel: { color: CHART_TEXT_COLOR },
    splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
  },
  series: [
    {
      type: 'bar',
      barCategoryGap: '20%',
      data: props.data.map((bucket) => ({
        value: bucket.count,
        itemStyle: {
          color: trendSet.value[BUCKET_TONE_KEY[bucket.key] ?? 'flat'],
          borderRadius: [4, 4, 0, 0],
        },
      })),
    },
  ],
}));
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>

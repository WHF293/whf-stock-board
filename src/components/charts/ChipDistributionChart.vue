<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants';
import { readTrendColors } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import { formatPrice } from '../../utils/format-price';
import type { ChipDistributionItem } from '../../types/kline.types';
import BaseChart from './BaseChart.vue';

/**
 * 筹码分布图（横向柱）：价格档为 y 轴、筹码占比为 x 轴；
 * 低于现价的筹码（获利盘）涨色，高于现价（套牢盘）跌色，并标注现价基准线；
 * 涨跌色读 CSS 变量，随涨跌配色主题即时跟随
 */
const props = defineProps<{
  /** 最新一日筹码统计（须含筹码峰直方图） */
  item: ChipDistributionItem | null;
  /** 当前价（划分获利 / 套牢） */
  currentPrice: number | null;
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = 320;

/** 筹码峰采样步长：150 档全显过密，按步长抽稀展示 */
const HISTOGRAM_SAMPLE_STEP = 3;

/** 当前涨跌色阶（依赖 trendTheme） */
const trendSet = computed(() => {
  void settingsStore.trendTheme;
  return readTrendColors();
});

const option = computed<EChartsCoreOption>(() => {
  const histogram = props.item?.histogram;
  const prices = histogram?.prices ?? [];
  const ratios = histogram?.ratios ?? [];

  // 抽稀后（价格, 占比%）对，保持低 -> 高顺序（category 轴自下而上渲染）
  const sampled = prices
    .map((price, index) => ({ price, ratio: (ratios[index] ?? 0) * 100 }))
    .filter((_, index) => index % HISTOGRAM_SAMPLE_STEP === 0);

  // 现价基准线定位到最近的价格档
  let nearestIndex = 0;
  if (props.currentPrice !== null && props.currentPrice !== undefined) {
    let minGap = Number.POSITIVE_INFINITY;
    sampled.forEach((point, index) => {
      const gap = Math.abs(point.price - props.currentPrice!);
      if (gap < minGap) {
        minGap = gap;
        nearestIndex = index;
      }
    });
  }

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; value: number }[];
        return `${formatPrice(Number(list[0]?.axisValue))}　占比 ${Number(
          list[0]?.value ?? 0,
        ).toFixed(2)}%`;
      },
    },
    grid: { left: 4, right: 24, top: 12, bottom: 8, containLabel: false },
    xAxis: {
      type: 'value',
      axisLabel: { color: CHART_TEXT_COLOR, formatter: '{value}%' },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    // 价格档 y 轴不展示（横向柱纯形态，价格经 tooltip 呈现）
    yAxis: {
      type: 'category',
      data: sampled.map((point) => point.price),
      axisLabel: { show: false },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [
      {
        name: '筹码占比',
        type: 'bar',
        barCategoryGap: 0,
        data: sampled.map((point) => ({
          value: Number(point.ratio.toFixed(3)),
          itemStyle: {
            color:
              props.currentPrice !== null && point.price < props.currentPrice
                ? trendSet.value.up
                : trendSet.value.down,
          },
        })),
        markLine: {
          silent: true,
          symbol: 'none',
          label: {
            formatter: `现价 ${formatPrice(props.currentPrice)}`,
            color: CHART_TEXT_COLOR,
            position: 'insideEndTop',
          },
          lineStyle: { type: 'dashed', color: '#5c6b80' },
          data: [{ yAxis: nearestIndex }],
        },
      },
    ],
  };
});
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>

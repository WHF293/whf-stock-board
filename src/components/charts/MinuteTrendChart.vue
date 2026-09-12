<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../constants/chart.constants';
import { readTrendColors } from '../../utils/trend-colors';
import { useSettingsStore } from '../../stores/settings';
import { formatPercent } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { buildMinuteAxis } from '../../utils/build-minute-axis';
import type { TodayTimelineResponse } from '../../types/kline.types';
import BaseChart from './BaseChart.vue';

/**
 * 分时图：涨幅百分比口径（y 轴 = (价格 - 昨收) / 昨收 的百分比）
 * 价格线 + 均价线 + 零值（昨收）基准虚线，x 轴固定 09:30~15:00 全量刻度避免盘中拉伸；
 * y 轴范围取「开盘 / 现价相对昨收的最大偏离」的对称区间并三等分
 */
const props = defineProps<{
  /** 当日分时响应（含昨收与逐分钟价格 / 均价） */
  timeline: TodayTimelineResponse;
}>();

const settingsStore = useSettingsStore();

/** 图表容器高度（像素） */
const CHART_HEIGHT_PX = 280;

/** 分时固定时间轴（242 个分钟点） */
const minuteAxis = buildMinuteAxis();

/** 按时间对齐后的价格 / 均价序列（未发生或缺失的分钟为 null） */
const aligned = computed(() => {
  const priceByTime = new Map(props.timeline.data.map((item) => [item.time, item]));
  const price: (number | null)[] = [];
  const avg: (number | null)[] = [];
  for (const time of minuteAxis) {
    const item = priceByTime.get(time);
    price.push(item ? item.price : null);
    avg.push(item ? item.avgPrice : null);
  }
  return { price, avg };
});

/** 昨收（上游缺失时退化为首笔价格） */
const preClose = computed(() => props.timeline.preClose || props.timeline.data[0]?.price || 0);

/**
 * 价格 -> 涨幅百分比（相对昨收；昨收缺失时为 null）
 * @param value
 */
const toPercent = (value: number | null): number | null =>
  value === null || !preClose.value ? null : ((value - preClose.value) / preClose.value) * 100;

/** 涨幅百分比序列（价格线 / 均价线） */
const percentSeries = computed(() => ({
  price: aligned.value.price.map(toPercent),
  avg: aligned.value.avg.map(toPercent),
}));

/**
 * y 轴对称上限（百分比）：开盘价 / 最新价相对昨收的最大偏离
 */
const axisMaxPercent = computed(() => {
  const open = props.timeline.data[0]?.price ?? 0;
  const close = props.timeline.data.at(-1)?.price ?? 0;
  if (!preClose.value) {
    return 1;
  }
  return Math.max(
    0.01,
    Math.abs((open - preClose.value) / preClose.value) * 100,
    Math.abs((close - preClose.value) / preClose.value) * 100,
  );
});

/** 均价线颜色 */
const AVG_LINE_COLOR = '#f59e0b';

/** 当前涨跌色阶（依赖 trendTheme，切换时自动重算） */
const trendSet = computed(() => {
  void settingsStore.trendTheme;
  return readTrendColors();
});

/** 依据现价相对昨收的方向给价格线着色（随涨跌配色主题变化） */
const lineColor = computed(() => {
  const last = props.timeline.data.at(-1)?.price ?? preClose.value;
  if (last > preClose.value) return trendSet.value.up;
  if (last < preClose.value) return trendSet.value.down;
  return trendSet.value.flat;
});

const option = computed<EChartsCoreOption>(() => {
  const maxPercent = axisMaxPercent.value;
  // 涨幅反推价格（tooltip 展示用）
  const percentToPrice = (percent: number): number =>
    preClose.value * (1 + percent / 100);

  return {
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; value: number | null; seriesName: string }[];
        const priceItem = list.find((item) => item.seriesName === '价格');
        if (!priceItem || priceItem.value === null) return priceItem?.axisValue ?? '';
        const avgItem = list.find((item) => item.seriesName === '均价');
        return [
          `<b>${priceItem.axisValue}</b>`,
          `价格：${formatPrice(percentToPrice(priceItem.value))}（${formatPercent(priceItem.value)}）`,
          `均价：${formatPrice(percentToPrice(avgItem?.value ?? priceItem.value))}`,
        ].join('<br/>');
      },
    },
    grid: { left: 8, right: 56, top: 12, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: minuteAxis,
      boundaryGap: false,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        // 仅标注关键时刻，避免盘中标签拥挤
        interval: (index: number) => ['09:30', '10:30', '11:30', '14:00', '15:00'].includes(minuteAxis[index]),
      },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      // 涨幅口径：[-max, +max] 对称区间，精确三等分（3 条横线，0% 居中）
      min: -maxPercent,
      max: maxPercent,
      interval: (maxPercent * 2) / 3,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        formatter: (value: number) => `${value > 0 ? '+' : ''}${value.toFixed(2)}%`,
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        name: '价格',
        type: 'line',
        data: percentSeries.value.price,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1.5 },
        areaStyle: { opacity: 0.15 },
      },
      {
        name: '均价',
        type: 'line',
        data: percentSeries.value.avg,
        showSymbol: false,
        connectNulls: true,
        lineStyle: { width: 1, type: 'dashed' },
        itemStyle: { color: AVG_LINE_COLOR },
      },
      {
        name: '昨收基准',
        type: 'line',
        data: [],
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { type: 'dotted', color: trendSet.value.flat },
          data: [{ yAxis: 0 }],
        },
      },
    ],
  };
});

const optionWithColor = computed<EChartsCoreOption>(() => ({
  ...option.value,
  color: [lineColor.value, AVG_LINE_COLOR],
}));

</script>

<template>
  <BaseChart :options="optionWithColor" :style="{ height: `${CHART_HEIGHT_PX}px` }" />
</template>

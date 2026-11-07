<script setup lang="ts">
import { computed } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
  CHART_GOLD,
} from '../../../common/constants/chart.constants.ts';
import type { GoldHistoryPoint } from '../../../common/types/gold-price.types.ts';
import BaseChart from './BaseChart.vue';

/**
 * 当日金价 · 单品牌足金价近 N 日走势折线
 *
 * 数据来自金投历史接口（日更收盘挂牌价），X 轴为交易日（MM-DD），Y 轴元/克；
 * 单日涨跌额大于 0 的点在 tooltip 里红显、小于 0 绿显（跟随涨跌配色 CSS 变量）
 */
const props = defineProps<{
  /** 历史点序列（时间升序） */
  points: GoldHistoryPoint[];
}>();

/** 日期轴标签（MM-DD） */
const dateLabels = computed(() =>
  props.points.map((point) => {
    const date = new Date(point.time);
    const month = `${date.getMonth() + 1}`.padStart(2, '0');
    const day = `${date.getDate()}`.padStart(2, '0');
    return `${month}-${day}`;
  }),
);

const option = computed<EChartsCoreOption>(() => ({
  tooltip: {
    trigger: 'axis',
    formatter: (params: unknown): string => {
      const rows = Array.isArray(params) ? params : [params];
      return rows
        .map((item) => {
          const p = item as { dataIndex?: number; axisValue?: string };
          const point = props.points[p.dataIndex ?? -1];
          if (!point) return '';
          const changeText =
            point.change === 0 ? '持平' : `${point.change > 0 ? '+' : ''}${point.change.toFixed(2)} 元/克`;
          return `${p.axisValue ?? ''}　${point.price.toFixed(2)} 元/克（${changeText}）`;
        })
        .join('<br/>');
    },
  },
  grid: { left: 8, right: 16, top: 16, bottom: 4, containLabel: true },
  xAxis: {
    type: 'category',
    data: dateLabels.value,
    axisLabel: { color: CHART_TEXT_COLOR },
    axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
    axisTick: { show: false },
    boundaryGap: false,
  },
  yAxis: {
    type: 'value',
    scale: true,
    axisLabel: { color: CHART_TEXT_COLOR },
    splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
  },
  series: [
    {
      name: '足金饰品',
      type: 'line',
      data: props.points.map((point) => point.price),
      symbol: 'none',
      lineStyle: { color: CHART_GOLD, width: 2 },
      itemStyle: { color: CHART_GOLD },
      areaStyle: { color: CHART_GOLD, opacity: 0.08 },
    },
  ],
}));
</script>

<template>
  <!-- 高度由父容器决定（BaseChart 根元素 h-full），卡片内随剩余高度自适应 -->
  <BaseChart :options="option" />
</template>

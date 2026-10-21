<script setup lang="ts">
import { computed } from 'vue';
import { useDark } from '@vueuse/core';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_TEAL,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import {
  ARMS_NEUTRAL_LINE,
  ARMS_TIME_FORMAT,
  BREADTH_VIEW,
  BREADTH_VIEW_DAYS,
  type BreadthViewKey,
} from '../../../common/constants/market-breadth.constants.ts';
import type { BreadthDayBar, BreadthPoint } from '../../../common/types/market-breadth.types.ts';
import { useSettingsStore } from '../../../common/stores/settings';
import { readTrendColors } from '../../../common/utils/trend-colors';
import dayjs from 'dayjs';
import BaseChart from './BaseChart.vue';

/**
 * 市场宽度曲线图（ECharts）
 *
 * - 当日分时：ARMS 曲线（30s 采样、同分钟去重）+ y=1 平衡虚线 + 强/弱淡色带；
 * - 历史日线：ARMS 日线（主轴）+ 涨跌家数差柱（次轴，红涨绿跌）；
 * - 缺口断线（connectNulls: false）；曲线固定青绿（CHART_LINE_TEAL，不随主题色），
 *   家数差柱用运行时涨跌色（随涨跌配色主题 + 暗色重算，DistributionChart 同套路）
 */
const {
  view,
  points = [],
  bars = [],
  height = 236,
} = defineProps<{
  /** 视图 key：当日分时 / 近 30 日 / 近 60 日（后两者走日线形态） */
  view: BreadthViewKey;
  /** 当日分钟点序列（view 为当日分时消费） */
  points?: BreadthPoint[];
  /** 日 bar 序列（日期升序；view 为日线档位消费，窗口内切片） */
  bars?: BreadthDayBar[];
  /** 图表高度（像素） */
  height?: number;
}>();

const settingsStore = useSettingsStore();
const isDark = useDark();

/** 平衡线文案（tooltip / markLine） */
const NEUTRAL_LINE_LABEL = '平衡线 1.0';

/** 涨跌家数差系列名 */
const DIFF_SERIES_NAME = '上涨-下跌家数差';

const option = computed<EChartsCoreOption>(() => {
  void settingsStore.trendTheme;
  void isDark.value;
  const trend = readTrendColors();

  if (view === BREADTH_VIEW.INTRADAY) {
    const times = points.map((point) => dayjs(point.time).format(ARMS_TIME_FORMAT));
    return {
      grid: { left: 44, right: 14, top: 18, bottom: 24 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'line' },
        valueFormatter: (value: unknown) =>
          typeof value === 'number' ? value.toFixed(2) : '--',
      },
      xAxis: {
        type: 'category',
        data: times,
        boundaryGap: false,
        axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
        axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
        axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (v: number) => v.toFixed(1) },
      },
      series: [
        {
          name: 'ARMS',
          type: 'line',
          data: points.map((point) => point.arms),
          connectNulls: false,
          symbol: 'none',
          lineStyle: { color: CHART_LINE_TEAL, width: 1.8 },
          itemStyle: { color: CHART_LINE_TEAL },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: NEUTRAL_LINE_LABEL },
            lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
            data: [{ yAxis: ARMS_NEUTRAL_LINE }],
          },
          markArea: {
            silent: true,
            data: [
              [
                { yAxis: 'min', itemStyle: { color: trend.up, opacity: 0.05 } },
                { yAxis: ARMS_NEUTRAL_LINE },
              ],
              [
                { yAxis: ARMS_NEUTRAL_LINE, itemStyle: { color: trend.down, opacity: 0.05 } },
                { yAxis: 'max' },
              ],
            ],
          },
        },
      ],
    };
  }

  // 日线档位：ARMS 日线（主轴）+ 涨跌家数差柱（次轴）
  const windowDays = BREADTH_VIEW_DAYS[view as Exclude<BreadthViewKey, typeof BREADTH_VIEW.INTRADAY>];
  const sliced = bars.slice(-windowDays);
  return {
    grid: { left: 44, right: 44, top: 18, bottom: 24 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    legend: {
      right: 8,
      top: 0,
      itemWidth: 14,
      itemHeight: 8,
      textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 },
      data: ['ARMS', DIFF_SERIES_NAME],
    },
    xAxis: {
      type: 'category',
      data: sliced.map((bar) => bar.date.slice(5)),
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
        axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (v: number) => v.toFixed(1) },
      },
      {
        type: 'value',
        scale: true,
        splitLine: { show: false },
        axisLabel: {
          color: CHART_TEXT_COLOR,
          fontSize: 10,
          formatter: (v: number) => `${v / 10_000}万`,
        },
      },
    ],
    series: [
      {
        name: 'ARMS',
        type: 'line',
        yAxisIndex: 0,
        data: sliced.map((bar) => bar.arms),
        connectNulls: false,
        symbol: 'circle',
        symbolSize: 4,
        lineStyle: { color: CHART_LINE_TEAL, width: 1.8 },
        itemStyle: { color: CHART_LINE_TEAL },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: NEUTRAL_LINE_LABEL },
          lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
          data: [{ yAxis: ARMS_NEUTRAL_LINE }],
        },
      },
      {
        name: DIFF_SERIES_NAME,
        type: 'bar',
        yAxisIndex: 1,
        barMaxWidth: 8,
        data: sliced.map((bar) => {
          const diff = bar.upCount - bar.downCount;
          return { value: diff, itemStyle: { color: diff >= 0 ? trend.upLight : trend.downLight } };
        }),
      },
    ],
  };
});
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${height}px`, width: '100%' }" />
</template>

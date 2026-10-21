<script setup lang="ts">
import { computed } from 'vue';
import { useDark } from '@vueuse/core';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_BLUE,
  CHART_LINE_TEAL,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import {
  ARMS_NEUTRAL_LINE,
  BREADTH_ADR_OVERBOUGHT,
  BREADTH_ADR_OVERSOLD,
  BREADTH_INDICATOR_VIEW_DAYS,
  BREADTH_MCO_OVERBOUGHT,
  BREADTH_MCO_OVERSOLD,
  type BreadthIndicatorKind,
  type BreadthIndicatorViewKey,
} from '../../../common/constants/market-breadth.constants.ts';
import type { BreadthDayBar, BreadthIndicatorSeries } from '../../../common/types/market-breadth.types.ts';
import { useSettingsStore } from '../../../common/stores/settings';
import { readTrendColors } from '../../../common/utils/trend-colors';
import BaseChart from './BaseChart.vue';

/**
 * 市场广度指标副图（ECharts，按 kind 切换五种指标形态）
 *
 * - adl：ADL 面积线（蓝）+ MA 虚线；
 * - adr：ADR 线 + 超买 1.5 / 平衡 1.0 / 超卖 0.5 参考线；
 * - obos：涨跌家数差 N 日净差柱（红正绿负）+ MA 线；
 * - arms：ARMS 日线（青绿）+ 家数差柱（次轴，自 ArmsTrendChart 迁移的日线形态）；
 * - mco：MCO 线 + 信号线 + 0 轴 + 超买超卖淡色带（±25~35）。
 * 全部走日线档位（分钟点仅 3 日滚存，只对 ARMS 分时有意义，页面不展示分时）。
 */
const {
  kind,
  view,
  bars = [],
  series,
  height = 200,
} = defineProps<{
  /** 副图指标种类 */
  kind: BreadthIndicatorKind;
  /** 视图 key（近 60 日 / 近 120 日 / 全部） */
  view: BreadthIndicatorViewKey;
  /** 日 bar 序列（日期升序，供 ARMS 家数差柱） */
  bars?: BreadthDayBar[];
  /** 五指标计算序列（与 bars 同源，窗口内对齐切片） */
  series: BreadthIndicatorSeries;
  /** 图表高度（像素） */
  height?: number;
}>();

const settingsStore = useSettingsStore();
const isDark = useDark();

/** 视图窗口切片下标起点（全部积累时为 0） */
const startIndex = computed(() => {
  const days = BREADTH_INDICATOR_VIEW_DAYS[view];
  return days === undefined ? 0 : Math.max(0, series.dates.length - days);
});

/** 窗口内日期标签（MM-DD） */
const dateLabels = computed(() => series.dates.slice(startIndex.value).map((date) => date.slice(5)));

/**
 * 数组窗口切片（null / 对象项均保留）
 * @param values 完整序列
 * @returns 窗口内切片
 */
const sliceSeries = <T>(values: T[]): T[] => values.slice(startIndex.value);

const option = computed<EChartsCoreOption>(() => {
  void settingsStore.trendTheme;
  void isDark.value;
  const trend = readTrendColors();

  /** 公共骨架：日期类 x 轴 + 单值 y 轴 + 轴触发 tooltip */
  const base = {
    grid: { left: 56, right: 14, top: 10, bottom: 20 },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'line' },
    },
    xAxis: {
      type: 'category',
      data: dateLabels.value,
      boundaryGap: kind === 'obos' || kind === 'arms',
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
    },
  };

  if (kind === 'adl') {
    return {
      ...base,
      series: [
        {
          name: 'ADL',
          type: 'line',
          data: sliceSeries(series.adl),
          connectNulls: false,
          symbol: 'none',
          lineStyle: { color: CHART_LINE_BLUE, width: 1.8 },
          areaStyle: { color: CHART_LINE_BLUE, opacity: 0.08 },
        },
        {
          name: 'ADL 均线',
          type: 'line',
          data: sliceSeries(series.adlMa),
          connectNulls: false,
          symbol: 'none',
          lineStyle: { color: trend.flat, type: 'dashed', width: 1.2 },
        },
      ],
    };
  }

  if (kind === 'adr') {
    return {
      ...base,
      series: [
        {
          name: 'ADR',
          type: 'line',
          data: sliceSeries(series.adr),
          connectNulls: false,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { color: CHART_LINE_TEAL, width: 1.8 },
          itemStyle: { color: CHART_LINE_TEAL },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              {
                yAxis: BREADTH_ADR_OVERBOUGHT,
                label: { color: trend.down, fontSize: 10, formatter: `超买 ${BREADTH_ADR_OVERBOUGHT}` },
                lineStyle: { color: trend.down, type: 'dashed', width: 1 },
              },
              {
                yAxis: 1,
                label: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: '平衡 1.0' },
                lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
              },
              {
                yAxis: BREADTH_ADR_OVERSOLD,
                label: { color: trend.up, fontSize: 10, formatter: `超卖 ${BREADTH_ADR_OVERSOLD}` },
                lineStyle: { color: trend.up, type: 'dashed', width: 1 },
              },
            ],
          },
        },
      ],
    };
  }

  if (kind === 'obos') {
    return {
      ...base,
      series: [
        {
          name: 'OBOS',
          type: 'bar',
          barMaxWidth: 8,
          data: sliceSeries(series.obos).map((value) => ({
            value,
            itemStyle: { color: value === null ? trend.flat : value >= 0 ? trend.upLight : trend.downLight },
          })),
        },
        {
          name: 'OBOS 均线',
          type: 'line',
          data: sliceSeries(series.obosMa),
          connectNulls: false,
          symbol: 'none',
          lineStyle: { color: trend.flat, type: 'dashed', width: 1.2 },
        },
      ],
    };
  }

  if (kind === 'arms') {
    /** 家数差柱数据（红涨绿负，随涨跌配色主题） */
    const diffBars = bars.map((bar) => {
      const diff = bar.upCount - bar.downCount;
      return { value: diff, itemStyle: { color: diff >= 0 ? trend.upLight : trend.downLight } };
    });
    return {
      ...base,
      grid: { left: 56, right: 56, top: 10, bottom: 20 },
      yAxis: [
        { ...base.yAxis, axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (v: number) => v.toFixed(1) } },
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
          data: sliceSeries(series.dates.map((_, i) => bars[startIndex.value + i]?.arms ?? null)),
          connectNulls: false,
          symbol: 'circle',
          symbolSize: 4,
          lineStyle: { color: CHART_LINE_TEAL, width: 1.8 },
          itemStyle: { color: CHART_LINE_TEAL },
          markLine: {
            silent: true,
            symbol: 'none',
            label: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: '平衡线 1.0' },
            lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
            data: [{ yAxis: ARMS_NEUTRAL_LINE }],
          },
        },
        {
          name: 'ARMS 均线',
          type: 'line',
          yAxisIndex: 0,
          data: sliceSeries(series.armsMa),
          connectNulls: false,
          symbol: 'none',
          lineStyle: { color: trend.flat, type: 'dashed', width: 1.2 },
        },
        {
          name: '上涨-下跌家数差',
          type: 'bar',
          yAxisIndex: 1,
          barMaxWidth: 8,
          data: sliceSeries(diffBars),
        },
      ],
    };
  }

  // mco：MCO 线 + 信号线 + 0 轴 + 超买超卖淡带
  return {
    ...base,
    series: [
      {
        name: 'MCO',
        type: 'line',
        data: sliceSeries(series.mco),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: CHART_LINE_TEAL, width: 1.8 },
        markLine: {
          silent: true,
          symbol: 'none',
          label: { show: false },
          lineStyle: { color: trend.flat, type: 'dashed', width: 1 },
          data: [{ yAxis: 0 }],
        },
        markArea: {
          silent: true,
          data: [
            [
              { yAxis: BREADTH_MCO_OVERBOUGHT, itemStyle: { color: trend.down, opacity: 0.06 } },
              { yAxis: 'max', label: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: '超买区' } },
            ],
            [
              { yAxis: 'min', itemStyle: { color: trend.up, opacity: 0.06 } },
              { yAxis: BREADTH_MCO_OVERSOLD, label: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: '超卖区' } },
            ],
          ],
        },
      },
      {
        name: 'MAMCO',
        type: 'line',
        data: sliceSeries(series.mcoSignal),
        connectNulls: false,
        symbol: 'none',
        lineStyle: { color: trend.flat, type: 'dashed', width: 1.2 },
      },
    ],
  };
});
</script>

<template>
  <BaseChart :options="option" :style="{ height: `${height}px`, width: '100%' }" />
</template>

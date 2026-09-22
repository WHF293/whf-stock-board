<script setup lang="ts">
import { computed } from 'vue';
import { useDark } from '@vueuse/core';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../constants/chart.constants';
import { STORAGE_NS_COLOR_SCHEME } from '../../../../constants/storage-key.constants';
import { appStorage } from '../../../../utils/app-local-storage';
import { readCssVar } from '../../../../utils/read-css-var';
import { readTrendColors } from '../../../../utils/trend-colors';
import { useSettingsStore } from '../../../../stores/settings';
import BaseChart from '../../../../components/charts/BaseChart.vue';
import {
  BEAR_STAGE_CSS_VAR,
  BEAR_STAGE_TEXT_CSS_VAR,
  BULL_CHART_HEIGHT_PX,
  BULL_STAGE_CSS_VAR,
  BULL_STAGE_TEXT_CSS_VAR,
} from '../constants';
import { buildBearStats, buildRoundStats } from '../judge';
import type { MonthlyBar, ReviewRoundMeta } from '../types';

/**
 * 行情四阶段图：轮次窗口内的指数月 K 收盘线，底层铺阶段色带（markArea），
 * 标注起点 / 顶点 / 低点（熊市 = 顶部 / 低点），关键位拉虚线。
 * 色带与标注色全部运行时读 CSS 变量（随主题 / 涨跌配色 / 暗色自动跟随）；
 * 牛市与熊市使用各自色板（`mode` 区分）。
 */
const props = withDefaults(
  defineProps<{
    /** 轮次档案（提供窗口与阶段区间） */
    round: ReviewRoundMeta;
    /** 该轮叠加指数的全量月 K（升序；可为空，空时不渲染） */
    bars: readonly MonthlyBar[];
    /** 行情方向（决定阶段色板与统计口径） */
    mode?: 'bull' | 'bear';
  }>(),
  { mode: 'bull' },
);

const settingsStore = useSettingsStore();

/** 感知暗色模式（与 BaseChart 写同一 storage key，状态一致；切换时重建实例） */
const isDark = useDark({ storageKey: STORAGE_NS_COLOR_SCHEME, storage: appStorage });

/**
 * 收盘价展示文案（指数点位取整，低价指数保留两位）
 * @param close 收盘价
 * @returns 展示文案
 */
const formatClose = (close: number): string =>
  close >= 100 ? close.toFixed(0) : close.toFixed(2);

/** 图表 option（依赖涨跌配色主题与暗色，切换后重算；实例由 BaseChart 重建） */
const option = computed<EChartsCoreOption>(() => {
  void settingsStore.trendTheme;
  void isDark.value;

  const bars = props.bars.filter(
    (bar) => bar.month >= props.round.window.start && bar.month <= props.round.window.end,
  );
  if (bars.length < 2) return {};

  const trendSet = readTrendColors();
  const primary = readCssVar('--color-primary');
  const isBear = props.mode === 'bear';
  const bullStats = isBear ? null : buildRoundStats(props.bars, props.round);
  const bearStats = isBear ? buildBearStats(props.bars, props.round) : null;
  const stageVars = isBear ? BEAR_STAGE_CSS_VAR : BULL_STAGE_CSS_VAR;
  const stageTextVars = isBear ? BEAR_STAGE_TEXT_CSS_VAR : BULL_STAGE_TEXT_CSS_VAR;

  const stageAreas = props.round.stages.map((stage) => [
    {
      xAxis: stage.start,
      itemStyle: { color: readCssVar(stageVars[stage.tone]) },
      label: {
        show: true,
        position: 'insideTopLeft',
        formatter: stage.name,
        color: readCssVar(stageTextVars[stage.tone]),
        fontSize: 12,
        fontWeight: 600,
        distance: 6,
      },
    },
    { xAxis: stage.end },
  ]);

  /** 标注点：牛市 = 起点 / 顶点 / 低点；熊市 = 顶部 / 低点。label 直接给完整文案避免模板转义 */
  const annotations: { value: [string, number]; color: string; label: string }[] = [];
  if (bearStats) {
    annotations.push(
      {
        value: [bars[0]!.month, bars[0]!.close],
        color: trendSet.upStrong,
        label: `顶部 ${formatClose(bars[0]!.close)}（${bars[0]!.month}）`,
      },
      {
        value: [bearStats.troughMonth, bearStats.troughClose],
        color: trendSet.downStrong,
        label: `低点 ${formatClose(bearStats.troughClose)}（${bearStats.troughMonth}）`,
      },
    );
  } else {
    annotations.push({
      value: [bars[0]!.month, bars[0]!.close],
      color: trendSet.flat,
      label: `起点 ${formatClose(bars[0]!.close)}`,
    });
    if (bullStats) {
      annotations.push(
        {
          value: [bullStats.peakMonth, bullStats.peakClose],
          color: trendSet.upStrong,
          label: `顶点 ${formatClose(bullStats.peakClose)}（${bullStats.peakMonth}）`,
        },
        {
          value: [bullStats.troughMonth, bullStats.troughClose],
          color: trendSet.downStrong,
          label: `低点 ${formatClose(bullStats.troughClose)}（${bullStats.troughMonth}）`,
        },
      );
    }
  }

  /** 关键位虚线：牛市 = 见顶月；熊市 = 见底月 */
  const guideLine = bearStats
    ? {
        symbol: 'none',
        silent: true,
        label: { show: false },
        lineStyle: { type: 'dashed', color: trendSet.downStrong, opacity: 0.6 },
        data: [{ xAxis: bearStats.troughMonth }],
      }
    : bullStats
      ? {
          symbol: 'none',
          silent: true,
          label: { show: false },
          lineStyle: { type: 'dashed', color: trendSet.upStrong, opacity: 0.6 },
          data: [{ xAxis: bullStats.peakMonth }],
        }
      : undefined;

  return {
    tooltip: { trigger: 'axis' },
    grid: { left: 8, right: 16, top: 28, bottom: 8, containLabel: true },
    xAxis: {
      type: 'category',
      data: bars.map((bar) => bar.month),
      boundaryGap: false,
      axisLabel: { color: CHART_TEXT_COLOR },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      scale: true,
      axisLabel: { color: CHART_TEXT_COLOR },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        name: props.round.indexName,
        type: 'line',
        data: bars.map((bar) => bar.close),
        showSymbol: false,
        lineStyle: { width: 2, color: primary },
        itemStyle: { color: primary },
        areaStyle: { color: primary, opacity: 0.07 },
        markArea: { silent: true, data: stageAreas },
        markLine: guideLine,
      },
      {
        name: '标注',
        type: 'scatter',
        data: annotations.map((item) => ({
          value: item.value,
          itemStyle: { color: item.color },
          label: {
            show: true,
            position: 'top',
            distance: 8,
            formatter: item.label,
            color: item.color,
            fontWeight: 600,
            fontSize: 12,
          },
        })),
        symbolSize: 8,
        z: 5,
      },
    ],
  };
});
</script>

<template>
  <BaseChart
    v-if="bars.length >= 2"
    :options="option"
    :style="{ height: `${BULL_CHART_HEIGHT_PX}px` }"
    class="w-full"
  />
</template>

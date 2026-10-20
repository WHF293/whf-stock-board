<script setup lang="ts">
import { computed } from 'vue';
import BaseChart from '../../charts/BaseChart.vue';
import BaseButton from '../../ui/BaseButton.vue';
import { CCPM_SERIES_DAYS } from '../../../../common/constants/futures.constants.ts';
import { DOWN_COLOR, UP_COLOR } from '../../../../common/constants/stock-colors.constants.ts';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import type {
  CcpmAggregateRow,
  CcpmMemberSeries,
  CcpmMemberStats,
  CcpmScopeMode,
} from '../../../../common/types/futures.types.ts';
import type { EChartsCoreOption } from 'echarts/core';

/**
 * 机构行为页 · 可视化图表区
 *
 * 三层递进：① 多单占比条形（单合约口径，观察资金集中度）② 头部席位多空并排
 * 柱状（判断对冲还是单边）③ 选中席位合并净持仓时序（默认近 20 个披露日，
 * 按需加载——逐日拉取上游 CSV）。语义色与 stock-colors 常量同源，跟随涨跌主题。
 */
const props = defineProps<{
  /** 页面口径 */
  scope: CcpmScopeMode;
  /** 单合约口径行数据（占比 / 多空柱状用） */
  stats?: readonly CcpmMemberStats[];
  /** 聚合口径行数据（多空柱状用） */
  aggregates?: readonly CcpmAggregateRow[];
  /** 当前选中席位（时序图目标；null 时显示引导） */
  selectedMember: string | null;
  /** 席位时序数据（未加载时为 null） */
  series: CcpmMemberSeries | null;
  /** 时序是否加载中 */
  seriesLoading?: boolean;
  /** 时序是否为部分头寸数据（covered < total 的日占比） */
  seriesPartial?: boolean;
}>();

const emit = defineEmits<{
  /** 请求加载席位时序 */
  'load-series': [];
}>();

/** 图表高度常量（px）：BaseChart 根节点自带 h-full，必须用内联 style 压住（class 会与之打架） */
const RATIO_CHART_HEIGHT_PX = 256;
const BARS_CHART_HEIGHT_PX = 256;
const SERIES_CHART_HEIGHT_PX = 224;

/** 图表公共轴样式（与全站 chart 常量同源） */
const AXIS_STYLE = {
  axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
  axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
  splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
} as const;

/**
 * 数值轴格式化（千分位）
 * @param value 数值
 * @returns 文案
 */
const formatAxisNumber = (value: number): string => value.toLocaleString('en-US');

/** 图①：多单占比横向条形（单合约口径独有） */
const ratioOption = computed<EChartsCoreOption | null>(() => {
  if (props.scope !== 'contract') {
    return null;
  }
  const ranked = (props.stats ?? [])
    .filter((row) => row.buyRatio !== null)
    .sort((a, b) => (b.buyRatio ?? 0) - (a.buyRatio ?? 0))
    .slice(0, 10)
    .reverse();
  return {
    grid: { left: 8, right: 40, top: 4, bottom: 4, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (value: unknown) => `${Number(value).toFixed(1)}%`,
    },
    xAxis: { type: 'value', ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: '{value}%' } },
    yAxis: {
      type: 'category',
      data: ranked.map((row) => row.memberName),
      ...AXIS_STYLE,
      axisTick: { show: false },
      axisLabel: { ...AXIS_STYLE.axisLabel, width: 96, overflow: 'truncate' },
    },
    series: [
      {
        type: 'bar',
        data: ranked.map((row) => Number((row.buyRatio ?? 0).toFixed(2))),
        barMaxWidth: 12,
        itemStyle: { color: UP_COLOR, borderRadius: [0, 4, 4, 0] },
      },
    ],
  };
});

/** 图②：头部席位多空并排柱状（两种口径共用，聚合口径取合并多空） */
const barsOption = computed<EChartsCoreOption | null>(() => {
  if (props.scope === 'contract') {
    const ranked = (props.stats ?? [])
      .filter((row) => row.buyPos !== null || row.sellPos !== null)
      .sort((a, b) => Math.max(b.buyPos ?? 0, b.sellPos ?? 0) - Math.max(a.buyPos ?? 0, a.sellPos ?? 0))
      .slice(0, 6);
    if (ranked.length === 0) {
      return null;
    }
    return {
      grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
      legend: { top: 0, textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 } },
      tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: formatAxisNumber },
      xAxis: {
        type: 'category',
        data: ranked.map((row) => row.memberName.replace(/\(代客\)$/, '')),
        ...AXIS_STYLE,
        axisTick: { show: false },
        axisLabel: { ...AXIS_STYLE.axisLabel, width: 52, overflow: 'truncate' },
      },
      yAxis: { type: 'value', ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: formatAxisNumber } },
      series: [
        { name: '多单', type: 'bar', data: ranked.map((row) => row.buyPos ?? 0), barMaxWidth: 14, itemStyle: { color: UP_COLOR, borderRadius: [4, 4, 0, 0] } },
        { name: '空单', type: 'bar', data: ranked.map((row) => row.sellPos ?? 0), barMaxWidth: 14, itemStyle: { color: DOWN_COLOR, borderRadius: [4, 4, 0, 0] } },
      ],
    };
  }
  const ranked = (props.aggregates ?? []).slice(0, 6);
  if (ranked.length === 0) {
    return null;
  }
  return {
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    legend: { top: 0, textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 } },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' }, valueFormatter: formatAxisNumber },
    xAxis: {
      type: 'category',
      data: ranked.map((row) => row.memberName.replace(/\(代客\)$/, '')),
      ...AXIS_STYLE,
      axisTick: { show: false },
      axisLabel: { ...AXIS_STYLE.axisLabel, width: 52, overflow: 'truncate' },
    },
    yAxis: { type: 'value', ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: formatAxisNumber } },
    series: [
      { name: '合并多单', type: 'bar', data: ranked.map((row) => row.totalBuy), barMaxWidth: 14, itemStyle: { color: UP_COLOR, borderRadius: [4, 4, 0, 0] } },
      { name: '合并空单', type: 'bar', data: ranked.map((row) => row.totalSell), barMaxWidth: 14, itemStyle: { color: DOWN_COLOR, borderRadius: [4, 4, 0, 0] } },
    ],
  };
});

/**
 * 交易日标签（yyyyMMdd → MM-DD）
 * @param day 交易日
 * @returns 短标签
 */
const dayLabel = (day: string): string => `${day.slice(4, 6)}-${day.slice(6, 8)}`;

/** 图③：选中席位合并净持仓时序（线 = 净持仓，柱 = 净增减） */
const seriesOption = computed<EChartsCoreOption | null>(() => {
  const points = props.series?.points ?? [];
  if (points.length === 0) {
    return null;
  }
  return {
    grid: { left: 8, right: 8, top: 24, bottom: 4, containLabel: true },
    legend: { top: 0, textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 } },
    tooltip: { trigger: 'axis', valueFormatter: formatAxisNumber },
    xAxis: {
      type: 'category',
      data: points.map((point) => dayLabel(point.tradingDay)),
      ...AXIS_STYLE,
      axisTick: { show: false },
    },
    yAxis: [
      { type: 'value', ...AXIS_STYLE, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: formatAxisNumber } },
      { type: 'value', ...AXIS_STYLE, splitLine: { show: false }, axisLabel: { ...AXIS_STYLE.axisLabel, formatter: formatAxisNumber } },
    ],
    series: [
      {
        name: '合并净持仓',
        type: 'line',
        data: points.map((point) => point.totalNet),
        smooth: true,
        symbolSize: 5,
        lineStyle: { width: 2, color: '#0e9488' },
        itemStyle: { color: '#0e9488' },
      },
      {
        name: '净增减',
        type: 'bar',
        yAxisIndex: 1,
        data: points.map((point) => point.totalNetChg),
        barMaxWidth: 10,
        itemStyle: {
          borderRadius: 2,
          color: (params: { data: number }) => (params.data >= 0 ? UP_COLOR : DOWN_COLOR),
        },
      },
    ],
  };
});
</script>

<template>
  <div class="grid grid-cols-1 gap-3 xl:grid-cols-2">
    <section
      v-if="ratioOption"
      class="rounded-card bg-surface p-4 shadow-card"
    >
      <header class="mb-2 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-text">多头席位占比 TOP10</h2>
        <span class="text-xs text-text-tertiary">÷ 上榜总多单</span>
      </header>
      <BaseChart :options="ratioOption" :style="{ height: `${RATIO_CHART_HEIGHT_PX}px` }" />
    </section>

    <section
      v-if="barsOption"
      class="rounded-card bg-surface p-4 shadow-card"
    >
      <header class="mb-2 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-text">头部席位 多单 vs 空单</h2>
        <span class="text-xs text-text-tertiary">{{ scope === 'contract' ? '体量对比：对冲还是单边' : '合并口径' }}</span>
      </header>
      <BaseChart :options="barsOption" :style="{ height: `${BARS_CHART_HEIGHT_PX}px` }" />
    </section>

    <section
      class="rounded-card bg-surface p-4 shadow-card xl:col-span-2"
      :class="{ 'xl:col-span-2': !ratioOption }"
    >
      <header class="mb-2 flex items-center justify-between gap-2">
        <h2 class="text-sm font-semibold text-text">
          席位合并净持仓时序{{ selectedMember ? ` · ${selectedMember}` : '' }}
        </h2>
        <div class="flex items-center gap-2">
          <span v-if="seriesPartial" class="text-xs text-up">含部分头寸日</span>
          <BaseButton
            v-if="selectedMember && !series"
            variant="ghost"
            :disabled="seriesLoading"
            @click="emit('load-series')"
          >
            {{ seriesLoading ? '加载中…' : `加载近 ${CCPM_SERIES_DAYS} 个披露日` }}
          </BaseButton>
        </div>
      </header>
      <BaseChart v-if="seriesOption" :options="seriesOption" :style="{ height: `${SERIES_CHART_HEIGHT_PX}px` }" />
      <div v-else class="grid h-56 place-items-center text-center text-xs text-text-tertiary">
        <template v-if="selectedMember">
          {{ seriesLoading ? '正在逐日拉取披露数据…' : '点击右上角按钮加载时序，排除单日噪音' }}
        </template>
        <template v-else>在总表中点击席位行后，可加载该席位的净持仓时序</template>
      </div>
    </section>
  </div>
</template>

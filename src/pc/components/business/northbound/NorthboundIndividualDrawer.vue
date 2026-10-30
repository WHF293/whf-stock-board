<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_BLUE,
  CHART_LINE_PURPLE,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import { NORTHBOUND_RANK_QUARTERLY_NOTICE } from '../../../../common/constants/northbound.constants.ts';
import { fetchNorthboundIndividual } from '../../../../common/api/northbound.api.ts';
import { formatNorthboundAmount } from '../../../../common/utils/format-northbound-amount.ts';
import type { NorthboundIndividualItem } from '../../../../common/types/northbound.types.ts';
import BaseDrawer from '../../ui/BaseDrawer.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseChart from '../../charts/BaseChart.vue';

/**
 * 个股北向持仓历史抽屉（排行卡行尾「持仓」按钮唤起）
 *
 * 上游为季度披露快照，默认回溯 120 日（覆盖 1-2 期）；头部摘要展示最新市值 /
 * 占总股本比 / 较上期变动，主图为持股市值面积线 + 占总股本比虚线（右轴）
 */

/** 抽屉图表高度（像素） */
const CHART_HEIGHT_PX = 200;

const { symbol, name } = defineProps<{
  /** 个股符号（6 位纯代码即可，api 内部归一）；null 时不拉取 */
  symbol: string | null;
  /** 个股名称（抽屉标题） */
  name: string;
}>();

const open = defineModel<boolean>('open', { required: true });

/** 持仓历史（升序） */
const rows = ref<NorthboundIndividualItem[]>([]);

/** 是否加载中 */
const isLoading = ref(false);

/** 是否取数失败 / 无数据 */
const isEmpty = ref(false);

/**
 * 打开或 symbol 变化时拉取
 * @returns 无显式返回值（结果写入 rows / isLoading / isEmpty）
 */
watch([open, () => symbol], async ([isOpen]) => {
  if (!isOpen || !symbol) return;
  isLoading.value = true;
  isEmpty.value = false;
  rows.value = [];
  try {
    const data = await fetchNorthboundIndividual(symbol, '120d');
    rows.value = data;
    isEmpty.value = data.length === 0;
  } catch (error) {
    console.error('[northbound] 个股北向持仓取数失败', error);
    isEmpty.value = true;
  } finally {
    isLoading.value = false;
  }
});

/** 最新一期 */
const latest = computed(() => rows.value.at(-1) ?? null);

/** 上一期（市值变动对比基准） */
const previous = computed(() => rows.value.at(-2) ?? null);

/** 最新市值较上期变动（元；缺上期时 null） */
const marketValueDelta = computed<number | null>(() => {
  if (!latest.value?.holdMarketValue || !previous.value?.holdMarketValue) return null;
  return latest.value.holdMarketValue - previous.value.holdMarketValue;
});

const option = computed<EChartsCoreOption>(() => ({
  animation: false,
  legend: {
    show: true,
    top: 0,
    right: 0,
    itemWidth: 12,
    itemHeight: 2,
    textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 },
  },
  tooltip: {
    trigger: 'axis',
    formatter: (params: unknown) => {
      const list = params as { axisValue: string; value: number | null; marker: string; seriesName: string }[];
      const date = list[0]?.axisValue ?? '';
      const lines = list.map((item) => {
        if (item.value === null) return `${item.marker}${item.seriesName}：--`;
        const text =
          item.seriesName === '占总股本比'
            ? `${item.value.toFixed(2)}%`
            : formatNorthboundAmount({ value: item.value, source: 'yuan' });
        return `${item.marker}${item.seriesName}：${text}`;
      });
      return [date, ...lines].join('<br/>');
    },
  },
  grid: { left: 8, right: 8, top: 26, bottom: 0, containLabel: true },
  xAxis: {
    type: 'category',
    data: rows.value.map((row) => row.date),
    axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
    axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
    axisTick: { show: false },
  },
  yAxis: [
    {
      type: 'value',
      scale: true,
      axisLabel: {
        color: CHART_TEXT_COLOR,
        fontSize: 10,
        formatter: (value: number) => formatNorthboundAmount({ value, source: 'yuan' }).replace(' ', ''),
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    {
      type: 'value',
      scale: true,
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10, formatter: (value: number) => `${value}%` },
      splitLine: { show: false },
    },
  ],
  series: [
    {
      name: '持股市值',
      type: 'line',
      data: rows.value.map((row) => row.holdMarketValue),
      showSymbol: true,
      symbolSize: 6,
      lineStyle: { width: 2, color: CHART_LINE_BLUE },
      itemStyle: { color: CHART_LINE_BLUE },
      areaStyle: { opacity: 0.08, color: CHART_LINE_BLUE },
    },
    {
      name: '占总股本比',
      type: 'line',
      yAxisIndex: 1,
      data: rows.value.map((row) => row.holdRatioTotal),
      showSymbol: true,
      symbolSize: 6,
      lineStyle: { width: 1.5, type: 'dashed', color: CHART_LINE_PURPLE },
      itemStyle: { color: CHART_LINE_PURPLE },
    },
  ],
}));
</script>

<template>
  <BaseDrawer v-model:open="open" :title="`${name} · 北向持仓历史`" width="620px">
    <p class="mb-3 text-[11px] text-text-tertiary">{{ NORTHBOUND_RANK_QUARTERLY_NOTICE }}</p>

    <BaseSkeleton v-if="isLoading" class="h-[360px]" />
    <BaseEmpty v-else-if="isEmpty" text="暂无北向持仓数据" />
    <template v-else-if="latest">
      <!-- 头部摘要 -->
      <div class="mb-3 grid grid-cols-3 gap-2 text-xs">
        <div class="rounded-lg bg-canvas p-2.5">
          <p class="text-text-tertiary">最新持股市值</p>
          <p class="num mt-0.5 text-sm font-semibold text-text">
            {{ formatNorthboundAmount({ value: latest.holdMarketValue, source: 'yuan' }) }}
          </p>
        </div>
        <div class="rounded-lg bg-canvas p-2.5">
          <p class="text-text-tertiary">占总股本比</p>
          <p class="num mt-0.5 text-sm font-semibold text-text">
            {{ latest.holdRatioTotal === null ? '--' : `${latest.holdRatioTotal.toFixed(2)}%` }}
          </p>
        </div>
        <div class="rounded-lg bg-canvas p-2.5">
          <p class="text-text-tertiary">较上期变动</p>
          <p
            class="num mt-0.5 text-sm font-semibold"
            :class="(marketValueDelta ?? 0) > 0 ? 'text-up' : (marketValueDelta ?? 0) < 0 ? 'text-down' : 'text-flat'"
          >
            {{ formatNorthboundAmount({ value: marketValueDelta, source: 'yuan' }) }}
          </p>
        </div>
      </div>

      <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />

      <!-- 近期明细 -->
      <div class="mt-3 overflow-x-auto">
        <table class="w-full whitespace-nowrap text-xs">
          <thead>
            <tr class="border-b border-flat-weak text-left text-text-tertiary">
              <th class="py-1.5 pr-3 font-normal">数据期</th>
              <th class="py-1.5 pr-3 text-right font-normal">持股数(万)</th>
              <th class="py-1.5 pr-3 text-right font-normal">市值</th>
              <th class="py-1.5 pr-3 text-right font-normal">占流通股比</th>
              <th class="py-1.5 pr-3 text-right font-normal">占总股本比</th>
              <th class="py-1.5 text-right font-normal">收盘价</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in [...rows].reverse()"
              :key="row.date"
              class="border-b border-flat-weak/60 last:border-0"
            >
              <td class="py-1.5 pr-3 num text-text">{{ row.date }}</td>
              <td class="py-1.5 pr-3 text-right num text-text">
                {{ row.holdShares === null ? '--' : (row.holdShares / 10_000).toLocaleString('zh-CN', { maximumFractionDigits: 0 }) }}
              </td>
              <td class="py-1.5 pr-3 text-right num text-text">
                {{ formatNorthboundAmount({ value: row.holdMarketValue, source: 'yuan' }) }}
              </td>
              <td class="py-1.5 pr-3 text-right num text-text-secondary">
                {{ row.holdRatioFloat === null ? '--' : `${row.holdRatioFloat.toFixed(2)}%` }}
              </td>
              <td class="py-1.5 pr-3 text-right num text-text-secondary">
                {{ row.holdRatioTotal === null ? '--' : `${row.holdRatioTotal.toFixed(2)}%` }}
              </td>
              <td class="py-1.5 text-right num text-text">{{ row.close ?? '--' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </BaseDrawer>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_PURPLE,
  CHART_LINE_TEAL,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import { NORTHBOUND_HISTORY_RANGE_OPTIONS } from '../../../../common/constants/northbound.constants.ts';
import { NORTHBOUND_NORTH_HISTORY_TIP } from '../../../../common/constants/mutual-sidebar.constants.ts';
import { fetchNorthboundHistory } from '../../../../common/api/northbound.api.ts';
import { formatNorthboundAmount } from '../../../../common/utils/format-northbound-amount.ts';
import type {
  NorthboundHistoryRange,
  NorthboundHistoryRow,
} from '../../../../common/types/northbound.types.ts';
import BaseTabs from '../../ui/BaseTabs.vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseChart from '../../charts/BaseChart.vue';
import MenuIcon from '../../ui/MenuIcon.vue';

/**
 * 北向资金历史卡（成交额口径，南北向资金侧边栏）
 *
 * 与南向历史卡（NorthboundFlowTrendCard）同源数据通道（RPT_MUTUAL_DEAL_HISTORY
 * 北向合计行 005），但北向净买额自 2024-08-19 起停披露为 null 且无公开替代来源——
 * 主图改为「当日成交额柱」（官方持续披露口径，跟踪活跃度）+ 净买额虚线
 * （仅停披露前有真实值，之后断线），口径说明见标题问号（常量单源）。
 * 范围（30/60/120 日）切换即重拉（不轮询），竞态由序列号守卫
 *
 * 明细表折叠：与南向历史卡同款，展开开关放在范围切换按钮左边，默认收起
 */

/** 明细表展示行数（最近 N 个交易日） */
const DETAIL_ROW_COUNT = 6;

/** 明细表是否展开（默认收起） */
const isDetailExpanded = ref(false);

/** 历史卡图表高度（像素） */
const CHART_HEIGHT_PX = 200;

/** 当前范围 */
const range = ref<NorthboundHistoryRange>('30d');

/** 历史序列（升序） */
const rows = ref<NorthboundHistoryRow[]>([]);

/** 是否加载中 */
const isLoading = ref(false);

/** 是否取数失败（且无已成功数据兜底） */
const isError = ref(false);

/** 加载序列号（防切换竞态：旧响应回来不覆盖新参数的数据） */
const loadSeq = ref(0);

/** 拉取历史（参数变化即重拉；竞态由序列号守卫） */
const loadHistory = async (): Promise<void> => {
  const seq = loadSeq.value + 1;
  loadSeq.value = seq;
  isLoading.value = true;
  try {
    const data = await fetchNorthboundHistory('north', range.value);
    if (seq !== loadSeq.value) return;
    rows.value = data;
    isError.value = data.length === 0;
  } catch (error) {
    console.error('[northbound] 北向资金历史取数失败', error);
    if (seq !== loadSeq.value) return;
    isError.value = rows.value.length === 0;
  } finally {
    if (seq === loadSeq.value) {
      isLoading.value = false;
    }
  }
};

// 范围变化即重拉
watch(range, () => {
  void loadHistory();
});

onMounted(() => {
  void loadHistory();
});

/** 停披露后该窗口内是否存在真实净买额（决定净买额图例是否展示） */
const hasNetBuyData = computed(() => rows.value.some((row) => row.netBuyAmount !== null));

/** 图表 option（成交额柱左轴 + 净买额虚线右轴） */
const option = computed<EChartsCoreOption>(() => {
  const list = rows.value;
  return {
    animation: false,
    legend: {
      show: hasNetBuyData.value,
      top: 0,
      right: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 },
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        // ECharts 对 data 里的 null 在 tooltip params 中给的是字符串 '-'（非 null），
        // 必须按「有限数值」过滤，否则 '-' × 单位换算会渲染成 NaN 万（2026-11-06 实测）
        const list = params as { axisValue: string; value: number | null; marker: string; seriesName: string }[];
        const date = list[0]?.axisValue ?? '';
        const lines = list
          .filter((item) => typeof item.value === 'number' && Number.isFinite(item.value))
          .map(
            (item) =>
              `${item.marker}${item.seriesName}：${formatNorthboundAmount({ value: item.value, source: 'yuan' })}`,
          );
        return [date, ...lines].join('<br/>');
      },
    },
    grid: { left: 8, right: 8, top: 26, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: list.map((row) => row.date.slice(5)),
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
        axisLabel: {
          color: CHART_TEXT_COLOR,
          fontSize: 10,
          formatter: (value: number) => formatNorthboundAmount({ value, source: 'yuan' }).replace(' ', ''),
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '当日成交额',
        type: 'bar',
        data: list.map((row) => row.dealAmount),
        itemStyle: { color: CHART_LINE_TEAL },
        barMaxWidth: 10,
      },
      {
        name: '当日净买额',
        type: 'line',
        yAxisIndex: 1,
        data: list.map((row) => row.netBuyAmount),
        showSymbol: false,
        lineStyle: { width: 1.5, type: 'dashed', color: CHART_LINE_PURPLE },
        itemStyle: { color: CHART_LINE_PURPLE },
        connectNulls: false,
      },
    ],
  };
});

/** 明细表数据（最近 N 个交易日，倒序展示最新在前） */
const detailRows = computed(() => rows.value.slice(-DETAIL_ROW_COUNT).reverse());
</script>

<template>
  <BaseCard title="北向资金历史（成交额口径）" :tip="NORTHBOUND_NORTH_HISTORY_TIP">
    <template #extra>
      <div class="flex items-center gap-2">
        <!-- 明细表展开/收起（默认收起，与南向历史卡同款） -->
        <button
          type="button"
          class="pressable flex items-center rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text"
          :aria-expanded="isDetailExpanded"
          aria-label="每日明细"
          @click="isDetailExpanded = !isDetailExpanded"
        >
          <MenuIcon
            name="chevronDown"
            :size="13"
            class="mr-0.5 transition-transform"
            :class="isDetailExpanded ? 'rotate-180' : ''"
          />
          每日明细
        </button>
        <BaseTabs v-model="range" :options="NORTHBOUND_HISTORY_RANGE_OPTIONS" />
      </div>
    </template>

    <BaseSkeleton v-if="isLoading" class="h-[300px]" />
    <BaseEmpty v-else-if="isError" text="北向资金历史加载失败，请稍后重试" />
    <template v-else>
      <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />

      <!-- 每日明细表：默认收起（净买额停披露后展示 --，成交额照常有值） -->
      <div v-if="isDetailExpanded" class="mt-3 overflow-x-auto">
        <table class="w-full min-w-[420px] whitespace-nowrap text-xs">
          <thead>
            <tr class="border-b border-flat-weak text-left text-text-tertiary">
              <th class="py-1.5 pr-3 font-normal">日期</th>
              <th class="py-1.5 pr-3 text-right font-normal">成交额</th>
              <th class="py-1.5 text-right font-normal">净买额</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in detailRows"
              :key="row.date"
              class="border-b border-flat-weak/60 last:border-0"
            >
              <td class="py-1.5 pr-3 num text-text">{{ row.date }}</td>
              <td class="py-1.5 pr-3 text-right num font-medium text-text">
                {{ formatNorthboundAmount({ value: row.dealAmount, source: 'yuan' }) }}
              </td>
              <td
                class="py-1.5 text-right num"
                :class="(row.netBuyAmount ?? 0) > 0 ? 'text-up' : (row.netBuyAmount ?? 0) < 0 ? 'text-down' : 'text-text-tertiary'"
              >
                {{ formatNorthboundAmount({ value: row.netBuyAmount, source: 'yuan' }) }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </BaseCard>
</template>

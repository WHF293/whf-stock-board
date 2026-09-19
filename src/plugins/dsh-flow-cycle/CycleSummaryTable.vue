<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseTable from '../../components/ui/BaseTable.vue';
import { TREND_PILL_CLASS } from '../../constants/stock-colors.constants';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { YUAN_PER_YI } from '../../constants/format.constants';
import { formatPercent } from '../../utils/format-percent';
import {
  FLOW_CYCLE_COMPLETE_LABEL,
  FLOW_CYCLE_PARTIAL_LABEL,
} from './constants';
import type { FlowCycleBoard } from './types';
import type { TableColumn } from '../../types/table.types';

/**
 * 资金周期·区间总览表：各板块区间净额横向对比（区间净额降序默认，可按列排序）
 */
const { boards } = defineProps<{
  /** 板块周期数据（judge 聚合产物） */
  boards: FlowCycleBoard[];
}>();

/** 完整度筛选（all / complete / partial） */
const completenessFilter = ref<'all' | 'complete' | 'partial'>('all');

/** 过滤后的行 */
const filteredBoards = computed(() =>
  completenessFilter.value === 'all'
    ? boards
    : boards.filter((board) => board.completeness === completenessFilter.value),
);

/** 表格列配置 */
const columns: TableColumn<FlowCycleBoard>[] = [
  {
    key: 'name',
    label: '板块',
    sortable: true,
    sortValue: (board) => board.name,
  },
  {
    key: 'changePercent',
    label: '当日涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (board) => board.changePercent ?? 0,
  },
  {
    key: 'netSum',
    label: '区间净额',
    sortable: true,
    sortValue: (board) => board.netSum,
  },
  {
    key: 'days',
    label: '有数交易日',
    align: 'right',
    sortable: true,
    sortValue: (board) => board.history.filter((row) => row.net !== null).length,
  },
  {
    key: 'completeness',
    label: '数据',
    align: 'right',
  },
];

/**
 * 完整度标签
 * @param board 板块行
 * @returns 完整 / 部分
 */
const completenessLabel = (board: FlowCycleBoard): string =>
  board.completeness === 'complete' ? FLOW_CYCLE_COMPLETE_LABEL : FLOW_CYCLE_PARTIAL_LABEL;
</script>

<template>
  <div class="flex flex-col gap-2">
    <div class="flex items-center gap-1.5 text-xs text-text-tertiary">
      <span>完整度</span>
      <button
        type="button"
        class="pressable rounded-full px-2 py-0.5"
        :class="
          completenessFilter === 'all'
            ? 'bg-primary text-on-primary'
            : 'bg-flat-weak text-text-secondary'
        "
        @click="completenessFilter = 'all'"
      >
        全部
      </button>
      <button
        type="button"
        class="pressable rounded-full px-2 py-0.5"
        :class="
          completenessFilter === 'complete'
            ? 'bg-primary text-on-primary'
            : 'bg-flat-weak text-text-secondary'
        "
        @click="completenessFilter = 'complete'"
      >
        {{ FLOW_CYCLE_COMPLETE_LABEL }}
      </button>
      <button
        type="button"
        class="pressable rounded-full px-2 py-0.5"
        :class="
          completenessFilter === 'partial'
            ? 'bg-primary text-on-primary'
            : 'bg-flat-weak text-text-secondary'
        "
        @click="completenessFilter = 'partial'"
      >
        {{ FLOW_CYCLE_PARTIAL_LABEL }}
      </button>
    </div>
    <BaseTable
      :columns="columns"
      :rows="filteredBoards"
      :row-key="(board) => board.code"
      min-width="560px"
      scroll-class="table-scroll-sm"
    >
      <template #name="{ row }">
        <span class="font-medium text-text">{{ row.name }}</span>
        <span class="ml-1.5 text-xs text-text-tertiary">{{ row.code }}</span>
      </template>
      <template #changePercent="{ row }">
        <span
          v-if="row.changePercent !== null"
          class="rounded-full px-2 py-0.5 text-xs font-semibold"
          :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent)]"
        >
          {{ formatPercent(row.changePercent) }}
        </span>
        <span v-else class="text-text-tertiary">--</span>
      </template>
      <template #netSum="{ row }">
        <span
          class="font-medium tabular-nums"
          :class="row.netSum >= 0 ? 'text-up' : 'text-down'"
        >
          {{ row.netSum >= 0 ? '+' : '' }}{{ (row.netSum / YUAN_PER_YI).toFixed(2) }}亿
        </span>
      </template>
      <template #days="{ row }">
        <span class="tabular-nums text-text-secondary">
          {{ row.history.filter((item) => item.net !== null).length }}
        </span>
      </template>
      <template #completeness="{ row }">
        <span
          class="text-xs"
          :class="row.completeness === 'complete' ? 'text-text-secondary' : 'text-text-tertiary'"
        >
          {{ completenessLabel(row) }}
        </span>
      </template>
    </BaseTable>
  </div>
</template>

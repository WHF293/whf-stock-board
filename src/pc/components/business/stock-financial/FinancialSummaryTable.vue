<script setup lang="ts">
import { computed } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseButton from '../../ui/BaseButton.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import { getTrendByChangePercent } from '../../../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../../../common/constants/stock-colors.constants.ts';
import { formatPercent, formatPercentUnsigned } from '../../../../common/utils/format-percent';
import { formatYiValue } from '../../../../common/utils/format-yi-value';
import type { FinancialSummaryRow } from '../../../../common/types/financial.types.ts';

/**
 * 财务摘要多期对比表（详情页财务 Tab）：行 = 指标、列 = 报告期，对齐东财「财务摘要」形态
 *
 * 同比行正负上色（up/down 语义色）；每股经营现金流为负时数值本身也上 down 色；
 * 表头吸顶 + 首列吸左复用全局 table-scroll-sm 样式
 */
const props = defineProps<{
  /** 财务摘要行（报告期倒序） */
  rows: FinancialSummaryRow[];
  /** 是否加载中 */
  loading: boolean;
  /** 错误文案（null = 无错误） */
  error: string | null;
}>();

const emit = defineEmits<{
  /** 点击重试：只重拉财务摘要表 */
  (e: 'retry'): void;
}>();

/** 报告期列（倒序 = 最新在左，与东财一致） */
const periods = computed(() => props.rows.map((row) => row.reportDate));

/**
 * 单元格取值口径：从行内取数并格式化（null 一律 '--'）
 */
interface MetricCell {
  /** 指标名（首列） */
  label: string;
  /** 单位说明（拼进指标名后） */
  unit: string;
  /** 取值：行 -> 展示文案 */
  pick: (row: FinancialSummaryRow) => string;
  /** 取语义色方向：null = 不上色 */
  trend?: (row: FinancialSummaryRow) => 'up' | 'down' | 'flat';
}

/** 摘要表行定义（顺序即展示顺序） */
const METRICS: readonly MetricCell[] = [
  {
    label: '营业总收入',
    unit: '（亿）',
    pick: (row) => formatYiValue(row.totalOperateIncome),
  },
  {
    label: '营收同比',
    unit: '（%）',
    pick: (row) => (row.revenueYoY === null ? '--' : formatPercent(row.revenueYoY)),
    trend: (row) => getTrendByChangePercent(row.revenueYoY ?? 0),
  },
  {
    label: '归母净利润',
    unit: '（亿）',
    pick: (row) => formatYiValue(row.parentNetprofit),
  },
  {
    label: '净利同比',
    unit: '（%）',
    pick: (row) => (row.profitYoY === null ? '--' : formatPercent(row.profitYoY)),
    trend: (row) => getTrendByChangePercent(row.profitYoY ?? 0),
  },
  {
    label: '基本每股收益',
    unit: '（元）',
    pick: (row) => (row.basicEps === null ? '--' : row.basicEps.toFixed(4)),
  },
  {
    label: '每股净资产',
    unit: '（元）',
    pick: (row) => (row.bps === null ? '--' : row.bps.toFixed(2)),
  },
  {
    label: '加权 ROE',
    unit: '（%）',
    pick: (row) =>
      row.weightedAvgRoe === null ? '--' : formatPercentUnsigned(row.weightedAvgRoe),
  },
  {
    label: '销售毛利率',
    unit: '（%）',
    pick: (row) =>
      row.grossMargin === null ? '--' : formatPercentUnsigned(row.grossMargin),
  },
  {
    label: '每股经营现金流',
    unit: '（元）',
    pick: (row) =>
      row.operatingCashFlowPerShare === null ? '--' : row.operatingCashFlowPerShare.toFixed(2),
    trend: (row) =>
      row.operatingCashFlowPerShare === null
        ? 'flat'
        : getTrendByChangePercent(row.operatingCashFlowPerShare),
  },
];

/** 最新一期的分配预案（仅最新期展示，历史期预案不追溯） */
const dividendPlan = computed(() => props.rows[0]?.dividendPlan ?? null);
</script>

<template>
  <BaseSkeleton v-if="loading && rows.length === 0" />
  <div v-else-if="error" class="flex flex-col items-center gap-2 py-8">
    <BaseEmpty :text="`财务摘要加载失败：${error}`" />
    <BaseButton variant="ghost" @click="emit('retry')">
      <MenuIcon name="refresh" :size="14" />
      重试
    </BaseButton>
  </div>
  <BaseEmpty v-else-if="rows.length === 0" text="未取到该股的财务摘要数据（次新股可能尚未披露）" />
  <div v-else class="space-y-1.5 px-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-semibold text-text">财务摘要</span>
      <span class="text-xs text-text-tertiary">数据源：东方财富 · 报告期倒序</span>
    </div>
    <div class="table-scroll-sm rounded-lg border border-flat-weak">
      <table class="w-full border-collapse text-xs">
        <thead>
          <tr>
            <th class="sticky left-0 z-[2] bg-surface px-3 py-2 text-left font-medium text-text-secondary">
              指标
            </th>
            <th
              v-for="period in periods"
              :key="period"
              class="bg-surface px-3 py-2 text-right font-medium text-text-secondary"
            >
              {{ period }}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="metric in METRICS"
            :key="metric.label"
            class="border-t border-flat-weak hover:bg-flat-weak/40"
          >
            <td class="sticky left-0 z-[1] bg-surface px-3 py-1.5 text-text-secondary hover:bg-flat-weak/40">
              {{ metric.label }}<span class="text-text-tertiary">{{ metric.unit }}</span>
            </td>
            <td
              v-for="(row, index) in rows"
              :key="periods[index]"
              class="px-3 py-1.5 text-right tabular-nums"
              :class="metric.trend ? TREND_TEXT_CLASS[metric.trend(row)] : 'text-text'"
            >
              {{ metric.pick(row) }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <p v-if="dividendPlan" class="px-1 text-xs text-text-tertiary">
      最新分配预案：{{ dividendPlan }}
    </p>
  </div>
</template>

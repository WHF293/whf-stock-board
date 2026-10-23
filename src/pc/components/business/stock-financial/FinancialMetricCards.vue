<script setup lang="ts">
import { computed } from 'vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import { getTrendByChangePercent } from '../../../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../../../common/constants/stock-colors.constants.ts';
import { formatPercent, formatPercentUnsigned } from '../../../../common/utils/format-percent';
import { formatYuan } from '../../../../common/utils/format-yuan';
import type { FinancialSummaryRow } from '../../../../common/types/financial.types.ts';

/**
 * 财务指标卡行（详情页财务 Tab 首屏）：最新报告期的营收 / 归母净利 / EPS / ROE / 毛利率速读
 *
 * 同比正负复用全站 up/down 语义色（随 data-trend 主题自动换色）；卡片头部标注报告期
 */
const props = defineProps<{
  /** 财务摘要行（报告期倒序，取首行为最新期） */
  rows: FinancialSummaryRow[];
  /** 是否加载中（首次无数据时展示骨架） */
  loading: boolean;
}>();

/** 最新一期摘要行 */
const latest = computed(() => props.rows[0] ?? null);

/** 报告期短标签（「2026-06-30」→「2026 中报」形态交由 dataType；兜底用原日期） */
const periodLabel = computed(() => latest.value?.dataType ?? latest.value?.reportDate ?? '');

/**
 * 指标卡定义（值 / 副文案 / 副文案语义色统一在此收口）
 */
const cards = computed(() => {
  const row = latest.value;
  if (!row) return [];
  return [
    {
      label: '营业总收入',
      value: row.totalOperateIncome === null ? '--' : formatYuan(row.totalOperateIncome),
      sub: row.revenueYoY === null ? '' : formatPercent(row.revenueYoY),
      subTrend: getTrendByChangePercent(row.revenueYoY ?? 0),
    },
    {
      label: '归母净利润',
      value: row.parentNetprofit === null ? '--' : formatYuan(row.parentNetprofit),
      sub: row.profitYoY === null ? '' : formatPercent(row.profitYoY),
      subTrend: getTrendByChangePercent(row.profitYoY ?? 0),
    },
    {
      label: '基本每股收益',
      value: row.basicEps === null ? '--' : `${row.basicEps.toFixed(4)}元`,
      sub: row.deductBasicEps === null ? '' : `扣非 ${row.deductBasicEps.toFixed(4)}元`,
      subTrend: null,
    },
    {
      label: '加权平均 ROE',
      value:
        row.weightedAvgRoe === null ? '--' : formatPercentUnsigned(row.weightedAvgRoe),
      sub: row.bps === null ? '' : `每股净资产 ${row.bps.toFixed(2)}元`,
      subTrend: null,
    },
    {
      label: '销售毛利率',
      value: row.grossMargin === null ? '--' : formatPercentUnsigned(row.grossMargin),
      sub:
        row.operatingCashFlowPerShare === null
          ? ''
          : `每股经营现金流 ${row.operatingCashFlowPerShare.toFixed(2)}元`,
      subTrend: null,
    },
  ];
});
</script>

<template>
  <BaseSkeleton v-if="loading && cards.length === 0" />
  <div v-else-if="latest" class="space-y-2 px-2 pt-2">
    <div class="flex items-baseline gap-2">
      <span class="text-xs font-medium text-text-secondary">最新报告期</span>
      <span class="text-xs text-text-tertiary">{{ periodLabel }}</span>
    </div>
    <div class="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2.5">
      <div
        v-for="card in cards"
        :key="card.label"
        class="rounded-lg border border-flat-weak px-3 py-2.5"
      >
        <small class="block text-xs text-text-tertiary">{{ card.label }}</small>
        <b class="mt-1 block text-lg font-bold tracking-tight text-text tabular-nums">
          {{ card.value }}
        </b>
        <span
          v-if="card.sub"
          class="mt-0.5 block text-xs tabular-nums"
          :class="card.subTrend ? TREND_TEXT_CLASS[card.subTrend] : 'text-text-tertiary'"
        >
          {{ card.sub }}
        </span>
      </div>
    </div>
  </div>
</template>

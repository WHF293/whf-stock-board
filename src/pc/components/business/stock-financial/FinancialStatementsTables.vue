<script setup lang="ts">
import { computed } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseButton from '../../ui/BaseButton.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import { getTrendByChangePercent } from '../../../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../../../common/constants/stock-colors.constants.ts';
import {
  FINANCIAL_DEBT_EXEMPT_INDUSTRIES,
  FINANCIAL_DEBT_RATIO_WARN,
} from '../../../../common/constants/financial.constants.ts';
import { formatYiValue } from '../../../../common/utils/format-yi-value';
import type {
  BalanceSheetRow,
  CashFlowRow,
  FinancialSummaryRow,
} from '../../../../common/types/financial.types.ts';

/**
 * 资产负债 + 现金流两栏科目表（详情页财务 Tab）
 *
 * 列与财务摘要的报告期对齐（同批报告期竖向扫读不跳列，某表缺席该期整列 '--'）；
 * 资产负债率超阈值加弱色底提示（金融行业豁免，阈值与豁免清单见 financial.constants.ts）；
 * 现金流净额正负沿用 up/down 方向语义色
 */
const props = defineProps<{
  /** 财务摘要行（提供对齐用的报告期集合 + 行业名） */
  summaryRows: FinancialSummaryRow[];
  /** 资产负债行（报告期倒序） */
  balanceRows: BalanceSheetRow[];
  /** 现金流行（报告期倒序） */
  cashflowRows: CashFlowRow[];
  /** 资产负债表加载中 */
  balanceLoading: boolean;
  /** 现金流量表加载中 */
  cashflowLoading: boolean;
  /** 资产负债表错误文案 */
  balanceError: string | null;
  /** 现金流量表错误文案 */
  cashflowError: string | null;
}>();

const emit = defineEmits<{
  /** 点击重试：key 为失败的报表（balance / cashflow） */
  (e: 'retry', key: 'balance' | 'cashflow'): void;
}>();

/**
 * 行内按报告期建索引（对齐摘要列：摘要缺席的期不展示，摘要有的期本表缺席补 '--'）
 * @param rows 报表行（报告期倒序）
 * @returns 报告期 -> 行 的索引 Map
 */
const rowIndexByDate = <T extends { reportDate: string }>(rows: T[]): Map<string, T> =>
  new Map(rows.map((row) => [row.reportDate, row]));

/** 报告期列（取财务摘要的报告期倒序，三表共用同一批列） */
const periods = computed(() => props.summaryRows.map((row) => row.reportDate));

/** 资产负债行按报告期索引 */
const balanceByDate = computed(() => rowIndexByDate(props.balanceRows));

/** 现金流行按报告期索引 */
const cashflowByDate = computed(() => rowIndexByDate(props.cashflowRows));

/** 行业名（最新摘要行的东财板块名，用于负债率豁免判定） */
const industry = computed(() => props.summaryRows[0]?.industry ?? '');

/**
 * 行业是否在负债率提示豁免清单内（关键词子串匹配，如「证券Ⅱ」命中「证券」）
 */
const isDebtExempt = computed(() =>
  FINANCIAL_DEBT_EXEMPT_INDUSTRIES.some((keyword) => industry.value.includes(keyword)),
);

/**
 * 资产负债率单元格是否加弱色底：超阈值且行业未豁免
 * @param ratio 资产负债率（%）
 * @returns 是否命中提示
 */
const isDebtWarn = (ratio: number | null): boolean =>
  ratio !== null && ratio > FINANCIAL_DEBT_RATIO_WARN && !isDebtExempt.value;

/** 资产负债表行定义（label + 取值） */
const BALANCE_METRICS: readonly { label: string; pick: (row: BalanceSheetRow) => string }[] = [
  { label: '总资产（亿）', pick: (row) => formatYiValue(row.totalAssets) },
  { label: '总负债（亿）', pick: (row) => formatYiValue(row.totalLiabilities) },
  { label: '股东权益（亿）', pick: (row) => formatYiValue(row.totalEquity) },
  { label: '资产负债率（%）', pick: (row) => (row.debtAssetRatio === null ? '--' : row.debtAssetRatio.toFixed(2)) },
];

/** 现金流量表行定义（正负上方向色） */
const CASHFLOW_METRICS: readonly {
  label: string;
  pick: (row: CashFlowRow) => string;
  trend: (row: CashFlowRow) => 'up' | 'down' | 'flat';
}[] = [
  {
    label: '经营活动净额（亿）',
    pick: (row) => formatYiValue(row.operatingNetCash),
    trend: (row) => getTrendByChangePercent(row.operatingNetCash ?? 0),
  },
  {
    label: '投资活动净额（亿）',
    pick: (row) => formatYiValue(row.investingNetCash),
    trend: (row) => getTrendByChangePercent(row.investingNetCash ?? 0),
  },
  {
    label: '筹资活动净额（亿）',
    pick: (row) => formatYiValue(row.financingNetCash),
    trend: (row) => getTrendByChangePercent(row.financingNetCash ?? 0),
  },
  {
    label: '现金净增加额（亿）',
    pick: (row) => formatYiValue(row.netCashIncrease),
    trend: (row) => getTrendByChangePercent(row.netCashIncrease ?? 0),
  },
];
</script>

<template>
  <div class="grid gap-3 px-2 xl:grid-cols-2">
    <!-- 资产负债 -->
    <div class="space-y-1.5">
      <span class="text-sm font-semibold text-text">资产负债</span>
      <BaseSkeleton v-if="balanceLoading && balanceRows.length === 0" />
      <div v-else-if="balanceError" class="flex flex-col items-center gap-2 py-6">
        <BaseEmpty :text="`资产负债表加载失败：${balanceError}`" />
        <BaseButton variant="ghost" @click="emit('retry', 'balance')">
          <MenuIcon name="refresh" :size="14" />
          重试
        </BaseButton>
      </div>
      <BaseEmpty v-else-if="balanceRows.length === 0" text="未取到资产负债数据" />
      <div v-else class="table-scroll-xs rounded-lg border border-flat-weak">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th class="sticky left-0 z-[2] bg-surface px-3 py-2 text-left font-medium text-text-secondary">
                科目
              </th>
              <th
                v-for="period in periods"
                :key="period"
                class="bg-surface px-2.5 py-2 text-right font-medium text-text-secondary"
              >
                {{ period }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="metric in BALANCE_METRICS"
              :key="metric.label"
              class="border-t border-flat-weak hover:bg-flat-weak/40"
            >
              <td class="sticky left-0 z-[1] bg-surface px-3 py-1.5 text-text-secondary hover:bg-flat-weak/40">
                {{ metric.label }}
              </td>
              <td
                v-for="period in periods"
                :key="period"
                class="px-2.5 py-1.5 text-right tabular-nums"
                :class="
                  metric.label.includes('资产负债率') &&
                    isDebtWarn(balanceByDate.get(period)?.debtAssetRatio ?? null)
                    ? 'bg-up-weak text-up'
                    : 'text-text'
                "
              >
                {{ balanceByDate.has(period) ? metric.pick(balanceByDate.get(period)!) : '--' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!balanceError && balanceRows.length > 0" class="px-1 text-xs text-text-tertiary">
        负债率高于 {{ FINANCIAL_DEBT_RATIO_WARN }}% 加底色提示（金融行业豁免），
        仅为视觉提示、不构成风险判定
      </p>
    </div>

    <!-- 现金流量 -->
    <div class="space-y-1.5">
      <span class="text-sm font-semibold text-text">现金流量</span>
      <BaseSkeleton v-if="cashflowLoading && cashflowRows.length === 0" />
      <div v-else-if="cashflowError" class="flex flex-col items-center gap-2 py-6">
        <BaseEmpty :text="`现金流量表加载失败：${cashflowError}`" />
        <BaseButton variant="ghost" @click="emit('retry', 'cashflow')">
          <MenuIcon name="refresh" :size="14" />
          重试
        </BaseButton>
      </div>
      <BaseEmpty v-else-if="cashflowRows.length === 0" text="未取到现金流量数据" />
      <div v-else class="table-scroll-xs rounded-lg border border-flat-weak">
        <table class="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th class="sticky left-0 z-[2] bg-surface px-3 py-2 text-left font-medium text-text-secondary">
                科目
              </th>
              <th
                v-for="period in periods"
                :key="period"
                class="bg-surface px-2.5 py-2 text-right font-medium text-text-secondary"
              >
                {{ period }}
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="metric in CASHFLOW_METRICS"
              :key="metric.label"
              class="border-t border-flat-weak hover:bg-flat-weak/40"
            >
              <td class="sticky left-0 z-[1] bg-surface px-3 py-1.5 text-text-secondary hover:bg-flat-weak/40">
                {{ metric.label }}
              </td>
              <td
                v-for="period in periods"
                :key="period"
                class="px-2.5 py-1.5 text-right tabular-nums"
                :class="
                  cashflowByDate.has(period)
                    ? TREND_TEXT_CLASS[metric.trend(cashflowByDate.get(period)!)]
                    : 'text-text-tertiary'
                "
              >
                {{ cashflowByDate.has(period) ? metric.pick(cashflowByDate.get(period)!) : '--' }}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="px-1 text-xs text-text-tertiary">净额正负用涨跌方向色表示方向，不代表好坏判断</p>
    </div>
  </div>
</template>

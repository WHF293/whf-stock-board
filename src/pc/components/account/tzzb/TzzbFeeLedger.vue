<script setup lang="ts">
import { computed } from 'vue';
import BaseChart from '../../charts/BaseChart.vue';
import type { EChartsCoreOption } from 'echarts/core';
import { CHART_SPLIT_LINE_COLOR, CHART_TEXT_COLOR } from '../../../../common/constants/chart.constants.ts';
import { DOWN_COLOR } from '../../../../common/constants/stock-colors.constants.ts';
import { summarizeTradeFees } from '../../../../common/utils/summarize-trade-fees';
import type { TzzbStockTrade } from '../../../../common/types/tzzb.types.ts';

/**
 * 投资账本 · 交易摩擦账本卡（阶段 1，纯本地流水汇总，无外部请求）
 *
 * 口径见 .ai/开发方案/2026-11-02-前端-账户操作复盘与行为分析开发方案.md §4.1：
 * - 印花税上游无独立字段，按 feeTotal − commission − transferFee 差值推断（角标「推断」）；
 * - 换手率 = Σ成交额 ÷ 区间平均总资产（缺 pnl 数据时隐藏该行）；
 * - 费用拖累比 = 总费用 ÷ max(|区间已实现盈亏|, 总费用)。
 * 统计窗口与交易记录一致（queryMoneyHistory 默认近三个月）；全局区间联动随联动条阶段接入。
 */
const props = defineProps<{
  /** 全量股票流水（非单页）；null = 加载中 / 无数据 */
  trades: TzzbStockTrade[] | null;
  /** 区间平均总资产（换手率分母；null = 缺 pnl 数据） */
  avgTotalAsset: number | null;
  /** 区间已实现盈亏（已清仓回合 profit 合计；null = 无清仓记录） */
  realizedProfit: number | null;
}>();

/**
 * 千分位金额
 * @param v 数值
 * @returns 千分位两位小数文案
 */
const yuan = (v: number): string =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * 百分数文案（小数口径 → 「17.2%」）
 * @param v 小数口径比率
 * @returns 百分数文案
 */
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`;

/** 摩擦账本汇总（空流水返回 null，走空态） */
const summary = computed(() => {
  const trades = props.trades;
  if (!trades || trades.length === 0) return null;
  return summarizeTradeFees(trades, {
    avgTotalAsset: props.avgTotalAsset,
    realizedProfit: props.realizedProfit,
  });
});

/** 费用拆项行（通用展示模型） */
interface FeeRow {
  label: string;
  value: number;
  /** 印花税为推断口径，需角标 */
  inferred?: boolean;
}

/** 费用拆项（总费用为 0 时也展示，数值全 0 合法） */
const feeRows = computed<FeeRow[]>(() => {
  const s = summary.value;
  if (!s) return [];
  return [
    { label: '佣金', value: s.commission },
    { label: '印花税', value: s.stampDuty, inferred: true },
    { label: '过户费', value: s.transferFee },
    { label: '成交额合计', value: s.turnoverAmount },
  ];
});

/** 费用最高月（模板化结论文案用；单月数据也有值） */
const peakMonth = computed(() => {
  const monthly = summary.value?.monthly ?? [];
  if (monthly.length === 0) return null;
  return monthly.reduce((max, m) => (m.total > max.total ? m : max), monthly[0]);
});

/** 月度费用柱状图配置 */
const chartOptions = computed<EChartsCoreOption>(() => {
  const monthly = summary.value?.monthly ?? [];
  return {
    grid: { left: 8, right: 8, top: 18, bottom: 2, containLabel: true },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow' },
      valueFormatter: (v: unknown) => yuan(Number(v)),
    },
    xAxis: {
      type: 'category',
      data: monthly.map((m) => m.month.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: CHART_TEXT_COLOR,
        fontSize: 10,
        formatter: (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)),
      },
      splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
    },
    series: [
      {
        type: 'bar',
        data: monthly.map((m) => Number(m.total.toFixed(2))),
        barMaxWidth: 18,
        itemStyle: { color: DOWN_COLOR, borderRadius: [3, 3, 0, 0] },
      },
    ],
  };
});
</script>

<template>
  <div v-if="summary" class="flex flex-col gap-4 xl:flex-row xl:items-stretch">
    <!-- 左：费用总额 + 拆项 -->
    <div class="shrink-0 xl:w-56">
      <p class="text-xs text-text-secondary">区间费用合计（{{ summary.tradeCount }} 笔流水）</p>
      <p class="mt-1 text-2xl font-semibold tabular-nums text-down">-{{ yuan(summary.total) }}</p>
      <div class="mt-3">
        <div
          v-for="row in feeRows"
          :key="row.label"
          class="flex items-center justify-between border-b border-dashed border-flat-weak py-1.5 text-[13px] last:border-b-0"
        >
          <span class="text-text-secondary">
            {{ row.label }}
            <span v-if="row.inferred" class="ml-0.5 rounded bg-flat-weak px-1 text-[10px] text-text-tertiary">推断</span>
          </span>
          <span class="font-mono tabular-nums text-text">{{ yuan(row.value) }}</span>
        </div>
      </div>
    </div>

    <!-- 中：月度费用趋势 -->
    <div class="min-w-0 flex-1">
      <p class="mb-1 text-xs text-text-secondary">月度费用趋势</p>
      <div class="h-36 min-w-0">
        <BaseChart :options="chartOptions" not-merge />
      </div>
    </div>

    <!-- 右：比率 + 模板化结论 -->
    <div class="shrink-0 xl:w-72">
      <p class="mb-1 text-xs text-text-secondary">摩擦强度</p>
      <div
        class="flex items-center justify-between border-b border-dashed border-flat-weak py-1.5 text-[13px]"
      >
        <span class="text-text-secondary">费用拖累比（费用 / |已实现盈亏|）</span>
        <span class="font-mono font-medium tabular-nums text-up">
          {{ summary.dragRatio === null ? '—' : pct(summary.dragRatio) }}
        </span>
      </div>
      <div class="flex items-center justify-between py-1.5 text-[13px]">
        <span class="text-text-secondary">区间换手率（成交额 / 平均总资产）</span>
        <span class="font-mono font-medium tabular-nums text-text">
          {{ summary.turnoverRate === null ? '—' : `${(summary.turnoverRate * 100).toFixed(0)}%` }}
        </span>
      </div>
      <div class="mt-2 rounded-lg bg-flat-weak px-3 py-2 text-xs leading-5 text-text-secondary">
        <template v-if="peakMonth">
          每实现 100 元盈亏，约有
          {{ summary.dragRatio === null ? '—' : (summary.dragRatio * 100).toFixed(1) }}
          元用于交易摩擦；{{ peakMonth.month.replace('-', ' 年 ') }} 月费用最高（{{
            yuan(peakMonth.total)
          }}），对应当月成交最密集。
        </template>
        <template v-else>流水无有效成交日期，无法生成月度结论。</template>
      </div>
    </div>
  </div>

  <div v-else class="flex flex-col items-center gap-2 py-6 text-text-tertiary">
    <p class="text-sm">暂无交易流水：同步投资账本后自动生成摩擦账本</p>
  </div>
</template>

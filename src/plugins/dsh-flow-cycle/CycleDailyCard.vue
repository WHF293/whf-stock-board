<script setup lang="ts">
import { computed } from 'vue';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { YUAN_PER_YI } from '../../constants/format.constants';
import { formatYuanWithSign } from '../../utils/format-yuan';
import { formatPercent } from '../../utils/format-percent';
import {
  FLOW_CYCLE_BAR_TITLE,
  FLOW_CYCLE_COMPLETE_LABEL,
  FLOW_CYCLE_PARTIAL_LABEL,
} from './constants';
import type { FlowCycleBoard } from './types';

/**
 * 资金周期·逐日明细卡（参考 coooapi CycleDailyFlowCard 的纯 CSS 双向条形实现）：
 * 每交易日一行，净流入条从中线向左、净流出条向右，长度按卡片内最大绝对值归一
 * （中线两侧各 48%，下限 2%）；行 hover 用原生 title 展示数值
 */
const { board } = defineProps<{
  /** 板块周期数据（history 已对齐基准交易日轴，缺日 null） */
  board: FlowCycleBoard;
}>();

/** 卡片内最大绝对值（条长归一基准；全空时兜底 1 防除零） */
const cardMaxAbs = computed(() =>
  Math.max(1, ...board.history.map((row) => Math.abs(row.net ?? 0))),
);

/** 区间净额（亿，带符号展示用） */
const netSumYi = computed(() => (board.netSum / YUAN_PER_YI).toFixed(2));

/**
 * 单行条宽百分比（净流入/流出各占中线一侧，区间 [2, 48]%）
 * @param net 当日净流入（null 为缺日）
 * @returns CSS width 值（缺日 / 零值返回 0%）
 */
const barWidthOf = (net: number | null): string => {
  if (net === null || net === 0) {
    return '0%';
  }
  const pct = Math.max(2, Math.min(48, (Math.abs(net) / cardMaxAbs.value) * 48));
  return `${pct}%`;
};

/**
 * 单行原生 tooltip 文案
 * @param row 单日行
 * @param row.date 交易日（YYYY-MM-DD）
 * @param row.net 当日净流入（元，null 为缺日）
 * @returns tooltip 文本（缺日返回「无数据」）
 */
const rowTitleOf = (row: { date: string; net: number | null }): string => {
  if (row.net === null) {
    return `${row.date} 无数据`;
  }
  return FLOW_CYCLE_BAR_TITLE.replace('{date}', row.date).replace(
    '{net}',
    formatYuanWithSign(row.net),
  );
};

/**
 * 日期短标签（MM-DD）
 * @param date 交易日（YYYY-MM-DD）
 * @returns MM-DD 形态
 */
const dateLabelOf = (date: string): string => date.slice(5);
</script>

<template>
  <section class="rounded-card bg-surface p-3 shadow-card">
    <header class="mb-2 flex items-center justify-between gap-2">
      <h3 class="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-text">
        <span class="truncate">{{ board.name }}</span>
        <span
          v-if="board.changePercent !== null"
          class="shrink-0 text-xs font-medium"
          :class="TREND_TEXT_CLASS[getTrendByChangePercent(board.changePercent)]"
        >
          {{ formatPercent(board.changePercent) }}
        </span>
        <span
          v-if="board.completeness === 'partial'"
          class="shrink-0 rounded-full bg-flat-weak px-1.5 py-0.5 text-[10px] text-text-tertiary"
        >
          {{ FLOW_CYCLE_PARTIAL_LABEL }}
        </span>
        <span v-else class="sr-only">{{ FLOW_CYCLE_COMPLETE_LABEL }}</span>
      </h3>
      <span
        class="shrink-0 text-sm font-semibold tabular-nums"
        :class="board.netSum >= 0 ? 'text-up' : 'text-down'"
      >
        {{ board.netSum >= 0 ? '+' : '' }}{{ netSumYi }}亿
      </span>
    </header>

    <div class="flex flex-col gap-1">
      <div
        v-for="row in board.history"
        :key="row.date"
        class="flex items-center gap-1.5"
        :title="rowTitleOf(row)"
      >
        <span class="w-9 shrink-0 text-right text-[10px] tabular-nums text-text-tertiary">
          {{ dateLabelOf(row.date) }}
        </span>
        <div class="relative h-2.5 min-w-0 flex-1">
          <!-- 中线（零轴） -->
          <div class="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-flat-strong"></div>
          <!-- 净流入：中线向左 -->
          <div
            v-if="(row.net ?? 0) > 0"
            class="absolute inset-y-0 right-1/2 rounded-l-sm bg-up"
            :style="{ width: barWidthOf(row.net) }"
          ></div>
          <!-- 净流出：中线向右 -->
          <div
            v-else-if="(row.net ?? 0) < 0"
            class="absolute inset-y-0 left-1/2 rounded-r-sm bg-down"
            :style="{ width: barWidthOf(row.net) }"
          ></div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { YUAN_PER_YI } from '../../constants/format.constants';
import { formatYuanWithSign } from '../../utils/format-yuan';
import type { SectorFlowHistoryEntry } from '../../api/sector-flow-history.api';

/**
 * 板块历史净流入 · 逐日双向条形卡（参考 coooapi 逐日明细卡的纯 CSS 实现）：
 * 每交易日一行，净流入条从中线向左、净流出条向右，长度按卡片内最大绝对值归一
 * （中线两侧各 48%，下限 2%）；行 hover 用原生 title 展示数值
 */
const { code, name, points } = defineProps<{
  /** 板块代码（BK 编号） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 逐日主力净流入（日期升序） */
  points: SectorFlowHistoryEntry['points'];
}>();

/** 卡片内最大绝对值（条长归一基准；全空时兜底 1 防除零） */
const cardMaxAbs = computed(() => Math.max(1, ...points.map((row) => Math.abs(row.net))));

/** 历史累计净额（元） */
const netSum = computed(() => points.reduce((sum, row) => sum + row.net, 0));

/** 历史累计净额（亿，带符号展示用） */
const netSumText = computed(() => {
  const value = (netSum.value / YUAN_PER_YI).toFixed(2);
  return netSum.value >= 0 ? `+${value}` : value;
});

/**
 * 单行条宽百分比（净流入/流出各占中线一侧，区间 [2, 48]%）
 * @param net 当日净流入（元）
 * @returns CSS width 值（零值返回 0%）
 */
const barWidthOf = (net: number): string => {
  if (net === 0) {
    return '0%';
  }
  const pct = Math.max(2, Math.min(48, (Math.abs(net) / cardMaxAbs.value) * 48));
  return `${pct}%`;
};

/**
 * 单行原生 tooltip 文案
 * @param row 单日行
 * @param row.date 交易日（YYYY-MM-DD）
 * @param row.net 当日净流入（元）
 * @returns tooltip 文本
 */
const rowTitleOf = (row: { date: string; net: number }): string =>
  `${row.date} 主力净流入 ${formatYuanWithSign(row.net)}`;

/**
 * 日期短标签（MM-DD）
 * @param date 交易日（YYYY-MM-DD）
 * @returns MM-DD 形态
 */
const dateLabelOf = (date: string): string => date.slice(5);
</script>

<template>
  <section class="rounded-card bg-surface p-3 shadow-card" :data-board-code="code">
    <header class="mb-2 flex items-center justify-between gap-2">
      <h3 class="min-w-0 truncate text-sm font-semibold text-text" :title="name">{{ name }}</h3>
      <span
        class="shrink-0 text-sm font-semibold tabular-nums"
        :class="netSum >= 0 ? 'text-up' : 'text-down'"
        title="历史累计主力净流入"
      >
        {{ netSumText }}亿
      </span>
    </header>

    <div class="flex max-h-96 flex-col gap-1 overflow-y-auto">
      <div
        v-for="row in points"
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
            v-if="row.net > 0"
            class="absolute inset-y-0 right-1/2 rounded-l-sm bg-up"
            :style="{ width: barWidthOf(row.net) }"
          ></div>
          <!-- 净流出：中线向右 -->
          <div
            v-else-if="row.net < 0"
            class="absolute inset-y-0 left-1/2 rounded-r-sm bg-down"
            :style="{ width: barWidthOf(row.net) }"
          ></div>
        </div>
      </div>
    </div>
  </section>
</template>

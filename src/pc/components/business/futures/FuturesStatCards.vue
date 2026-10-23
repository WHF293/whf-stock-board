<script setup lang="ts">
/** 指标卡数据（展示形态由父级组装，本组件只管渲染） */
export interface FuturesStatCard {
  /** 指标名 */
  label: string;
  /** 主数值（已格式化文案） */
  value: string;
  /** 数值语义色类（text-up / text-down / text-flat / 空 = 常规文字） */
  valueClass?: string;
  /** 副文案（增减 / 说明） */
  sub?: string;
  /** 副文案语义色类 */
  subClass?: string;
}

/**
 * 机构行为页 · 概览指标卡行
 *
 * 单合约 / 同品种合并 / 全股指合并三种口径下的第一行指标，
 * 卡片栅格 auto-fill 等宽（设计规范 quote-card-grid 同思路的简化版）。
 */
defineProps<{
  /** 指标卡列表 */
  cards: readonly FuturesStatCard[];
}>();
</script>

<template>
  <div class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
    <div
      v-for="card in cards"
      :key="card.label"
      class="rounded-card bg-surface p-3 shadow-card"
    >
      <div class="text-xs font-semibold text-text-tertiary">{{ card.label }}</div>
      <div class="mt-1 text-lg font-bold tabular-nums" :class="card.valueClass ?? 'text-text'">
        {{ card.value }}
      </div>
      <div
        v-if="card.sub"
        class="mt-0.5 text-xs tabular-nums"
        :class="card.subClass ?? 'text-text-tertiary'"
      >
        {{ card.sub }}
      </div>
    </div>
  </div>
</template>

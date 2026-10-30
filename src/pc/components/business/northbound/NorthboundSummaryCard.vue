<script setup lang="ts">
import { computed } from 'vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import { formatNorthboundAmount } from '../../../../common/utils/format-northbound-amount.ts';
import type { NorthboundFlowSummary } from '../../../../common/types/northbound.types.ts';

/**
 * 南向资金汇总卡（资金流向页行 3 左）
 *
 * 两通道行式表格（港股通沪 / 港股通深）：净买额 + 涨跌家数比例条 + 相关指数涨跌幅；
 * 上游口径：summary 金额单位为万元；当日余额字段已停披露（恒 0）故不展示。
 * 北向每日净买额停披露且无公开替代来源，页面不展示北向行（上游 summary 仍返回四通道，
 * 组件只渲染 direction 为「南向」的行）。
 * 数据由资金流向页单节拍轮询传入，本卡只做展示 + 转发刷新意图
 */

const { summary, loading = false } = defineProps<{
  /** 四通道汇总行（沪股通 / 港股通沪 / 深股通 / 港股通深；仅渲染南向行） */
  summary: NorthboundFlowSummary[];
  /** 是否首载（骨架屏） */
  loading?: boolean;
}>();

const emit = defineEmits<{
  /** 手动刷新（由页面统一执行 summary + minute 双请求） */
  refresh: [];
}>();

/** 展示行（仅南向两通道；北向净买额停披露且无公开替代来源，不展示） */
const rows = computed(() => summary.filter((row) => row.direction === '南向'));

/**
 * 涨跌家数比例条的上涨占比（0-100，无家数时 0）
 * @param row 汇总行
 * @returns 上涨占比百分数
 */
const upRatio = (row: NorthboundFlowSummary): number => {
  const total = (row.upCount ?? 0) + (row.flatCount ?? 0) + (row.downCount ?? 0);
  if (total === 0) return 0;
  return Math.round(((row.upCount ?? 0) / total) * 100);
};

/**
 * 涨跌家数比例条的下跌占比（0-100，无家数时 0；平家数由底色呈现）
 * @param row 汇总行
 * @returns 下跌占比百分数
 */
const downRatio = (row: NorthboundFlowSummary): number => {
  const total = (row.upCount ?? 0) + (row.flatCount ?? 0) + (row.downCount ?? 0);
  if (total === 0) return 0;
  return Math.round(((row.downCount ?? 0) / total) * 100);
};
</script>

<template>
  <BaseCard title="南向资金汇总">
    <template #extra>
      <button
        type="button"
        class="pressable rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-flat-weak hover:text-primary"
        @click="emit('refresh')"
      >
        刷新
      </button>
    </template>

    <BaseSkeleton v-if="loading" class="h-[196px]" />
    <template v-else>
      <div class="overflow-x-auto">
        <table class="w-full min-w-[560px] whitespace-nowrap text-xs">
          <thead>
            <tr class="border-b border-flat-weak text-left text-text-tertiary">
              <th class="py-1.5 pr-3 font-normal">通道</th>
              <th class="py-1.5 pr-3 text-right font-normal">净买额</th>
              <th class="py-1.5 pr-3 font-normal">涨跌家数</th>
              <th class="py-1.5 text-right font-normal">相关指数</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in rows"
              :key="row.type"
              class="border-b border-flat-weak/60 last:border-0"
            >
              <td class="py-1.5 pr-3">
                <span class="font-medium text-text">{{ row.boardName }}</span>
                <span class="ml-1.5 rounded bg-flat-weak px-1 py-0.5 text-[10px] text-flat">{{ row.direction }}</span>
              </td>
              <td class="py-1.5 pr-3 text-right num font-medium text-text">
                {{ formatNorthboundAmount({ value: row.netBuyAmount, source: 'wan' }) }}
              </td>
              <td class="py-1.5 pr-3">
                <div class="flex items-center gap-2">
                  <div class="flex h-1.5 w-20 overflow-hidden rounded-full bg-flat-weak">
                    <div class="h-full bg-up" :style="{ width: `${upRatio(row)}%` }" />
                    <div class="h-full bg-down" :style="{ width: `${downRatio(row)}%` }" />
                  </div>
                  <span class="text-[10px] text-text-tertiary num">
                    {{ row.upCount ?? '--' }}/{{ row.flatCount ?? '--' }}/{{ row.downCount ?? '--' }}
                  </span>
                </div>
              </td>
              <td class="py-1.5 text-right">
                <span class="text-text-tertiary">{{ row.indexName }}</span>
                <span
                  class="ml-1.5 num font-medium"
                  :class="(row.indexChangePercent ?? 0) > 0 ? 'text-up' : (row.indexChangePercent ?? 0) < 0 ? 'text-down' : 'text-flat'"
                >
                  {{ row.indexChangePercent === null ? '--' : `${row.indexChangePercent > 0 ? '+' : ''}${row.indexChangePercent.toFixed(2)}%` }}
                </span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseButton from '../../ui/BaseButton.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import { FINANCIAL_FORECAST_TONE } from '../../../../common/constants/financial.constants.ts';
import type { Trend } from '../../../../common/constants/trend.constants.ts';
import { formatPercent } from '../../../../common/utils/format-percent';
import { formatYuan } from '../../../../common/utils/format-yuan';
import type { ProfitForecastRow } from '../../../../common/types/financial.types.ts';

/**
 * 业绩预告卡列表（详情页财务 Tab）：公告日倒序最多 N 条
 *
 * 空态是常态（预告仅披露窗口内有行）：上游「查询成功但无数据」= 合法空，直接空态不报错；
 * 预告类型徽标色按 FINANCIAL_FORECAST_TONE 映射（预增系红 / 预减系绿 / 不确定灰）
 */
const props = defineProps<{
  /** 业绩预告行（公告日倒序） */
  rows: ProfitForecastRow[];
  /** 是否加载中 */
  loading: boolean;
  /** 错误文案（null = 无错误） */
  error: string | null;
}>();

const emit = defineEmits<{
  /** 点击重试：只重拉业绩预告表 */
  (e: 'retry'): void;
}>();

/**
 * 预告类型 → 徽标样式类（TREND_PILL 同款弱色底胶囊）
 * @param type 上游 PREDICT_TYPE 原文
 * @returns 胶囊类名
 */
const toneClass = (type: string | null): string => {
  const tone: Trend = (type && FINANCIAL_FORECAST_TONE[type]) || 'flat';
  if (tone === 'up') return 'bg-up-weak text-up';
  if (tone === 'down') return 'bg-down-weak text-down';
  return 'bg-flat-weak text-flat';
};

/**
 * 区间文案（下限 ~ 上限，缺一边只展示另一边）
 * @param lower 下限文案
 * @param upper 上限文案
 * @returns 区间文案（两端皆缺省为 '--'）
 */
const rangeText = (lower: string, upper: string): string => {
  if (lower === '--' && upper === '--') return '--';
  if (lower === '--') return upper;
  if (upper === '--') return lower;
  return `${lower} ~ ${upper}`;
};

/** 卡片渲染模型（金额亿 / 增幅带符号，区间缺值兜底） */
const cards = computed(() =>
  props.rows.map((row) => ({
    key: `${row.reportDate}-${row.metricName}-${row.noticeDate ?? ''}`,
    type: row.predictType,
    metricName: row.metricName || '净利润',
    amount: rangeText(
      row.amountLower === null ? '--' : formatYuan(row.amountLower),
      row.amountUpper === null ? '--' : formatYuan(row.amountUpper),
    ),
    growth: rangeText(
      row.growthLower === null ? '--' : formatPercent(row.growthLower),
      row.growthUpper === null ? '--' : formatPercent(row.growthUpper),
    ),
    priorYear:
      row.priorYearSamePeriod === null ? '--' : formatYuan(row.priorYearSamePeriod),
    reportDate: row.reportDate,
    noticeDate: row.noticeDate ?? '--',
    content: row.content,
  })),
);
</script>

<template>
  <BaseSkeleton v-if="loading && rows.length === 0" />
  <div v-else-if="error" class="flex flex-col items-center gap-2 py-6">
    <BaseEmpty :text="`业绩预告加载失败：${error}`" />
    <BaseButton variant="ghost" @click="emit('retry')">
      <MenuIcon name="refresh" :size="14" />
      重试
    </BaseButton>
  </div>
  <div v-else class="space-y-1.5 px-2">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-semibold text-text">业绩预告</span>
      <span class="text-xs text-text-tertiary">公告日倒序</span>
    </div>
    <BaseEmpty
      v-if="cards.length === 0"
      text="暂无业绩预告：预告通常在季报披露窗口前 15 日内集中发布，届时自动更新"
    />
    <div
      v-for="card in cards"
      :key="card.key"
      class="space-y-2 rounded-lg border border-flat-weak px-3.5 py-3"
    >
      <div class="flex items-center gap-2">
        <span
          class="rounded-full px-2 py-0.5 text-xs font-semibold"
          :class="toneClass(card.type)"
        >
          {{ card.type ?? '预告' }}
        </span>
        <b class="text-sm text-text">{{ card.metricName }}</b>
        <span class="ml-auto text-xs text-text-tertiary">
          报告期 {{ card.reportDate }} · 公告 {{ card.noticeDate }}
        </span>
      </div>
      <div class="grid grid-cols-3 gap-2.5">
        <div>
          <small class="block text-xs text-text-tertiary">预告区间</small>
          <b class="mt-0.5 block text-sm text-text tabular-nums">{{ card.amount }}</b>
        </div>
        <div>
          <small class="block text-xs text-text-tertiary">同比增幅</small>
          <b class="mt-0.5 block text-sm text-text tabular-nums">{{ card.growth }}</b>
        </div>
        <div>
          <small class="block text-xs text-text-tertiary">上年同期</small>
          <b class="mt-0.5 block text-sm text-text tabular-nums">{{ card.priorYear }}</b>
        </div>
      </div>
      <p
        v-if="card.content"
        class="border-t border-flat-weak pt-2 text-xs leading-relaxed text-text-secondary"
      >
        {{ card.content }}
      </p>
    </div>
  </div>
</template>

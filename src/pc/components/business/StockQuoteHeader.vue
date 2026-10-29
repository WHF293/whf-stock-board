<script setup lang="ts">
import { computed } from 'vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseButton from '../ui/BaseButton.vue';
import {
  TREND,
  getTrendByChangePercent,
} from '../../../common/constants/trend.constants.ts';
import type { Trend } from '../../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import { formatAmount } from '../../../common/utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../../common/utils/format-percent';
import { formatPrice } from '../../../common/utils/format-price';
import { formatVolume } from '../../../common/utils/format-volume';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';

/**
 * 个股报价头（参考投资账本侧栏排版）：
 *
 * - 2026-10-24 王总指定改版：名称/代码左对齐（原居中），右上角为高光按钮
 *   「查看更多」（点击进个股详情整页；自选增删由详情页顶栏承接，侧栏不再放）
 * - 下方：左侧现价大字 + 涨跌额/幅；右侧 3x3 紧凑指标网格
 *   （高 / 低 / 开 / 市值 / 流通 / 量 / 换 / 额 / 市盈——label 灰 + 值紧跟）
 * - stacked 模式（窄栏场景，如详情页右栏）：现价块与指标网格上下堆叠，
 *   指标网格占满整行宽度，避免格内长数值溢出重叠
 * - metricsOnly 模式（名称/代码/现价/涨跌由页面顶栏承载时用）：只渲染指标网格
 * - compact 模式（详情页右栏收起态，配合 metricsOnly，2026-10-24 王总指定改版）：
 *   全部 9 项指标**一行一条**单列展示（原高/低/开/收两列），label 左、值右
 */
const props = defineProps<{
  /** 完整报价；为 null 时展示骨架屏 */
  quote: FullQuote | null;
  /** 上下堆叠布局（窄栏用；默认横排，同侧栏面板） */
  stacked?: boolean;
  /** 仅指标模式：只渲染 3x3 指标网格 */
  metricsOnly?: boolean;
  /** 收起态紧凑指标：只渲染 高/低/开/收 四字段（需配合 metricsOnly） */
  compact?: boolean;
}>();

const emit = defineEmits<{
  /** 点击「查看更多」按钮：打开个股详情整页 */
  'open-detail': [];
}>();

const trend = computed(() => getTrendByChangePercent(props.quote?.changePercent ?? 0));
const flashKey = computed(() => props.quote?.timestamp ?? props.quote?.price ?? 0);
const flashClass = computed(() => {
  if (trend.value === TREND.UP) return 'animate-flash-up';
  if (trend.value === TREND.DOWN) return 'animate-flash-down';
  return '';
});

/** 紧凑指标条目（label + value + 可选趋势色） */
interface CompactMetric {
  label: string;
  value: string;
  tone?: Trend;
}

/** 3x3 紧凑指标 */
const metrics = computed<CompactMetric[]>(() => {
  const quote = props.quote;
  if (!quote) return [];
  return [
    { label: '高', value: formatPrice(quote.high), tone: getTrendByChangePercent((quote.high ?? 0) - quote.prevClose) },
    { label: '低', value: formatPrice(quote.low), tone: getTrendByChangePercent((quote.low ?? 0) - quote.prevClose) },
    { label: '开', value: formatPrice(quote.open) },
    { label: '市值', value: quote.totalMarketCap === null ? '--' : `${formatPrice(quote.totalMarketCap)}亿` },
    { label: '流通', value: quote.circulatingMarketCap === null ? '--' : `${formatPrice(quote.circulatingMarketCap)}亿` },
    { label: '量', value: formatVolume(quote.volume) },
    { label: '换', value: formatPercentUnsigned(quote.turnoverRate) },
    { label: '额', value: formatAmount(quote.amount) },
    { label: '市盈', value: quote.pe === null ? '--' : formatPrice(quote.pe) },
  ];
});

/**
 * 收起态紧凑指标：2026-10-24 起收起态展示全部 9 项指标（一行一条），
 * 与完整态同用 metrics，不再裁剪为 高/低/开/收
 */
</script>

<template>
  <BaseSkeleton v-if="!quote" />
  <!-- 仅指标模式：完整态 3 列指标网格 / 收起态（compact）全部指标单列一行一条 -->
  <dl
    v-else-if="metricsOnly"
    class="grid w-full gap-x-2 gap-y-1 text-[10px]"
    :class="compact ? 'grid-cols-1 gap-y-0.5' : 'grid-cols-3'"
  >
    <div
      v-for="metric in metrics"
      :key="metric.label"
      class="flex min-w-0 items-center gap-1 tabular-nums"
      :class="compact ? 'justify-between' : 'justify-end'"
    >
      <span class="shrink-0 text-text-tertiary">{{ metric.label }}</span>
      <span
        class="truncate text-text"
        :class="metric.tone ? TREND_TEXT_CLASS[metric.tone] : ''"
        :title="metric.value"
      >
        {{ metric.value }}
      </span>
    </div>
  </dl>
  <div v-else class="relative flex flex-col items-center gap-1">
    <!-- 名称（左对齐）+ 「查看更多」高光按钮（右上角，2026-10-24 王总指定：
         原自选按钮迁详情页顶栏，此处改为进详情整页的入口） -->
    <div class="flex w-full items-start justify-between gap-2">
      <div class="min-w-0">
        <p class="truncate text-sm font-semibold text-text">{{ quote.name }}</p>
        <p class="mt-0.5 text-xs text-text-tertiary">{{ quote.code }}</p>
      </div>
      <BaseButton variant="primary" class="shrink-0" @click="emit('open-detail')">
        查看更多
      </BaseButton>
    </div>

    <!-- 现价 + 涨跌 / 指标网格（stacked 时上下堆叠） -->
    <div
      class="flex w-full items-center gap-4"
      :class="stacked ? 'flex-col items-stretch gap-2' : ''"
    >
      <div :class="stacked ? '' : 'shrink-0'">
        <span
          :key="flashKey"
          class="block text-2xl font-semibold tabular-nums"
          :class="[TREND_TEXT_CLASS[trend], flashClass]"
        >
          {{ formatPrice(quote.price) }}
        </span>
        <div class="mt-0.5 flex items-center gap-2 text-xs tabular-nums" :class="TREND_TEXT_CLASS[trend]">
          <span>{{ quote.change > 0 ? '+' : '' }}{{ formatPrice(quote.change) }}</span>
          <span>{{ formatPercent(quote.changePercent) }}</span>
        </div>
      </div>

      <dl class="grid min-w-0 flex-1 grid-cols-3 gap-x-2 gap-y-1 text-[10px]">
        <div
          v-for="metric in metrics"
          :key="metric.label"
          class="flex min-w-0 items-center justify-end gap-1 tabular-nums"
        >
          <span class="shrink-0 text-text-tertiary">{{ metric.label }}</span>
          <span
            class="truncate text-text"
            :class="metric.tone ? TREND_TEXT_CLASS[metric.tone] : ''"
            :title="metric.value"
          >
            {{ metric.value }}
          </span>
        </div>
      </dl>
    </div>
  </div>
</template>

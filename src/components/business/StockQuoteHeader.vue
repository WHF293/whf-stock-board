<script setup lang="ts">
import { computed } from 'vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import {
  TREND,
  getTrendByChangePercent,
} from '../../constants/trend.constants';
import type { Trend } from '../../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatAmount } from '../../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { formatVolume } from '../../utils/format-volume';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 个股报价头：现价 / 涨跌 + 关键指标（五档盘口独立为 StockOrderBook 组件）
 */
const props = defineProps<{
  /** 完整报价；为 null 时展示骨架屏 */
  quote: FullQuote | null;
}>();

const trend = computed(() => getTrendByChangePercent(props.quote?.changePercent ?? 0));
const flashKey = computed(() => props.quote?.timestamp ?? props.quote?.price ?? 0);
const flashClass = computed(() => {
  if (trend.value === TREND.UP) return 'animate-flash-up';
  if (trend.value === TREND.DOWN) return 'animate-flash-down';
  return '';
});

/** 关键指标条目（tone 用于相对昨收的涨跌着色） */
interface HeaderMetric {
  label: string;
  value: string;
  tone?: Trend;
}

/** 关键指标（名称 + 值）列表 */
const metrics = computed<HeaderMetric[]>(() => {
  const quote = props.quote;
  if (!quote) return [];
  return [
    { label: '今开', value: formatPrice(quote.open) },
    { label: '昨收', value: formatPrice(quote.prevClose) },
    { label: '最高', value: formatPrice(quote.high), tone: getTrendByChangePercent((quote.high ?? 0) - quote.prevClose) },
    { label: '最低', value: formatPrice(quote.low), tone: getTrendByChangePercent((quote.low ?? 0) - quote.prevClose) },
    { label: '成交量', value: formatVolume(quote.volume) },
    { label: '成交额', value: formatAmount(quote.amount) },
    { label: '换手率', value: formatPercentUnsigned(quote.turnoverRate) },
    { label: '量比', value: formatPrice(quote.volumeRatio) },
    { label: '总市值', value: quote.totalMarketCap === null ? '--' : `${formatPrice(quote.totalMarketCap)}亿` },
  ];
});
</script>

<template>
  <BaseSkeleton v-if="!quote" />
  <!-- @container 容器查询：面板宽 <560px 纵向堆叠，≥560px 横排（视口断点在窄面板内会误判） -->
  <div v-else class="@container">
    <div class="flex flex-col gap-4 @[560px]:flex-row @[560px]:items-start">
    <!-- 价格区 -->
    <div class="w-48 shrink-0">
      <p class="text-sm font-medium text-text-secondary">{{ quote.name }}</p>
      <p class="mt-0.5 text-xs text-text-tertiary">{{ quote.code }}</p>
      <span
        :key="flashKey"
        class="mt-1 block text-3xl font-semibold tabular-nums"
        :class="[TREND_TEXT_CLASS[trend], flashClass]"
      >
        {{ formatPrice(quote.price) }}
      </span>
      <div class="mt-1 flex items-center gap-2 text-sm tabular-nums" :class="TREND_TEXT_CLASS[trend]">
        <span>{{ quote.change > 0 ? '+' : '' }}{{ formatPrice(quote.change) }}</span>
        <span
          class="rounded-full px-2 py-0.5 text-xs font-semibold"
          :class="TREND_PILL_CLASS[trend]"
        >
          {{ formatPercent(quote.changePercent) }}
        </span>
      </div>
    </div>

    <!-- 关键指标 -->
    <dl class="grid flex-1 grid-cols-2 gap-x-3 gap-y-2 self-center text-sm @[560px]:grid-cols-3">
      <div v-for="metric in metrics" :key="metric.label" class="flex items-baseline justify-between gap-1">
        <dt class="shrink-0 whitespace-nowrap text-xs text-text-tertiary">{{ metric.label }}</dt>
        <dd class="whitespace-nowrap tabular-nums text-text" :class="metric.tone ? TREND_TEXT_CLASS[metric.tone] : ''">
          {{ metric.value }}
        </dd>
      </div>
    </dl>
    </div>
  </div>
</template>

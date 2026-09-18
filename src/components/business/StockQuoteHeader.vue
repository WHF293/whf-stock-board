<script setup lang="ts">
import { computed } from 'vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import {
  TREND,
  getTrendByChangePercent,
} from '../../constants/trend.constants';
import type { Trend } from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatAmount } from '../../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { formatVolume } from '../../utils/format-volume';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 个股报价头（参考投资账本侧栏排版）：
 *
 * - 名称居中大字 + 代码居中小字；右上角自选按钮（未加 = 主色「+ 自选」，已加 = 红字「删自选」）
 * - 下方：左侧现价大字 + 涨跌额/幅；右侧 3x3 紧凑指标网格
 *   （高 / 低 / 开 / 市值 / 流通 / 量 / 换 / 额 / 市盈——label 灰 + 值紧跟）
 * - stacked 模式（窄栏场景，如详情页右栏）：现价块与指标网格上下堆叠，
 *   指标网格占满整行宽度，避免格内长数值溢出重叠
 * - metricsOnly 模式（名称/代码/现价/涨跌/自选按钮由页面顶栏承载时用）：只渲染指标网格
 * - compact 模式（详情页右栏收起态，配合 metricsOnly）：只渲染 高/低/开/收 四字段，
 *   两列排布（其余市值/流通等 5 项指标收起时不展示，为 K 线让宽度）
 */
const props = defineProps<{
  /** 完整报价；为 null 时展示骨架屏 */
  quote: FullQuote | null;
  /** 当前股票是否已加入自选（任一分组） */
  isInWatchlist?: boolean;
  /** 上下堆叠布局（窄栏用；默认横排，同侧栏面板） */
  stacked?: boolean;
  /** 仅指标模式：只渲染 3x3 指标网格 */
  metricsOnly?: boolean;
  /** 收起态紧凑指标：只渲染 高/低/开/收 四字段（需配合 metricsOnly） */
  compact?: boolean;
}>();

const emit = defineEmits<{
  /** 点击「+ 自选」按钮：弹窗选择分组 */
  'add-to-watchlist': [];
  /** 点击「删自选」按钮：弹窗选择删除范围 */
  'remove-from-watchlist': [];
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
 * 收起态紧凑指标（高 / 低 / 开 / 收）：收 = 现价；
 * 高 / 低沿用完整态的趋势色口径（相对昨收）
 */
const ohlcMetrics = computed<CompactMetric[]>(() => {
  const quote = props.quote;
  if (!quote) return [];
  return [
    { label: '高', value: formatPrice(quote.high), tone: getTrendByChangePercent((quote.high ?? 0) - quote.prevClose) },
    { label: '低', value: formatPrice(quote.low), tone: getTrendByChangePercent((quote.low ?? 0) - quote.prevClose) },
    { label: '开', value: formatPrice(quote.open) },
    { label: '收', value: formatPrice(quote.price) },
  ];
});
</script>

<template>
  <BaseSkeleton v-if="!quote" />
  <!-- 仅指标模式：完整态 3 列指标网格 / 收起态（compact）高/低/开/收 两列 -->
  <dl
    v-else-if="metricsOnly"
    class="grid w-full gap-x-2 gap-y-1 text-[10px]"
    :class="compact ? 'grid-cols-2' : 'grid-cols-3'"
  >
    <div
      v-for="metric in compact ? ohlcMetrics : metrics"
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
  <div v-else class="relative flex flex-col items-center gap-1">
    <!-- 名称 + 自选按钮（右上角） -->
    <div class="flex w-full items-center justify-center">
      <p class="truncate text-sm font-semibold text-text">{{ quote.name }}</p>
      <div class="absolute right-0 top-0">
        <button
          v-if="!isInWatchlist"
          type="button"
          class="pressable inline-flex items-center gap-1 rounded-full bg-primary-weak px-3 py-1 text-xs font-medium text-primary hover:opacity-80 active:scale-95"
          @click="emit('add-to-watchlist')"
        >
          <svg
            viewBox="0 0 24 24"
            class="h-3 w-3"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
          >
            <path d="M12 5v14M5 12h14" />
          </svg>
          加自选
        </button>
        <button
          v-else
          type="button"
          class="pressable inline-flex items-center gap-1 rounded-full bg-up-weak px-3 py-1 text-xs font-medium text-up hover:opacity-80 active:scale-95"
          @click="emit('remove-from-watchlist')"
        >
          删自选
        </button>
      </div>
    </div>
    <p class="text-xs text-text-tertiary">{{ quote.code }}</p>

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

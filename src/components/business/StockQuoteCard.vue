<script setup lang="ts">
import { computed } from 'vue';
import {
  TREND,
  getTrendByChangePercent,
} from '../../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatPercent } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 报价卡片：名称 + 现价 + 涨跌幅胶囊
 *
 * 现价以 timestamp 为 key，数据刷新时重放闪烁动画（红涨 / 绿跌弱色底）；
 * clickable 时整卡可点击（按压动效），由父组件决定跳转目标
 */
const props = withDefaults(
  defineProps<{
    /** 完整报价（指数 / 个股通用） */
    quote: FullQuote;
    /** 是否可点击（点击时 emit click） */
    clickable?: boolean;
  }>(),
  { clickable: false },
);

const emit = defineEmits<{
  /** 卡片被点击（仅 clickable 时触发） */
  click: [];
}>();

const trend = computed(() => getTrendByChangePercent(props.quote.changePercent));

/** 报价刷新触发闪烁动画的 key（时间戳缺失时退化为价格本身） */
const flashKey = computed(() => props.quote.timestamp ?? props.quote.price);

/** 价格闪烁动画类名（平盘不闪） */
const flashClass = computed(() => {
  if (trend.value === TREND.UP) return 'animate-flash-up';
  if (trend.value === TREND.DOWN) return 'animate-flash-down';
  return '';
});
</script>

<template>
  <component
    :is="clickable ? 'button' : 'div'"
    :type="clickable ? 'button' : undefined"
    class="block w-full rounded-card bg-surface p-4 text-left shadow-card"
    :class="clickable ? 'pressable active:scale-[0.98] hover:shadow-lg' : ''"
    @click="clickable && emit('click')"
  >
    <p class="text-sm font-medium text-text-secondary">{{ quote.name }}</p>
    <div class="mt-2 flex items-baseline justify-between gap-2">
      <span
        :key="flashKey"
        class="text-2xl font-semibold tabular-nums"
        :class="[TREND_TEXT_CLASS[trend], flashClass]"
      >
        {{ formatPrice(quote.price) }}
      </span>
      <span
        class="rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums"
        :class="TREND_PILL_CLASS[trend]"
      >
        {{ formatPercent(quote.changePercent) }}
      </span>
    </div>
  </component>
</template>

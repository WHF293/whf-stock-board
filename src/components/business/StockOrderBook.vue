<script setup lang="ts">
import { computed } from 'vue';
import {
  getTrendByChangePercent,
} from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatPrice } from '../../utils/format-price';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 五档盘口：卖五 -> 卖一 / 买一 -> 买五（价格相对昨收涨跌着色）
 */
const props = defineProps<{
  /** 完整报价（含五档数据）；为 null 时不渲染 */
  quote: FullQuote | null;
}>();

/** 卖盘（卖五 -> 卖一，自上而下展示） */
const askLevels = computed(() => [...(props.quote?.ask ?? [])].reverse());
/** 买盘（买一 -> 买五） */
const bidLevels = computed(() => props.quote?.bid ?? []);

/**
 * 盘口价格相对昨收的文本色
 * @param price 盘口档位价格
 * @returns 趋势文本色类名
 */
const levelToneClass = (price: number): string =>
  TREND_TEXT_CLASS[getTrendByChangePercent(price - (props.quote?.prevClose ?? price))];
</script>

<template>
  <div v-if="quote">
    <div class="grid grid-cols-3 gap-x-2 text-xs tabular-nums">
      <template v-for="level in askLevels" :key="`a${level.price}`">
        <span class="text-text-tertiary">卖{{ askLevels.length - askLevels.indexOf(level) }}</span>
        <span :class="levelToneClass(level.price)">{{ formatPrice(level.price) }}</span>
        <span class="text-right text-text-secondary">{{ level.volume }}</span>
      </template>
      <div class="col-span-3 my-1 border-t border-flat-weak" />
      <template v-for="level in bidLevels" :key="`b${level.price}`">
        <span class="text-text-tertiary">买{{ bidLevels.indexOf(level) + 1 }}</span>
        <span :class="levelToneClass(level.price)">{{ formatPrice(level.price) }}</span>
        <span class="text-right text-text-secondary">{{ level.volume }}</span>
      </template>
    </div>
  </div>
</template>

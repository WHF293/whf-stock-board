<script setup lang="ts">
import { computed } from 'vue';
import { formatPrice } from '../../utils/format-price';
import BaseEmpty from '../ui/BaseEmpty.vue';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 五档盘口：左右分栏（买盘在左 / 卖盘在右），每档一行「档位 / 价格 / 手数」；
 * 颜色跟随系统涨跌主题色：买盘整列用涨色，卖盘整列用跌色（不按档位价格相对昨收 individually 着色）
 */
const props = defineProps<{
  /** 完整报价（含五档数据）；为 null 时不渲染 */
  quote: FullQuote | null;
}>();

/** 买盘（买一 -> 买五） */
const bidLevels = computed(() => props.quote?.bid ?? []);
/** 卖盘（卖一 -> 卖五） */
const askLevels = computed(() => props.quote?.ask ?? []);
</script>

<template>
  <!--
    五档盘口：左右分栏（买盘在左、卖盘在右），每档一行「档位 / 价格 / 手数」
    列宽均分：左 1fr 买 / 右 1fr 卖（中间无分隔线，纯空间分区）
  -->
  <div v-if="quote" class="grid grid-cols-2 gap-x-4 text-xs tabular-nums">
    <!-- 买盘（买一 在上 / 买五 在下）：整列涨色 -->
    <div>
      <div class="mb-1 text-center text-xs font-medium text-up">买盘</div>
      <div class="grid grid-cols-[1fr_1.2fr_1fr] items-center border-b border-flat-weak py-1 text-text-tertiary">
        <span class="text-left">档位</span>
        <span class="text-center">价格</span>
        <span class="text-right">手数</span>
      </div>
      <div
        v-for="(level, index) in bidLevels"
        :key="`b${level.price}`"
        class="grid grid-cols-[1fr_1.2fr_1fr] items-center border-b border-flat-weak/50 py-1.5"
      >
        <span class="text-up">买{{ index + 1 }}</span>
        <span class="text-center text-up">{{ formatPrice(level.price) }}</span>
        <span class="text-right text-up/80">{{ level.volume }}</span>
      </div>
    </div>
    <!-- 卖盘（卖一 在上 / 卖五 在下）：整列跌色 -->
    <div>
      <div class="mb-1 text-center text-xs font-medium text-down">卖盘</div>
      <div class="grid grid-cols-[1fr_1.2fr_1fr] items-center border-b border-flat-weak py-1 text-text-tertiary">
        <span class="text-left">档位</span>
        <span class="text-center">价格</span>
        <span class="text-right">手数</span>
      </div>
      <div
        v-for="(level, index) in askLevels"
        :key="`a${level.price}`"
        class="grid grid-cols-[1fr_1.2fr_1fr] items-center border-b border-flat-weak/50 py-1.5"
      >
        <span class="text-down">卖{{ index + 1 }}</span>
        <span class="text-center text-down">{{ formatPrice(level.price) }}</span>
        <span class="text-right text-down/80">{{ level.volume }}</span>
      </div>
    </div>
  </div>
  <BaseEmpty v-else text="暂无盘口数据" />
</template>

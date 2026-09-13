<script setup lang="ts">
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTag from '../ui/BaseTag.vue';
import ChipDistributionChart from '../charts/ChipDistributionChart.vue';
import StockOrderBook from '../business/StockOrderBook.vue';
import type { ChipDistributionItem } from '../../types/kline.types';
import type { FullQuote } from '../../types/stock-quote.types';
import { formatPercentUnsigned } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';

/**
 * 个股详情侧栏组件：分时/五日展示五档盘口，其余周期展示筹码分布；
 * 侧栏区域从主面板剥离，便于在视图层任意位置摆放
 */
defineProps<{
  /** 当前图表模式：分时（含五日）展示五档盘口；K 线周期展示筹码分布 */
  mode: 'timeline' | 'candle';
  /** 最新报价（五档盘口用） */
  quote: FullQuote | null;
  /** 筹码分布数据（仅 K 线周期使用） */
  chipItem: ChipDistributionItem | null;
  /** 筹码分布是否加载中（用于空态/骨架切换） */
  isChipsLoading?: boolean;
}>();

/** 获利比例展示文案（0..1 -> %） */
const profitRatioLabel = (item: ChipDistributionItem | null): string =>
  item?.profitRatio === null || item?.profitRatio === undefined
    ? '--'
    : `${(item.profitRatio * 100).toFixed(2)}%`;
</script>

<template>
  <BaseCard v-if="mode === 'timeline'" title="五档盘口">
    <StockOrderBook :quote="quote" />
  </BaseCard>
  <BaseCard v-else>
    <template #title>
      <div class="flex items-center justify-between gap-2">
        <span>筹码分布</span>
        <BaseTag tone="primary">获利 {{ profitRatioLabel(chipItem) }}</BaseTag>
      </div>
    </template>
    <ChipDistributionChart
      v-if="chipItem?.histogram && chipItem.histogram.prices.length > 0"
      :item="chipItem"
      :current-price="quote?.price ?? null"
    />
    <BaseSkeleton v-else-if="isChipsLoading" />
    <BaseEmpty v-else text="暂无筹码数据（新浪源未提供换手率，分布按等权推演，依赖日 K 是否就绪）" />
    <dl v-if="chipItem?.histogram && chipItem.histogram.prices.length > 0" class="mt-3 space-y-1.5 text-xs text-text-secondary">
      <div class="flex justify-between">
        <dt>平均成本</dt>
        <dd class="tabular-nums">{{ formatPrice(chipItem.avgCost) }}</dd>
      </div>
      <div class="flex justify-between">
        <dt>90%集中度</dt>
        <dd class="tabular-nums">
          {{ formatPercentUnsigned(chipItem.concentration90 === null ? null : (chipItem.concentration90 ?? 0) * 100) }}
        </dd>
      </div>
      <div class="flex justify-between">
        <dt>90%成本区间</dt>
        <dd class="tabular-nums">
          {{ formatPrice(chipItem.cost90Low) }} ~ {{ formatPrice(chipItem.cost90High) }}
        </dd>
      </div>
      <div class="flex justify-between">
        <dt>70%成本区间</dt>
        <dd class="tabular-nums">
          {{ formatPrice(chipItem.cost70Low) }} ~ {{ formatPrice(chipItem.cost70High) }}
        </dd>
      </div>
    </dl>
  </BaseCard>
</template>

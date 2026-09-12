<script setup lang="ts">
import { computed } from 'vue';
import { MARKET_STATUS, MARKET_STATUS_LABEL } from '../../constants/market-status.constants';
import { useMarketStatusStore } from '../../stores/market-status';

/**
 * 交易时段徽标：状态点 + 中文标签，由 market-status store 驱动
 */
const marketStatusStore = useMarketStatusStore();

/** 状态标签（首次刷新完成前展示占位符） */
const label = computed(() =>
  marketStatusStore.status ? MARKET_STATUS_LABEL[marketStatusStore.status] : '--',
);

/** 状态点颜色：交易中绿色，其余灰色 */
const dotClass = computed(() =>
  marketStatusStore.status === MARKET_STATUS.OPEN ? 'bg-down' : 'bg-flat',
);
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 rounded-full bg-flat-weak px-2.5 py-1 text-xs text-text-secondary"
  >
    <span class="h-1.5 w-1.5 rounded-full" :class="dotClass" />
    {{ label }}
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import { CCPM_EQUITY_PRODUCTS, CCPM_PRODUCTS } from '../../../../common/constants/futures.constants.ts';
import type { CcpmScopeMode } from '../../../../common/types/futures.types.ts';

/**
 * 机构行为页 · 顶部筛选控制器
 *
 * 品种 / 三档合并口径（单合约 · 同品种合并 · 全股指合并）/ 合约 / 交易日 / 席位搜索。
 * 全股指口径下品种与合约选择失效（固定聚合 IF+IH+IC+IM 四品种全部上榜合约）。
 */
const props = defineProps<{
  /** 当前品种代码 */
  product: string;
  /** 当前合并口径 */
  scope: CcpmScopeMode;
  /** 当前合约（单合约口径下使用） */
  instrument: string;
  /** 交易日（yyyy-MM-dd，date input 值） */
  day: string;
  /** 当日披露的合约列表（单合约口径的选项） */
  instruments: readonly string[];
  /** 席位搜索关键词 */
  search: string;
}>();

const emit = defineEmits<{
  /** 品种变化 */
  'update:product': [value: string];
  /** 合并口径变化 */
  'update:scope': [value: CcpmScopeMode];
  /** 合约变化 */
  'update:instrument': [value: string];
  /** 交易日变化（yyyy-MM-dd） */
  'update:day': [value: string];
  /** 席位搜索关键词变化 */
  'update:search': [value: string];
}>();

/** 品种选项（BaseTabs 数据源） */
const productOptions = CCPM_PRODUCTS.map((item) => ({
  value: item.code,
  label: `${item.code} ${item.name}`,
}));

/** 合并口径选项（全股指合并为本次新增，文字带警示色语义） */
const scopeOptions: readonly { label: string; value: string }[] = [
  { value: 'contract', label: '单合约' },
  { value: 'product', label: '同品种合并' },
  { value: 'all', label: '全股指合并' },
];

/** 合约选项（BaseTabs 数据源） */
const instrumentOptions = computed(() =>
  props.instruments.map((id) => ({ value: id, label: id })),
);

/** 是否处于全股指口径（品种与合约选择随之失效） */
const isAllScope = computed(() => props.scope === 'all');

/** 是否支持全股指口径的品种（国债品种不支持） */
const allScopeSupported = computed(() =>
  CCPM_EQUITY_PRODUCTS.includes(props.product as never),
);
</script>

<template>
  <section class="rounded-card bg-surface p-4 shadow-card">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="min-w-14 shrink-0 text-xs font-semibold text-text-tertiary">品种</span>
      <BaseTabs
        :model-value="product"
        :options="productOptions"
        class="max-w-full"
        @update:model-value="emit('update:product', $event)"
      />
      <span class="ml-auto text-xs text-text-tertiary">交易日</span>
      <input
        type="date"
        :value="day"
        class="rounded-lg bg-flat-weak px-3 py-1.5 text-sm text-text outline-none focus:ring-1 focus:ring-primary"
        @change="emit('update:day', ($event.target as HTMLInputElement).value)"
      >
    </div>

    <div class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="min-w-14 shrink-0 text-xs font-semibold text-text-tertiary">合并口径</span>
      <BaseTabs
        :model-value="scope"
        :options="scopeOptions"
        @update:model-value="emit('update:scope', $event as CcpmScopeMode)"
      />
      <span
        v-if="isAllScope && !allScopeSupported"
        class="text-xs text-up"
      >当前品种为国债期货，不参与全股指合并口径</span>
      <span
        v-if="isAllScope && allScopeSupported"
        class="text-xs text-text-tertiary"
      >口径 = IF + IH + IC + IM 全部上榜合约，按席位聚合</span>
    </div>

    <div v-if="!isAllScope" class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="min-w-14 shrink-0 text-xs font-semibold text-text-tertiary">合约</span>
      <BaseTabs
        :model-value="instrument"
        :options="instrumentOptions"
        @update:model-value="emit('update:instrument', $event)"
      />
      <span class="relative ml-auto">
        <MenuIcon
          name="search"
          :size="14"
          class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-tertiary"
        />
        <input
          :value="search"
          type="text"
          placeholder="搜索席位，如「中信期货」"
          class="w-56 rounded-lg bg-flat-weak py-1.5 pl-8 pr-3 text-sm text-text placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-primary"
          @input="emit('update:search', ($event.target as HTMLInputElement).value)"
        >
      </span>
    </div>
    <div v-else class="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span class="min-w-14 shrink-0 text-xs font-semibold text-text-tertiary">席位</span>
      <input
        :value="search"
        type="text"
        placeholder="搜索席位，如「中信期货」"
        class="w-56 rounded-lg bg-flat-weak px-3 py-1.5 text-sm text-text placeholder:text-text-tertiary outline-none focus:ring-1 focus:ring-primary"
        @input="emit('update:search', ($event.target as HTMLInputElement).value)"
      />
    </div>
  </section>
</template>

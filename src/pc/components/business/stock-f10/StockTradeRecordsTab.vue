<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import { formatPrice } from '../../../../common/utils/format-price';
import { listTradeRecordsBySymbol } from '../../../../common/api/account-records-db.api.ts';
import type { AccountTradeRecord } from '../../../../common/types/account.types.ts';
import { useStockAccountStore } from '../../../../common/stores/stock-account';

/**
 * 更多信息抽屉 · 交易记录页签（2026-10-24 王总指定从详情页底部迁入）
 *
 * 该股全部成交记录（跨账户，本机 SQLite 成交流水），多账户时可按账户筛选；
 * 切换标的自动重拉，数据本地直读非网络请求
 */
const props = defineProps<{
  /** 标的符号（sh600519 等完整形态） */
  symbol: string;
}>();

const accountStore = useStockAccountStore();

/** 该股成交记录（跨账户） */
const tradeRecords = ref<AccountTradeRecord[]>([]);
/** 加载中 */
const isLoading = ref(false);

/**
 * 拉取该股全部成交记录（失败即空列表）
 * @returns Promise 完成即写入组件状态
 */
const load = async (): Promise<void> => {
  isLoading.value = true;
  try {
    tradeRecords.value = await listTradeRecordsBySymbol(props.symbol);
  } catch (error) {
    console.error('[stock-f10-drawer] trade-records', error);
    tradeRecords.value = [];
  } finally {
    isLoading.value = false;
  }
};

watch(
  () => props.symbol,
  () => {
    void load();
  },
  { immediate: true },
);

/**
 * 成交数量展示（买入为正、卖出为负，正数补 + 号）
 * @param quantity 成交数量（股；负数表示卖出）
 * @returns 带符号的数量文案
 */
const formatTradeQuantity = (quantity: number): string => `${quantity > 0 ? '+' : ''}${quantity}`;

/** 账户筛选值：'' = 全部账户，否则为账户 id */
const accountFilter = ref('');

/** 记录里出现过的账户（id → 账户名；已删除账户兜底显示 id 前 8 位） */
const accountOptions = computed(() => {
  const ids = [...new Set(tradeRecords.value.map((record) => record.accountId))];
  const nameById = new Map(accountStore.accounts.map((account) => [account.id, account.name]));
  return ids.map((id) => ({ id, name: nameById.get(id) ?? `账户 ${id.slice(0, 8)}` }));
});

/** 筛选后的记录（'' = 不过滤） */
const visibleRecords = computed(() =>
  accountFilter.value === ''
    ? tradeRecords.value
    : tradeRecords.value.filter((record) => record.accountId === accountFilter.value),
);

// 账户被筛掉后当前选中可能失效（切股后新列表无此账户），回退全部
watch(accountOptions, (options) => {
  if (accountFilter.value !== '' && !options.some((option) => option.id === accountFilter.value)) {
    accountFilter.value = '';
  }
});
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- 顶部：账户筛选（≥2 账户时显示）+ 数据来源说明 -->
    <div class="flex shrink-0 items-center justify-between gap-2 pb-2">
      <span class="text-xs text-text-tertiary">来源：账户成交流水（本机数据库）</span>
      <select
        v-if="accountOptions.length > 1"
        v-model="accountFilter"
        class="rounded-lg border border-flat-weak bg-surface px-2 py-1 text-xs text-text"
        aria-label="按账户筛选交易记录"
      >
        <option value="">全部账户</option>
        <option v-for="option in accountOptions" :key="option.id" :value="option.id">
          {{ option.name }}
        </option>
      </select>
    </div>

    <BaseSkeleton v-if="isLoading" />
    <BaseEmpty v-else-if="visibleRecords.length === 0" text="暂无该股成交记录" />
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <div
        class="sticky top-0 z-[1] flex items-center gap-3 border-b border-flat-weak bg-surface px-2 pb-1.5 text-xs text-text-tertiary"
      >
        <span class="flex-1">时间</span>
        <span class="w-10 text-right">操作</span>
        <span class="w-20 text-right">数量</span>
        <span class="w-20 text-right">价格</span>
      </div>
      <div
        v-for="record in visibleRecords"
        :key="record.id"
        class="flex items-center gap-3 border-b border-flat-weak/50 px-2 py-1.5 text-sm tabular-nums last:border-0 hover:bg-flat-weak/40"
      >
        <span class="flex-1 whitespace-nowrap text-text-secondary">
          {{ record.tradeDate }} {{ record.tradeTime }}
        </span>
        <span class="w-10 text-right" :class="record.quantity >= 0 ? 'text-up' : 'text-down'">
          {{ record.quantity >= 0 ? '买入' : '卖出' }}
        </span>
        <span
          class="w-20 text-right font-medium"
          :class="record.quantity >= 0 ? 'text-up' : 'text-down'"
        >
          {{ formatTradeQuantity(record.quantity) }}
        </span>
        <span class="w-20 text-right text-text">{{ formatPrice(record.price) }}</span>
      </div>
    </div>
  </div>
</template>

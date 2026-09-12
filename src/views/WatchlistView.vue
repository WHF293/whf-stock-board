<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseInput from '../components/ui/BaseInput.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import StockSearchInput from '../components/business/StockSearchInput.vue';
import WatchlistTable from '../components/business/WatchlistTable.vue';
import { fetchFullQuotes } from '../api/quotes.api';
import { usePolling } from '../composables/use-polling';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import {
  DEFAULT_GROUP_ID,
  REMOVE_GROUP_CONFIRM_TEXT,
} from '../constants/watchlist.constants';
import { useWatchlistStore } from '../stores/watchlist';
import { useDataCacheStore } from '../stores/data-cache';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import type { SearchResult } from '../types/stock-quote.types';
import type { FullQuote } from '../types/stock-quote.types';

/**
 * 自选股：分组 tab + 搜索添加 + 分组表格，轮询仅拉当前分组标的；
 * 报价映射有内存快照：切回本页先展示上次报价，接口返回后刷新
 */
const watchlistStore = useWatchlistStore();
const dataCache = useDataCacheStore();

/** 当前激活分组 id */
const activeGroupId = ref<string>(DEFAULT_GROUP_ID);

/** 激活分组（容错回退到首个分组） */
const activeGroup = computed(
  () =>
    watchlistStore.groups.find((group) => group.id === activeGroupId.value) ??
    watchlistStore.groups[0],
);

/** 当前分组报价映射（key 为 FullQuote.code 原始形态；快照播种） */
const quotesMap = ref<Record<string, FullQuote>>(
  dataCache.get<Record<string, FullQuote>>(DATA_CACHE_KEY.WATCHLIST_QUOTES_MAP) ?? {},
);

/** 行情首载中：表格以骨架屏代替 `--` 闪现（有快照则直接展示快照，不进骨架） */
const isQuotesLoading = ref(Object.keys(quotesMap.value).length === 0);

/** 拉取当前分组全部标的行情（成功后写快照） */
const fetchActiveGroupQuotes = async (): Promise<void> => {
  const symbols = activeGroup.value?.stocks.map((stock) => stock.symbol) ?? [];
  if (symbols.length === 0) {
    quotesMap.value = {};
    isQuotesLoading.value = false;
    return;
  }
  isQuotesLoading.value = true;
  try {
    const quotes = await fetchFullQuotes(symbols);
    quotesMap.value = Object.fromEntries(quotes.map((quote) => [quote.code, quote]));
    dataCache.set(DATA_CACHE_KEY.WATCHLIST_QUOTES_MAP, quotesMap.value);
  } finally {
    isQuotesLoading.value = false;
  }
};

usePolling({
  task: fetchActiveGroupQuotes,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});

// 切换分组后立即补拉一次
watch(activeGroupId, () => {
  void fetchActiveGroupQuotes();
});

/** 新分组名称输入 */
const newGroupName = ref('');

/** 新建分组并切换过去 */
const onAddGroup = (): void => {
  const name = newGroupName.value.trim();
  if (!name) {
    return;
  }
  const group = watchlistStore.addGroup(name);
  activeGroupId.value = group.id;
  newGroupName.value = '';
};

/**
 * 删除分组（默认组禁删；删除后回退到默认组）
 * @param groupId 分组 id
 */
const onRemoveGroup = (groupId: string): void => {
  if (groupId === DEFAULT_GROUP_ID) {
    return;
  }
  if (!window.confirm(REMOVE_GROUP_CONFIRM_TEXT)) {
    return;
  }
  watchlistStore.removeGroup(groupId);
  if (activeGroupId.value === groupId) {
    activeGroupId.value = DEFAULT_GROUP_ID;
  }
};

/**
 * 搜索结果加入当前分组自选
 * @param result 搜索结果
 */
const onAddStock = (result: SearchResult): void => {
  watchlistStore.addStock(
    { symbol: result.code, name: result.name, addedAt: Date.now() },
    activeGroup.value?.id ?? DEFAULT_GROUP_ID,
  );
};

/**
 * 移除当前分组内的自选股
 * @param symbol 股票符号
 */
const onRemoveStock = (symbol: string): void => {
  if (activeGroup.value) {
    watchlistStore.removeStock(activeGroup.value.id, symbol);
  }
};

/**
 * 拖拽重排当前分组自选顺序
 * @param fromIndex 拖起条目下标
 * @param toIndex 放置目标下标
 */
const onReorderStock = (fromIndex: number, toIndex: number): void => {
  if (activeGroup.value) {
    watchlistStore.reorderStock(activeGroup.value.id, fromIndex, toIndex);
  }
};
</script>

<template>
  <div class="space-y-4">
    <!-- 分组 tab + 新建分组 -->
    <div class="flex flex-wrap items-center gap-2">
      <button
        v-for="group in watchlistStore.groups"
        :key="group.id"
        type="button"
        class="pressable group inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm active:scale-95"
        :class="
          group.id === activeGroup?.id
            ? 'bg-primary-weak font-medium text-primary'
            : 'bg-flat-weak text-text-secondary hover:text-text'
        "
        @click="activeGroupId = group.id"
      >
        {{ group.name }}
        <span class="text-xs opacity-60">{{ group.stocks.length }}</span>
        <span
          v-if="group.id !== DEFAULT_GROUP_ID"
          class="pressable rounded opacity-0 transition-opacity group-hover:opacity-100 active:scale-90"
          role="button"
          :aria-label="`删除分组 ${group.name}`"
          @click.stop="onRemoveGroup(group.id)"
        >
          <MenuIcon name="trash" :size="12" />
        </span>
      </button>
      <form class="flex items-center gap-2" @submit.prevent="onAddGroup">
        <BaseInput v-model="newGroupName" placeholder="新分组名称" class="w-28" />
        <BaseButton variant="ghost">
          <MenuIcon name="plus" :size="14" />
          新建
        </BaseButton>
      </form>
    </div>

    <!-- 搜索添加 -->
    <div class="max-w-md">
      <StockSearchInput @select="onAddStock" />
    </div>

    <!-- 分组表格 -->
    <BaseCard :title="activeGroup?.name">
      <template v-if="(activeGroup?.stocks.length ?? 0) > 0">
        <div v-if="!isQuotesLoading" class="table-scroll">
          <WatchlistTable
            :stocks="activeGroup!.stocks"
            :quotes-map="quotesMap"
            @remove="onRemoveStock"
            @reorder="onReorderStock"
          />
        </div>
        <div v-else class="space-y-3" aria-hidden="true">
          <div v-for="i in Math.min(activeGroup!.stocks.length, 5)" :key="i" class="animate-pulse">
            <div class="h-9 rounded-lg bg-flat-weak" />
          </div>
        </div>
      </template>
      <BaseEmpty v-else text="还没有自选股，搜索代码或名称添加吧" />
    </BaseCard>
  </div>
</template>

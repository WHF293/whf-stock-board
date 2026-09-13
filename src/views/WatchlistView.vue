<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseConfirmModal from "../components/ui/BaseConfirmModal.vue";
import BaseEmpty from "../components/ui/BaseEmpty.vue";
import BaseInput from "../components/ui/BaseInput.vue";
import BaseTabs from "../components/ui/BaseTabs.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import StockSearchModal from "../components/business/StockSearchModal.vue";
import WatchlistTable from "../components/business/WatchlistTable.vue";
import { fetchFullQuotes } from "../api/quotes.api";
import { usePolling } from "../composables/use-polling";
import { POLLING_INTERVAL } from "../constants/polling.constants";
import { DEFAULT_GROUP_ID } from "../constants/watchlist.constants";
import { useWatchlistStore } from "../stores/watchlist";
import { useDataCacheStore } from "../stores/data-cache";
import { DATA_CACHE_KEY } from "../constants/data-cache.constants";
import type { SearchResult } from "../types/stock-quote.types";
import type { FullQuote } from "../types/stock-quote.types";

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

/** 分组 tab 选项（数量移到卡片标题展示） */
const groupTabOptions = computed(() =>
  watchlistStore.groups.map((group) => ({
    label: group.name,
    value: group.id,
  })),
);

/** 当前分组报价映射（key 为 FullQuote.code 原始形态；快照播种） */
const quotesMap = ref<Record<string, FullQuote>>(
  dataCache.get<Record<string, FullQuote>>(
    DATA_CACHE_KEY.WATCHLIST_QUOTES_MAP,
  ) ?? {},
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
    quotesMap.value = Object.fromEntries(
      quotes.map((quote) => [quote.code, quote]),
    );
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
const newGroupName = ref("");

/** 新建分组并切换过去 */
const onAddGroup = (): void => {
  const name = newGroupName.value.trim();
  if (!name) {
    return;
  }
  const group = watchlistStore.addGroup(name);
  activeGroupId.value = group.id;
  newGroupName.value = "";
};

/** 删除分组确认弹窗开关 */
const showRemoveConfirm = ref(false);

/** 待删除的分组 id（在弹窗回调里消费） */
const pendingRemoveGroupId = ref<string | null>(null);

/**
 * 请求删除分组（默认组禁删；先弹确认窗）
 * @param groupId 分组 id
 */
const onRemoveGroup = (groupId: string): void => {
  if (groupId === DEFAULT_GROUP_ID) {
    return;
  }
  pendingRemoveGroupId.value = groupId;
  showRemoveConfirm.value = true;
};

/** 弹窗确认后的实际删除（删除后回退到默认组） */
const onConfirmRemove = (): void => {
  const groupId = pendingRemoveGroupId.value;
  if (!groupId) {
    return;
  }
  watchlistStore.removeGroup(groupId);
  if (activeGroupId.value === groupId) {
    activeGroupId.value = DEFAULT_GROUP_ID;
  }
  pendingRemoveGroupId.value = null;
};

/** 添加股票弹窗开关 */
const searchModalOpen = ref(false);

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
    <!-- 分组 tab -->
    <div class="flex items-center gap-2">
      <div class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <BaseTabs
          v-model="activeGroupId"
          :options="groupTabOptions"
          variant="underline"
        />
      </div>
    </div>

    <!-- 搜索添加（左侧）+ 新建分组（右侧） -->
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <BaseButton variant="ghost" @click="searchModalOpen = true">
          <MenuIcon name="plus" :size="14" />
          添加股票
        </BaseButton>
      </div>
      <form class="flex items-center gap-2" @submit.prevent="onAddGroup">
        <BaseInput
          v-model="newGroupName"
          placeholder="新分组名称"
          class="w-28"
        />
        <BaseButton type="submit" variant="ghost">
          <MenuIcon name="plus" :size="14" />
          新建
        </BaseButton>
      </form>
    </div>

    <!-- 分组表格 -->
    <BaseCard
      :title="`当前分组-${activeGroup?.name ?? ''}（${activeGroup?.stocks.length ?? 0}只股票）`"
    >
      <template #extra>
        <button
          v-if="activeGroup?.id !== DEFAULT_GROUP_ID"
          type="button"
          class="pressable shrink-0 rounded-md p-1.5 text-text-tertiary hover:bg-up-weak hover:text-down active:scale-90"
          :aria-label="`删除分组 ${activeGroup?.name}`"
          @click="onRemoveGroup(activeGroup.id)"
        >
          <MenuIcon name="trash" :size="14" />
        </button>
      </template>
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
          <div
            v-for="i in Math.min(activeGroup!.stocks.length, 5)"
            :key="i"
            class="animate-pulse"
          >
            <div class="h-9 rounded-lg bg-flat-weak" />
          </div>
        </div>
      </template>
      <BaseEmpty v-else text="还没有自选股，搜索代码或名称添加吧" />
    </BaseCard>

    <!-- 删除分组二次确认弹窗（antd Modal 风格） -->
    <BaseConfirmModal
      v-model:open="showRemoveConfirm"
      title="删除分组"
      :content="`确认删除「${watchlistStore.groups.find((g) => g.id === pendingRemoveGroupId)?.name ?? ''}」分组？组内 ${watchlistStore.groups.find((g) => g.id === pendingRemoveGroupId)?.stocks.length ?? 0} 只自选股将一并移除。`"
      ok-text="删除"
      ok-variant="danger"
      @ok="onConfirmRemove"
    />

    <!-- 添加股票搜索弹窗 -->
    <StockSearchModal
      :open="searchModalOpen"
      @close="searchModalOpen = false"
      @select="
        (result) => {
          onAddStock(result);
          searchModalOpen = false;
        }
      "
    />
  </div>
</template>

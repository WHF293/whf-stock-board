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
import WatchlistBatchAddModal from "../components/business/WatchlistBatchAddModal.vue";
import WatchlistGroupEditModal from "../components/business/WatchlistGroupEditModal.vue";
import WatchlistTable from "../components/business/WatchlistTable.vue";
import { fetchFullQuotes } from "../api/quotes.api";
import { usePolling } from "../composables/use-polling";
import { POLLING_INTERVAL } from "../constants/polling.constants";
import { NOTIFY_SOURCE_WATCHLIST, NOTIFY_TONE } from "../constants/notify.constants";
import {
  BATCH_ADD_EXISTS_TEMPLATE,
  BATCH_ADD_MISSING_DETAIL_MAX,
  BATCH_ADD_MISSING_MULTI_TEMPLATE,
  BATCH_ADD_MISSING_TEMPLATE,
  BATCH_ADD_SKIPPED_TEMPLATE,
  BATCH_ADD_SUCCESS_TEMPLATE,
  DEFAULT_GROUP_ID,
} from "../constants/watchlist.constants";
import { useWatchlistStore } from "../stores/watchlist";
import { useNotificationsStore } from "../stores/notifications";
import { useDataCacheStore } from "../stores/data-cache";
import { DATA_CACHE_KEY } from "../constants/data-cache.constants";
import { findQuoteBySymbol } from "../utils/find-quote-by-symbol";
import type { SearchResult } from "../types/stock-quote.types";
import type { FullQuote } from "../types/stock-quote.types";
import type { BatchAddResolveResult, WatchlistStock } from "../types/watchlist.types";

/**
 * 自选股：分组 tab + 搜索添加 + 分组表格，轮询仅拉当前分组标的；
 * 报价映射有内存快照：切回本页先展示上次报价，接口返回后刷新
 */
const watchlistStore = useWatchlistStore();
const dataCache = useDataCacheStore();
const notifyStore = useNotificationsStore();

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

/**
 * 行情首载中：表格以骨架屏代替 `--` 闪现（有快照则直接展示快照，不进骨架）
 *
 * **只在「当前分组一条报价都还没有」时置 true**。这个标记一旦翻 true，
 * 模板就会整表卸载换成骨架屏、数据回来再重建 —— 表现为「整个列表闪一下」，
 * 顺带丢掉滚动位置与悬停态。常规轮询刷新只覆盖 `quotesMap`（行 key 不变，
 * DOM 原地复用），绝不翻这个标记。
 */
const isQuotesLoading = ref(Object.keys(quotesMap.value).length === 0);

/**
 * 当前分组是否已经有任意一条报价（用来区分「首载」与「常规刷新」）
 * @param symbols 当前分组标的符号
 * @returns 是否已有报价
 */
const hasAnyQuote = (symbols: string[]): boolean =>
  symbols.some((symbol) => findQuoteBySymbol(quotesMap.value, symbol) !== undefined);

/** 拉取当前分组全部标的行情（成功后写快照） */
const fetchActiveGroupQuotes = async (): Promise<void> => {
  const symbols = activeGroup.value?.stocks.map((stock) => stock.symbol) ?? [];
  if (symbols.length === 0) {
    quotesMap.value = {};
    isQuotesLoading.value = false;
    return;
  }
  // 首次进页 / 切到新分组才会一条报价都没有 → 此时才值得走骨架屏；
  // 同分组的周期性刷新静默覆盖数据即可
  if (!hasAnyQuote(symbols)) {
    isQuotesLoading.value = true;
  }
  try {
    const quotes = await fetchFullQuotes(symbols);
    quotesMap.value = Object.fromEntries(
      quotes.map((quote) => [quote.code, quote]),
    );
    dataCache.set(DATA_CACHE_KEY.WATCHLIST_QUOTES_MAP, quotesMap.value);
  } finally {
    // 已经是 false 时赋值不触发更新（ref 做同值比较），因此不产生多余渲染
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

// ---------- 从当前分组移除（操作列删除按钮，二次确认后生效） ----------

/** 移除自选股确认弹窗开关 */
const showRemoveStockConfirm = ref(false);

/** 待移除的自选股符号（在弹窗回调里消费） */
const pendingRemoveSymbol = ref<string | null>(null);

/** 待移除的条目（取当前分组内的行数据，用于弹窗文案） */
const pendingRemoveStock = computed(
  () =>
    activeGroup.value?.stocks.find((stock) => stock.symbol === pendingRemoveSymbol.value) ?? null,
);

/**
 * 该票除当前分组外还归属几个分组
 *
 * 用来决定确认文案：还有别的归属时强调「其余分组不受影响」，
 * 否则说明这是最后一次移除（这票会从自选里彻底消失）。
 * @returns 其余分组数量
 */
const pendingRemoveOtherGroupCount = computed(() => {
  const symbol = pendingRemoveSymbol.value;
  if (!symbol) {
    return 0;
  }
  const currentGroupId = activeGroup.value?.id;
  return watchlistStore
    .groupIdsOfSymbol(symbol)
    .filter((groupId) => groupId !== currentGroupId).length;
});

/** 确认弹窗正文 */
const removeStockConfirmContent = computed(() => {
  const stock = pendingRemoveStock.value;
  if (!stock) {
    return '';
  }
  const otherCount = pendingRemoveOtherGroupCount.value;
  const tail =
    otherCount > 0
      ? `该股仍保留在其余 ${otherCount} 个分组中，不受影响。`
      : '该股将不再出现在任何分组，之后可用「添加股票」重新加入。';
  return `确认将「${stock.name}」从「${activeGroup.value?.name ?? ''}」分组移除？${tail}`;
});

/**
 * 请求把某只自选股从**当前分组**移除（先弹二次确认，确认后才落库）
 * @param symbol 股票符号
 */
const onRemoveStock = (symbol: string): void => {
  if (!activeGroup.value) {
    return;
  }
  pendingRemoveSymbol.value = symbol;
  showRemoveStockConfirm.value = true;
};

/** 确认移除（仅当前分组；其他分组的归属不动，跨分组调整走操作列的编辑弹窗） */
const onConfirmRemoveStock = (): void => {
  const symbol = pendingRemoveSymbol.value;
  const groupId = activeGroup.value?.id;
  if (symbol && groupId) {
    watchlistStore.removeStock(groupId, symbol);
  }
  pendingRemoveSymbol.value = null;
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

// ---------- 分组归属编辑弹窗（操作列的编辑按钮触发） ----------

/** 分组归属弹窗开关 */
const editGroupsOpen = ref(false);

/** 待编辑归属的自选股（关闭时保留上一次的值，避免关闭动画期间内容跳空） */
const editingStock = ref<WatchlistStock | null>(null);

/**
 * 打开分组归属弹窗
 * @param stock 表格行对应的自选股条目
 */
const onEditStockGroups = (stock: WatchlistStock): void => {
  editingStock.value = stock;
  editGroupsOpen.value = true;
};

/**
 * 确认分组归属：按勾选结果同步（勾上=加入该组，取消=从该组移除）
 *
 * 名称优先取最新报价（上游可能改名），条目原有的加入时间保持不变
 * @param groupIds 弹窗回传的勾选分组 id 列表
 */
const onConfirmStockGroups = (groupIds: string[]): void => {
  const stock = editingStock.value;
  if (!stock) {
    return;
  }
  watchlistStore.syncStockGroups(
    {
      symbol: stock.symbol,
      name: findQuoteBySymbol(quotesMap.value, stock.symbol)?.name ?? stock.name,
      addedAt: stock.addedAt,
    },
    groupIds,
  );
};

// ---------- 批量添加（弹窗内解析 + 校验，这里落库并弹浮窗） ----------

/** 批量添加弹窗开关 */
const batchAddOpen = ref(false);

/**
 * 批量添加确认：把校验通过的标的逐个加入当前分组，并提示查不到的代码
 *
 * 弹窗已经用行情接口确认过代码存在，这里只处理「加得进 / 已在分组里」，
 * 再按用户能看懂的方式反馈：成功一条、查不到的逐条（多于 3 条合并成一条防刷屏）。
 * @param payload 弹窗回传的校验结果
 */
const onConfirmBatchAdd = (payload: BatchAddResolveResult): void => {
  const group = activeGroup.value;
  if (!group) {
    return;
  }
  // addedAt 递增，保持用户输入的先后顺序（同毫秒入库时列表顺序才稳定）
  const base = Date.now();
  let added = 0;
  let skipped = 0;
  payload.items.forEach((item, index) => {
    const ok = watchlistStore.addStock(
      { symbol: item.symbol, name: item.name, addedAt: base + index },
      group.id,
    );
    if (ok) {
      added += 1;
    } else {
      skipped += 1;
    }
  });

  if (added > 0) {
    notifyStore.push({
      title: BATCH_ADD_SUCCESS_TEMPLATE.replace('{count}', String(added)).replace(
        '{group}',
        group.name,
      ),
      body: skipped > 0 ? BATCH_ADD_SKIPPED_TEMPLATE.replace('{skipped}', String(skipped)) : '',
      tone: NOTIFY_TONE.PRIMARY,
      source: NOTIFY_SOURCE_WATCHLIST,
    });
  } else if (skipped > 0) {
    notifyStore.push({
      title: BATCH_ADD_EXISTS_TEMPLATE.replace('{count}', String(skipped)).replace(
        '{group}',
        group.name,
      ),
      tone: NOTIFY_TONE.FLAT,
      source: NOTIFY_SOURCE_WATCHLIST,
    });
  }

  const missing = payload.missing;
  if (missing.length === 0) {
    return;
  }
  // 少量逐条报出（用户要的就是「哪个代码错了」），多了合并成一条避免同屏被挤爆
  if (missing.length <= BATCH_ADD_MISSING_DETAIL_MAX) {
    for (const input of missing) {
      notifyStore.push({
        title: BATCH_ADD_MISSING_TEMPLATE.replace('{code}', input),
        tone: NOTIFY_TONE.UP,
        source: NOTIFY_SOURCE_WATCHLIST,
        dedupeKey: `watchlist-batch-missing-${input}`,
      });
    }
    return;
  }
  notifyStore.push({
    title: BATCH_ADD_MISSING_MULTI_TEMPLATE.replace('{count}', String(missing.length)).replace(
      '{codes}',
      missing.slice(0, BATCH_ADD_MISSING_DETAIL_MAX).join('、'),
    ),
    tone: NOTIFY_TONE.UP,
    source: NOTIFY_SOURCE_WATCHLIST,
  });
};
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 分组 tab -->
    <div class="flex shrink-0 items-center gap-2">
      <div class="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <BaseTabs
          v-model="activeGroupId"
          :options="groupTabOptions"
          variant="underline"
        />
      </div>
    </div>

    <!-- 搜索添加（左侧）+ 新建分组（右侧） -->
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <BaseButton variant="ghost" @click="searchModalOpen = true">
          <MenuIcon name="plus" :size="14" />
          添加股票
        </BaseButton>
        <BaseButton
          variant="ghost"
          data-track="WATCHLIST_BATCH_ADD"
          @click="batchAddOpen = true"
        >
          <MenuIcon name="tradeImport" :size="14" />
          批量添加
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

    <!-- 分组表格（撑满卡片剩余高度；表格容器必须是卡片的直接 flex 子项，
         所以这里不留普通 block 包裹层，滚动容器类直接透传给 BaseTable） -->
    <BaseCard
      fill
      class="min-h-0 flex-1"
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
        <WatchlistTable
          v-if="!isQuotesLoading"
          scroll-class="table-scroll-fill"
          :stocks="activeGroup!.stocks"
          :quotes-map="quotesMap"
          @remove="onRemoveStock"
          @reorder="onReorderStock"
          @edit="onEditStockGroups"
        />
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

    <!-- 移除自选股二次确认弹窗（确认后只清当前分组） -->
    <BaseConfirmModal
      v-model:open="showRemoveStockConfirm"
      title="移除自选股"
      :content="removeStockConfirmContent"
      ok-text="移除"
      ok-variant="danger"
      @ok="onConfirmRemoveStock"
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

    <!-- 批量添加弹窗（粘贴代码 → 校验存在性 → 回传后落库并提示） -->
    <WatchlistBatchAddModal
      v-model:open="batchAddOpen"
      :group-name="activeGroup?.name ?? ''"
      @confirm="onConfirmBatchAdd"
    />

    <!-- 分组归属编辑弹窗（操作列编辑按钮触发；勾选后确认才生效） -->
    <WatchlistGroupEditModal
      v-model:open="editGroupsOpen"
      :stock="editingStock"
      @confirm="onConfirmStockGroups"
    />
  </div>
</template>

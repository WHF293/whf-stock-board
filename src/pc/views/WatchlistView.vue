<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseConfirmModal from "../components/ui/BaseConfirmModal.vue";
import BaseInput from "../components/ui/BaseInput.vue";
import BaseModal from "../components/ui/BaseModal.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import StockSearchModal from "../components/business/StockSearchModal.vue";
import WatchlistBatchAddModal from "../components/business/WatchlistBatchAddModal.vue";
import WatchlistGroupEditModal from "../components/business/WatchlistGroupEditModal.vue";
import WatchlistGroupSettingsModal from "../components/business/WatchlistGroupSettingsModal.vue";
import WatchlistTiledBoard from "../components/business/WatchlistTiledBoard.vue";
import { fetchFullQuotes } from "../../common/api/quotes.api.ts";
import { usePolling } from "../../common/composables/use-polling";
import { POLLING_INTERVAL } from "../../common/constants/polling.constants.ts";
import { NOTIFY_SOURCE_WATCHLIST, NOTIFY_TONE } from "../../common/constants/notify.constants.ts";
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from "../../common/composables/use-page-header-slot";
import {
  BATCH_ADD_EXISTS_TEMPLATE,
  BATCH_ADD_MISSING_DETAIL_MAX,
  BATCH_ADD_MISSING_MULTI_TEMPLATE,
  BATCH_ADD_MISSING_TEMPLATE,
  BATCH_ADD_SKIPPED_TEMPLATE,
  BATCH_ADD_SUCCESS_TEMPLATE,
  DEFAULT_GROUP_ID,
} from "../../common/constants/watchlist.constants.ts";
import { STORAGE_NS_WATCHLIST_GROUP_HIDDEN } from "../../common/constants/storage-key.constants.ts";
import { appStorage } from "../../common/utils/app-local-storage";
import { useWatchlistStore } from "../../common/stores/watchlist";
import { useNotificationsStore } from "../../common/stores/notifications";
import { useDataCacheStore } from "../../common/stores/data-cache";
import { DATA_CACHE_KEY } from "../../common/constants/data-cache.constants.ts";
import { findQuoteBySymbol } from "../../common/utils/find-quote-by-symbol";
import type { SearchResult } from "../../common/types/stock-quote.types.ts";
import type { FullQuote } from "../../common/types/stock-quote.types.ts";
import type { BatchAddResolveResult, WatchlistStock } from "../../common/types/watchlist.types.ts";

/**
 * 自选股（2026-10-27 王总指定：Tab 模式已删除，页面主体 = 分组平铺看板）：
 * 一个分组一列（参考热点新闻卡片流），卡片拖拽跨列即改分组，轮询拉全量自选行情；
 * 报价映射有内存快照：切回本页先展示上次报价，接口返回后刷新；
 * 分组列的顺序与显隐经「分组设置」弹窗调整（热点新闻源设置同款交互），持久化
 */
const watchlistStore = useWatchlistStore();
const dataCache = useDataCacheStore();
const notifyStore = useNotificationsStore();

/** 页头挂载守卫（「分组设置」按钮 Teleport 到页头，KeepAlive 页面防残留） */
const { active: headerSlotActive } = usePageHeaderSlot();

// ---------- 行情（全量自选，轮询；快照播种） ----------

/** 全量报价映射（key 为 FullQuote.code 原始形态；快照播种） */
const quotesMap = ref<Record<string, FullQuote>>(
  dataCache.get<Record<string, FullQuote>>(
    DATA_CACHE_KEY.WATCHLIST_QUOTES_MAP,
  ) ?? {},
);

/** 拉取全量自选股行情（成功后写快照） */
const fetchQuotes = async (): Promise<void> => {
  const symbols = watchlistStore.allSymbols;
  if (symbols.length === 0) {
    quotesMap.value = {};
    return;
  }
  try {
    const quotes = await fetchFullQuotes(symbols);
    quotesMap.value = Object.fromEntries(
      quotes.map((quote) => [quote.code, quote]),
    );
    dataCache.set(DATA_CACHE_KEY.WATCHLIST_QUOTES_MAP, quotesMap.value);
  } catch (error) {
    console.error('[watchlist] quotes', error);
  }
};

usePolling({
  task: fetchQuotes,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});

// ---------- 分组列顺序与显隐（分组设置弹窗，热点新闻源设置同款交互） ----------

/** 隐藏的分组 id 列表（appStorage 持久化；分组删除时顺手清理） */
const hiddenGroupIds = ref<string[]>(
  JSON.parse(appStorage.getItem(STORAGE_NS_WATCHLIST_GROUP_HIDDEN) ?? '[]') as string[],
);

/** 展示的分组（已过滤隐藏；顺序 = store 分组顺序 = 设置弹窗确认后的顺序） */
const visibleGroups = computed(() =>
  watchlistStore.groups.filter((group) => !hiddenGroupIds.value.includes(group.id)),
);

/** 分组设置弹窗条目（勾选 + 拖拽草稿的数据源；默认组不可删） */
const groupSettingsItems = computed(() =>
  watchlistStore.groups.map((group) => ({
    value: group.id,
    label: group.name,
    enabled: !hiddenGroupIds.value.includes(group.id),
    deletable: group.id !== DEFAULT_GROUP_ID,
  })),
);

/** 分组设置弹窗开关 */
const groupSettingsOpen = ref(false);

/**
 * 分组设置确认：按拖拽结果重排分组（store），勾选结果落隐藏列表（appStorage）
 * @param items 弹窗回传的分组设置（顺序即展示顺序）
 */
const onGroupSettingsConfirm = (items: { value: string; enabled: boolean }[]): void => {
  watchlistStore.reorderGroups(items.map((item) => item.value));
  hiddenGroupIds.value = items.filter((item) => !item.enabled).map((item) => item.value);
  appStorage.setItem(
    STORAGE_NS_WATCHLIST_GROUP_HIDDEN,
    JSON.stringify(hiddenGroupIds.value),
  );
};

// ---------- 删除分组（分组设置弹窗行内按钮触发，二次确认后生效） ----------

/** 删除分组确认弹窗开关 */
const showRemoveGroupConfirm = ref(false);

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
  showRemoveGroupConfirm.value = true;
};

/** 弹窗确认后的实际删除（从隐藏列表顺手清理，避免残留脏 id） */
const onConfirmRemoveGroup = (): void => {
  const groupId = pendingRemoveGroupId.value;
  if (!groupId) {
    return;
  }
  watchlistStore.removeGroup(groupId);
  hiddenGroupIds.value = hiddenGroupIds.value.filter((id) => id !== groupId);
  appStorage.setItem(
    STORAGE_NS_WATCHLIST_GROUP_HIDDEN,
    JSON.stringify(hiddenGroupIds.value),
  );
  pendingRemoveGroupId.value = null;
};

// ---------- 新建分组（弹窗创建；名称最多 8 个字） ----------

/** 新建分组弹窗开关 */
const createGroupOpen = ref(false);

/** 新分组名称输入（弹窗内；最多 8 个字） */
const newGroupName = ref("");

/** 打开新建分组弹窗（顺手清掉上次的输入） */
const onCreateGroupOpen = (): void => {
  newGroupName.value = "";
  createGroupOpen.value = true;
};

/** 新建分组（空名由确认按钮禁用兜底） */
const onAddGroup = (): void => {
  const name = newGroupName.value.trim();
  if (!name) {
    return;
  }
  watchlistStore.addGroup(name);
  createGroupOpen.value = false;
};

// ---------- 添加 / 批量添加（2026-10-28 王总指定：入口移到各分组列头，落点 = 点的分组） ----------

/**
 * 分组名（通知 / 批量弹窗提示用；未知 id 回落「默认分组」）
 * @param groupId 分组 id
 * @returns 分组名
 */
const groupNameOf = (groupId: string): string =>
  watchlistStore.groups.find((group) => group.id === groupId)?.name ?? '默认分组';

/** 添加股票弹窗开关 */
const searchModalOpen = ref(false);

/** 添加股票的落点分组（列头 icon 点击时写入） */
const searchTargetGroupId = ref<string>(DEFAULT_GROUP_ID);

/**
 * 从分组列头打开添加弹窗（落点 = 该分组）
 * @param groupId 分组 id
 */
const onColumnAdd = (groupId: string): void => {
  searchTargetGroupId.value = groupId;
  searchModalOpen.value = true;
};

/**
 * 搜索结果加入目标分组自选
 * @param result 搜索结果
 */
const onAddStock = (result: SearchResult): void => {
  watchlistStore.addStock(
    { symbol: result.code, name: result.name, addedAt: Date.now() },
    searchTargetGroupId.value,
  );
};

/** 批量添加弹窗开关 */
const batchAddOpen = ref(false);

/** 批量添加的落点分组（列头 icon 点击时写入） */
const batchTargetGroupId = ref<string>(DEFAULT_GROUP_ID);

/** 批量弹窗提示用落点分组名 */
const batchTargetGroupName = computed(() => groupNameOf(batchTargetGroupId.value));

/**
 * 从分组列头打开批量添加弹窗（落点 = 该分组）
 * @param groupId 分组 id
 */
const onColumnBatchAdd = (groupId: string): void => {
  batchTargetGroupId.value = groupId;
  batchAddOpen.value = true;
};

/**
 * 批量添加确认：把校验通过的标的逐个加入目标分组，并提示查不到的代码
 * @param payload 弹窗回传的校验结果
 */
const onConfirmBatchAdd = (payload: BatchAddResolveResult): void => {
  const groupId = batchTargetGroupId.value;
  const base = Date.now();
  let added = 0;
  let skipped = 0;
  payload.items.forEach((item, index) => {
    const ok = watchlistStore.addStock(
      { symbol: item.symbol, name: item.name, addedAt: base + index },
      groupId,
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
        batchTargetGroupName.value,
      ),
      body: skipped > 0 ? BATCH_ADD_SKIPPED_TEMPLATE.replace('{skipped}', String(skipped)) : '',
      tone: NOTIFY_TONE.PRIMARY,
      source: NOTIFY_SOURCE_WATCHLIST,
    });
  } else if (skipped > 0) {
    notifyStore.push({
      title: BATCH_ADD_EXISTS_TEMPLATE.replace('{count}', String(skipped)).replace(
        '{group}',
        batchTargetGroupName.value,
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

// ---------- 从分组移除（卡片 hover 操作按钮，二次确认后只清该分组） ----------

/** 移除自选股确认弹窗开关 */
const showRemoveStockConfirm = ref(false);

/** 待移除条目（分组 id + 符号） */
const pendingRemove = ref<{ groupId: string; symbol: string } | null>(null);

/** 待移除条目信息（弹窗文案用：股票名 + 分组名） */
const pendingRemoveInfo = computed(() => {
  const payload = pendingRemove.value;
  if (!payload) {
    return null;
  }
  const group = watchlistStore.groups.find((item) => item.id === payload.groupId);
  const stock = group?.stocks.find((item) => item.symbol === payload.symbol) ?? null;
  return { groupName: group?.name ?? '', stock };
});

/** 该票除待移除分组外还归属几个分组（决定确认文案尾部） */
const pendingRemoveOtherGroupCount = computed(() => {
  const payload = pendingRemove.value;
  if (!payload) {
    return 0;
  }
  return watchlistStore
    .groupIdsOfSymbol(payload.symbol)
    .filter((groupId) => groupId !== payload.groupId).length;
});

/** 确认弹窗正文 */
const removeStockConfirmContent = computed(() => {
  const info = pendingRemoveInfo.value;
  if (!info?.stock) {
    return '';
  }
  const otherCount = pendingRemoveOtherGroupCount.value;
  const tail =
    otherCount > 0
      ? `该股仍保留在其余 ${otherCount} 个分组中，不受影响。`
      : '该股将不再出现在任何分组，之后可用「添加股票」重新加入。';
  return `确认将「${info.stock.name}」从「${info.groupName}」分组移除？${tail}`;
});

/**
 * 请求把某只自选股从指定分组移除（先弹二次确认，确认后才落库）
 * @param payload 分组 id + 股票符号
 * @param payload.groupId 分组 id
 * @param payload.symbol 股票符号
 */
const onRemoveStock = (payload: { groupId: string; symbol: string }): void => {
  pendingRemove.value = payload;
  showRemoveStockConfirm.value = true;
};

/** 确认移除（仅该分组；其他分组的归属不动，跨分组调整走卡片拖拽 / 编辑弹窗） */
const onConfirmRemoveStock = (): void => {
  const payload = pendingRemove.value;
  if (payload) {
    watchlistStore.removeStock(payload.groupId, payload.symbol);
  }
  pendingRemove.value = null;
};

// ---------- 分组归属编辑弹窗（卡片 hover 编辑按钮触发，可多选分组） ----------

/** 分组归属弹窗开关 */
const editGroupsOpen = ref(false);

/** 待编辑归属的自选股（关闭时保留上一次的值，避免关闭动画期间内容跳空） */
const editingStock = ref<WatchlistStock | null>(null);

/**
 * 打开分组归属弹窗
 * @param stock 看板卡片对应的自选股条目
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
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <!-- 页头：分组设置 + 新建分组（2026-10-28 王总指定：新建分组从内容区移到页头，与分组设置同处） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <div class="flex items-center gap-2">
        <BaseButton variant="ghost" data-track="WATCHLIST_GROUP_CREATE_OPEN" @click="onCreateGroupOpen">
          <MenuIcon name="plus" :size="14" />
          新建分组
        </BaseButton>
        <BaseButton variant="ghost" data-track="WATCHLIST_GROUP_SETTINGS" @click="groupSettingsOpen = true">
          <MenuIcon name="settings" :size="14" />
          分组设置
        </BaseButton>
      </div>
    </Teleport>

    <!-- 分组平铺看板：一个分组一列（列顺序/显隐 = 分组设置），卡片 = 名称/现价/涨跌幅，
         hover 展开全部字段并浮现操作按钮；卡片拖到别的分组列即修改归属；
         列头 icon 打开添加/批量添加弹窗（落点 = 该分组，2026-10-28） -->
    <WatchlistTiledBoard
      class="min-h-0 flex-1"
      :groups="visibleGroups"
      :quotes-map="quotesMap"
      @edit="onEditStockGroups"
      @remove="onRemoveStock"
      @add="onColumnAdd"
      @batch-add="onColumnBatchAdd"
    />

    <!-- 页头「分组设置」弹窗（拖拽排序 + 勾选显隐 + 删除入口） -->
    <WatchlistGroupSettingsModal
      v-model:open="groupSettingsOpen"
      :items="groupSettingsItems"
      @confirm="onGroupSettingsConfirm"
      @remove="onRemoveGroup"
    />

    <!-- 新建分组弹窗（名称最多 8 个字，创建后默认显示、排末尾） -->
    <BaseModal v-model:open="createGroupOpen" title="新建分组" max-width-class="max-w-sm">
      <div class="space-y-2">
        <BaseInput
          v-model="newGroupName"
          placeholder="分组名称"
          maxlength="8"
          aria-label="分组名称"
          class="w-full"
          @keyup.enter="onAddGroup"
        />
        <p class="text-xs text-text-tertiary">最多 8 个字</p>
      </div>
      <template #footer>
        <BaseButton variant="ghost" @click="createGroupOpen = false">取消</BaseButton>
        <BaseButton :disabled="newGroupName.trim() === ''" @click="onAddGroup">创建分组</BaseButton>
      </template>
    </BaseModal>

    <!-- 删除分组二次确认弹窗（分组设置弹窗行内删除按钮触发） -->
    <BaseConfirmModal
      v-model:open="showRemoveGroupConfirm"
      title="删除分组"
      :content="`确认删除「${watchlistStore.groups.find((g) => g.id === pendingRemoveGroupId)?.name ?? ''}」分组？组内 ${watchlistStore.groups.find((g) => g.id === pendingRemoveGroupId)?.stocks.length ?? 0} 只自选股将一并移除。`"
      ok-text="删除"
      ok-variant="danger"
      @ok="onConfirmRemoveGroup"
    />

    <!-- 移除自选股二次确认弹窗（确认后只清该分组） -->
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

    <!-- 批量添加弹窗（粘贴代码 → 校验存在性 → 回传后落库并提示；落点 = 触发列的分组） -->
    <WatchlistBatchAddModal
      v-model:open="batchAddOpen"
      :group-name="batchTargetGroupName"
      @confirm="onConfirmBatchAdd"
    />

    <!-- 分组归属编辑弹窗（卡片 hover 编辑按钮触发；勾选后确认才生效） -->
    <WatchlistGroupEditModal
      v-model:open="editGroupsOpen"
      :stock="editingStock"
      @confirm="onConfirmStockGroups"
    />
  </div>
</template>

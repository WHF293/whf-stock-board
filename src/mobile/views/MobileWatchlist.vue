<script setup lang="ts">
/**
 * 自选（v2 Tab2）：复刻 PC 端 WatchlistView 的核心能力并做移动端适配
 *
 * - 数据层直接复用 common：useWatchlistStore（localStorage 持久化）+ fetchFullQuotes
 * - 分组：chips 横向切换 + 新建（弹窗）+ 删除当前分组（默认组受保护）
 * - 股票：搜索弹层添加（searchStocks 防抖）、左滑删除、点击进个股详情
 * - 行情：useMobilePolling 前台轮询（30s 默认档），快照落 mobileCache（切回先显旧价）
 * - 不做拖拽排序 / 分组归属编辑（移动端后续迭代；PC 侧功能不受影响）
 */
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { showConfirmDialog, showToast } from 'vant';
import { useWatchlistStore } from '../../common/stores/watchlist';
import { DEFAULT_GROUP_ID } from '../../common/constants/watchlist.constants';
import { fetchFullQuotes } from '../../common/api/quotes.api';
import { searchStocks } from '../../common/api/search.api';
import { findQuoteBySymbol } from '../../common/utils/find-quote-by-symbol';
import type { FullQuote, SearchResult } from '../../common/types/stock-quote.types';
import type { WatchlistStock } from '../../common/types/watchlist.types';
import { mobileCacheGetStale, mobileCacheSet } from '../cache';
import { useMobilePolling } from '../composables/use-mobile-polling';

const router = useRouter();
const store = useWatchlistStore();

/** 当前分组 id（容错：分组被删后回落默认组） */
const activeGroupId = ref(store.groups[0]?.id ?? DEFAULT_GROUP_ID);
const activeGroup = computed(
  () => store.groups.find((group) => group.id === activeGroupId.value) ?? store.groups[0],
);

/* === 行情：报价映射 + 前台轮询 + 快照缓存 === */
const WL_CACHE_KEY = 'watchlist:quotes';
const quotesMap = ref<Record<string, FullQuote>>({});
const quotesLoading = ref(false);

/** 冷启动先播快照（30 分钟内有效），再静默刷新 */
const cached = mobileCacheGetStale<Record<string, FullQuote>>(WL_CACHE_KEY);
if (cached) quotesMap.value = cached.value;

const loadQuotes = async (): Promise<void> => {
  const symbols = activeGroup.value?.stocks.map((stock) => stock.symbol) ?? [];
  if (symbols.length === 0) {
    quotesMap.value = {};
    return;
  }
  if (quotesLoading.value) return;
  quotesLoading.value = true;
  try {
    const quotes = await fetchFullQuotes(symbols);
    quotesMap.value = Object.fromEntries(quotes.map((quote) => [quote.code, quote]));
    mobileCacheSet(WL_CACHE_KEY, quotesMap.value);
  } catch {
    // 轮询失败保持上次报价，不弹错误打断浏览
  } finally {
    quotesLoading.value = false;
  }
};

useMobilePolling(loadQuotes);

watch(activeGroupId, () => {
  void loadQuotes();
});
void loadQuotes();

/* === 行视图：名称取报价最新名，价格/涨跌幅按趋势着色 === */
interface WatchRowView {
  stock: WatchlistStock;
  price: string;
  priceCls: string;
  pct: string;
  pctCls: string;
  pillCls: string;
}

const activeRows = computed<WatchRowView[]>(() =>
  (activeGroup.value?.stocks ?? []).map((stock) => {
    const quote = findQuoteBySymbol(quotesMap.value, stock.symbol);
    const pct = quote?.changePercent ?? null;
    return {
      stock,
      price: quote?.price?.toFixed(2) ?? '--',
      priceCls: pct === null || pct === 0 ? 'm-flat' : pct > 0 ? 'm-up' : 'm-down',
      pct: pct === null ? '--' : `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`,
      pctCls: pct === null || pct === 0 ? 'm-flat' : pct > 0 ? 'm-up' : 'm-down',
      pillCls: pct !== null && pct !== 0 ? (pct > 0 ? 'up' : 'down') : '',
    };
  }),
);

/** 行点击进个股详情（长按弹层触发后吞掉本次 click）
 * @param symbol 完整符号（如 sh600519） */
const goStock = (symbol: string): void => {
  if (suppressClick.value) {
    suppressClick.value = false;
    return;
  }
  void router.push(`/stock/${symbol}`);
};

/* === 添加股票（搜索弹层） === */
const searchOpen = ref(false);
const keyword = ref('');
const searching = ref(false);
const results = ref<SearchResult[]>([]);
let searchTimer: number | undefined;

/** 搜索输入防抖 300ms（>=2 字符才请求）
 * @param value 输入关键词 */
const onSearchInput = (value: string): void => {
  window.clearTimeout(searchTimer);
  const kw = value.trim();
  if (kw.length < 2) {
    results.value = [];
    searching.value = false;
    return;
  }
  searching.value = true;
  searchTimer = window.setTimeout(async () => {
    try {
      results.value = await searchStocks(kw);
    } catch {
      results.value = [];
    } finally {
      searching.value = false;
    }
  }, 300);
};

const openSearch = (): void => {
  keyword.value = '';
  results.value = [];
  searchOpen.value = true;
};

/** 选中搜索结果加入当前分组（组内去重由 store 负责）
 * @param item 搜索结果条目 */
const onPick = async (item: SearchResult): Promise<void> => {
  const ok = store.addStock(
    { symbol: item.code, name: item.name, addedAt: Date.now() },
    activeGroupId.value,
  );
  if (ok) {
    showToast(`已加入「${activeGroup.value?.name ?? '默认'}」`);
    await loadQuotes();
  } else {
    showToast('该分组已有此股');
  }
};

/* === 分组管理 === */
const groupDlg = ref(false);
const newGroupName = ref('');

/** 确认新建分组（成功后切到新组） */
const confirmAddGroup = (): void => {
  const name = newGroupName.value.trim();
  if (!name) return;
  const group = store.addGroup(name);
  activeGroupId.value = group.id;
  newGroupName.value = '';
  showToast(`已创建「${name}」`);
};

/** 删除当前分组（默认组受保护，删除后回落默认组） */
const onRemoveGroup = (): void => {
  const group = activeGroup.value;
  if (!group || group.id === DEFAULT_GROUP_ID) {
    showToast('默认分组不可删除');
    return;
  }
  void showConfirmDialog({
    title: '删除分组',
    message: `确定删除「${group.name}」？组内 ${group.stocks.length} 只自选将一并移除（其他分组不受影响）`,
  })
    .then(() => {
      store.removeGroup(group.id);
      activeGroupId.value = DEFAULT_GROUP_ID;
      showToast('分组已删除');
    })
    .catch(() => {});
};

/** 左滑删除：从当前分组移除
 * @param row 行视图条目 */
const onRemoveStock = (row: WatchRowView): void => {
  store.removeStock(activeGroupId.value, row.stock.symbol);
  showToast('已从当前分组移除');
};

/* === 长按行：分组归属点选切换 + 删除自选（底部弹层，参考 PC 多组归属模型） === */
const sheetOpen = ref(false);
const sheetStock = ref<WatchlistStock | null>(null);

/** 弹层里的分组清单（含归属状态） */
const sheetGroups = computed(() => {
  if (!sheetStock.value) return [];
  return store.groups.map((group) => ({
    id: group.id,
    name: group.name,
    joined: group.stocks.some((stock) => stock.symbol === sheetStock.value?.symbol),
  }));
});

let pressTimer: number | undefined;
const clearPress = (): void => {
  window.clearTimeout(pressTimer);
  pressTimer = undefined;
};

/** 长按触发后吞掉紧随其后的 click（否则弹层关闭时会误跳个股详情） */
const suppressClick = ref(false);

/** 触摸开始：按住 500ms 弹出操作层（touchmove 即取消，不与滚动 / 左滑删除冲突）
 * @param stock 行内自选条目 */
const onTouchStart = (stock: WatchlistStock): void => {
  clearPress();
  pressTimer = window.setTimeout(() => {
    pressTimer = undefined;
    suppressClick.value = true;
    sheetStock.value = stock;
    sheetOpen.value = true;
  }, 500);
};

const onTouchMove = clearPress;
const onTouchEnd = clearPress;

/** 切换股票在某分组的归属（在组内则移出，不在则加入）
 * @param groupId 目标分组 id */
const toggleGroup = async (groupId: string): Promise<void> => {
  const stock = sheetStock.value;
  if (!stock) return;
  const group = store.groups.find((item) => item.id === groupId);
  if (!group) return;
  const joined = group.stocks.some((item) => item.symbol === stock.symbol);
  if (joined) {
    store.removeStock(groupId, stock.symbol);
    showToast(`已移出「${group.name}」`);
  } else {
    const ok = store.addStock(
      { symbol: stock.symbol, name: stock.name, addedAt: stock.addedAt },
      groupId,
    );
    showToast(ok ? `已加入「${group.name}」` : '操作失败');
  }
  await loadQuotes();
};

/** 从所有分组删除该自选（带确认） */
const onSheetRemove = (): void => {
  const stock = sheetStock.value;
  if (!stock) return;
  void showConfirmDialog({
    title: '删除自选',
    message: `将把「${stock.name}」从所有分组中移除`,
  })
    .then(() => {
      store.removeStockFromAllGroups(stock.symbol);
      sheetOpen.value = false;
      showToast('已删除自选');
      void loadQuotes();
    })
    .catch(() => {});
};
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar title="自选" class="m-nav" safe-area-inset-top>
      <template #right>
        <div class="m-wl-nav-acts">
          <van-icon name="delete-o" size="18" @click="onRemoveGroup" />
          <van-icon name="plus" size="19" @click="openSearch" />
        </div>
      </template>
    </van-nav-bar>

    <!-- 分组 chips + 新建 -->
    <div class="m-chips m-wl-chips">
      <button
        v-for="group in store.groups"
        :key="group.id"
        class="m-chip"
        :class="{ 'm-chip--active': group.id === activeGroupId }"
        @click="activeGroupId = group.id"
      >
        {{ group.name }}<span class="m-wl-chip__n">{{ group.stocks.length }}</span>
      </button>
      <button class="m-chip m-chip--sub" @click="groupDlg = true">＋</button>
    </div>

    <div class="m-sub-scroll">
      <div v-if="quotesLoading && activeRows.length === 0" class="m-card m-skel-fill">
        <div v-for="i in 10" :key="i" class="m-skel-row"></div>
      </div>
      <div v-else-if="activeRows.length === 0" class="m-state">
        {{ activeGroup?.name ?? '默认' }}分组还没有自选股
        <span class="retry" @click="openSearch">＋ 添加</span>
      </div>
      <div v-else class="m-card">
        <van-swipe-cell v-for="row in activeRows" :key="row.stock.symbol" class="m-wl-cell">
          <div
            class="m-row m-wl-row"
            @click="goStock(row.stock.symbol)"
            @touchstart.passive="onTouchStart(row.stock)"
            @touchmove.passive="onTouchMove"
            @touchend.passive="onTouchEnd"
            @touchcancel.passive="onTouchEnd"
          >
            <div class="m-row__nm">
              {{ row.stock.name }}
              <span class="sub">{{ row.stock.symbol }}</span>
            </div>
            <span class="m-row__val" :class="row.priceCls">{{ row.price }}</span>
            <span class="m-row__pct pill" :class="[row.pctCls, row.pillCls]">{{ row.pct }}</span>
          </div>
          <template #right>
            <van-button square type="danger" class="m-wl-del" @click.stop="onRemoveStock(row)">
              删除
            </van-button>
          </template>
        </van-swipe-cell>
      </div>
      <div class="m-home-tail"></div>
    </div>

    <!-- 添加股票：底部搜索弹层 -->
    <van-popup v-model:show="searchOpen" position="bottom" round class="m-wl-search">
      <van-search
        v-model="keyword"
        placeholder="代码 / 名称 / 拼音"
        @update:model-value="onSearchInput"
      />
      <div class="m-wl-search__list">
        <div v-if="searching" class="m-state">搜索中…</div>
        <template v-else>
          <div v-for="item in results" :key="item.code" class="m-row" @click="onPick(item)">
            <div class="m-row__nm">
              {{ item.name }}
              <span class="sub">{{ item.code }}</span>
            </div>
            <van-icon name="plus" color="var(--color-primary)" />
          </div>
          <div v-if="!results.length && keyword.trim().length >= 2" class="m-state">无匹配结果</div>
          <div v-else-if="!results.length" class="m-state">输入至少 2 个字符开始搜索</div>
        </template>
      </div>
    </van-popup>

    <!-- 新建分组 -->
    <van-dialog
      v-model:show="groupDlg"
      title="新建分组"
      show-cancel-button
      @confirm="confirmAddGroup"
    >
      <van-field v-model="newGroupName" placeholder="分组名称" maxlength="10" />
    </van-dialog>

    <!-- 长按个股：分组归属切换 + 删除自选 -->
    <van-action-sheet
      v-model:show="sheetOpen"
      :close-on-click-action="false"
      cancel-text="取消"
      :teleport="'body'"
    >
      <div class="m-wl-sheet">
        <div class="m-wl-sheet__head">
          <span class="nm">{{ sheetStock?.name }}</span>
          <span class="sub">{{ sheetStock?.symbol }}</span>
        </div>
        <div class="m-wl-sheet__label">所属分组（点选切换归属）</div>
        <div class="m-wl-sheet__groups">
          <button
            v-for="group in sheetGroups"
            :key="group.id"
            class="m-wl-sheet__g"
            :class="{ on: group.joined }"
            @click="toggleGroup(group.id)"
          >
            <van-icon :name="group.joined ? 'checked' : 'circle'" />
            {{ group.name }}
          </button>
        </div>
        <button class="m-wl-sheet__del" @click="onSheetRemove">删除自选</button>
      </div>
    </van-action-sheet>
  </div>
</template>

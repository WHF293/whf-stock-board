<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import type { TableColumn } from '../types/table.types';
import { fetchBoardChanges, fetchStockChanges, fetchZtPool } from '../api/event.api';
import { usePolling } from '../composables/use-polling';
import {
  STOCK_CHANGE_MAX_ITEMS,
  ZT_POOL_DEFAULT,
  ZT_POOL_OPTIONS,
} from '../constants/event.constants';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import type {
  BoardChangeItem,
  StockChangeItem,
  ZTPoolItem,
  ZTPoolType,
} from '../types/event.types';
import { delay } from '../utils/delay';
import { formatAmount } from '../utils/format-amount';
import { formatBoardTime } from '../utils/format-board-time';
import { formatPercent, formatPercentUnsigned } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import { useLazyRows } from '../composables/use-lazy-rows';
import { useDataCacheStore } from '../stores/data-cache';
import { useDockPanelStore } from '../stores/dock-panel';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import { getTrendByChangePercent } from '../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../constants/stock-colors.constants';

/** 股池表每批放行行数 */
const POOL_CHUNK_SIZE = 50;

const dataCache = useDataCacheStore();

withDefaults(
  defineProps<{
    /**
     * 展示模式（供父级页面按 tab 拆分复用）：
     * - zt：连板梯队 + 股池（涨停维度）
     * - events：盘口异动 + 板块异动（异动维度）
     * 数据轮询与模式无关，两个维度共享同一份预取结果
     */
    mode?: "zt" | "events";
  }>(),
  { mode: "zt" },
);

/**
 * 涨停与异动：股池 + 连板梯队（zt）/ 盘口异动时间轴 + 板块异动（events）
 *
 * 接口串行错峰轮询（对上游保持克制）
 */
const dockPanel = useDockPanelStore();

/** 各接口请求间隔（毫秒） */
const EVENT_REQUEST_GAP_MS = 500;

// ---------- 股池 ----------
const activePool = ref<string>(ZT_POOL_DEFAULT);

/** 股池快照键（按池类型区分） */
const poolCacheKey = computed(() => DATA_CACHE_KEY.EVENT_POOL_PREFIX + activePool.value);

const poolItems = ref<ZTPoolItem[]>(
  dataCache.get<ZTPoolItem[]>(DATA_CACHE_KEY.EVENT_POOL_PREFIX + ZT_POOL_DEFAULT) ?? [],
);
const isPoolLoading = ref(poolItems.value.length === 0);

// 快照播种：盘口 / 板块异动
const stockChanges = ref<StockChangeItem[]>(
  dataCache.get<StockChangeItem[]>(DATA_CACHE_KEY.EVENT_STOCK_CHANGES) ?? [],
);
const boardChanges = ref<BoardChangeItem[]>(
  dataCache.get<BoardChangeItem[]>(DATA_CACHE_KEY.EVENT_BOARD_CHANGES) ?? [],
);
const isEventsLoading = ref(stockChanges.value.length === 0);

/** 拉取当前股池（成功后写快照） */
const fetchPool = async (): Promise<void> => {
  isPoolLoading.value = true;
  try {
    poolItems.value = await fetchZtPool(activePool.value as ZTPoolType);
    dataCache.set(poolCacheKey.value, poolItems.value);
  } catch (error) {
    if (poolItems.value.length === 0) {
      poolItems.value = [];
    }
    console.error('[market-event] pool', error);
  } finally {
    isPoolLoading.value = false;
  }
};

watch(activePool, () => {
  // 切池：先快照播种再拉最新
  poolItems.value = dataCache.get<ZTPoolItem[]>(poolCacheKey.value) ?? [];
  isPoolLoading.value = poolItems.value.length === 0;
  void fetchPool();
});

/** 连板梯队：连板数 -> 家数（仅涨停池有连板字段） */
const ladder = computed(() => {
  const counts = new Map<number, number>();
  for (const item of poolItems.value) {
    const count = item.continuousBoardCount ?? 1;
    counts.set(count, (counts.get(count) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[0] - a[0]);
});

/** 股池懒加载：初始 50 行，滚动增量放行 */
const {
  rows: visiblePoolItems,
  total: poolTotal,
  hasMore: poolHasMore,
  onScroll: onPoolScroll,
} = useLazyRows<ZTPoolItem>(() => poolItems.value, POOL_CHUNK_SIZE);

/** 股池表列配置（涨跌幅默认开启排序） */
const poolColumns: TableColumn<ZTPoolItem>[] = [
  { key: 'name', label: '名称' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (item) => item.changePercent,
  },
  { key: 'continuousBoardCount', label: '连板', align: 'right' },
  { key: 'firstBoardTime', label: '首次封板', align: 'right' },
  { key: 'boardAmount', label: '封单', align: 'right' },
  { key: 'turnoverRate', label: '换手率', align: 'right' },
  { key: 'industry', label: '行业' },
];

/** 板块异动表列配置 */
const boardChangeColumns: TableColumn<BoardChangeItem>[] = [
  { key: 'name', label: '板块' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (board) => board.changePercent,
  },
  { key: 'mainNetInflow', label: '主力净流入', align: 'right' },
  { key: 'totalChangeCount', label: '异动次数', align: 'right' },
  { key: 'topStockName', label: '最频繁个股' },
];

// ---------- 盘口 / 板块异动（状态已在股池段快照播种） ----------

/** 拉取盘口 + 板块异动（串行错峰；成功后写快照） */
const fetchEvents = async (): Promise<void> => {
  isEventsLoading.value = true;
  try {
    stockChanges.value = await fetchStockChanges();
    dataCache.set(DATA_CACHE_KEY.EVENT_STOCK_CHANGES, stockChanges.value);
    await delay(EVENT_REQUEST_GAP_MS);
    boardChanges.value = await fetchBoardChanges();
    dataCache.set(DATA_CACHE_KEY.EVENT_BOARD_CHANGES, boardChanges.value);
  } catch (error) {
    if (stockChanges.value.length === 0) {
      stockChanges.value = [];
    }
    console.error('[market-event] changes', error);
  } finally {
    isEventsLoading.value = false;
  }
};

usePolling({
  task: async () => {
    await fetchPool();
    await delay(EVENT_REQUEST_GAP_MS);
    await fetchEvents();
  },
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

/**
 * 个股跳详情（6 位纯代码 -> 完整符号）
 * @param code 个股 6 位代码
 */
const openDetail = (code: string): void => {
  dockPanel.openStock(code);
};
</script>

<template>
  <div class="space-y-4">
    <!-- 连板梯队 -->
    <BaseCard v-if="mode === 'zt' && activePool === 'zt' && ladder.length > 0" title="连板梯队">
      <div class="flex flex-wrap items-center gap-2">
        <span
          v-for="[count, num] in ladder"
          :key="count"
          class="rounded-full px-3 py-1 text-xs font-medium"
          :class="count >= 3 ? 'bg-up-weak text-up' : 'bg-flat-weak text-text-secondary'"
        >
          {{ count >= 2 ? `${count}板` : '首板' }} · {{ num }} 家
        </span>
      </div>
    </BaseCard>

    <!-- 股池 -->
    <BaseCard v-if="mode === 'zt'" title="股池">
      <template #extra>
        <BaseTabs v-model="activePool" :options="ZT_POOL_OPTIONS" />
      </template>
      <div v-if="isPoolLoading && poolItems.length === 0"><BaseSkeleton /></div>
      <div v-else-if="poolItems.length > 0">
        <BaseTable
          :columns="poolColumns"
          :rows="visiblePoolItems"
          :row-key="(item) => item.code"
          min-width="720px"
          scroll-class="table-scroll-xs"
          row-clickable
          :footer-text="poolHasMore ? `已展示 ${visiblePoolItems.length} / 共 ${poolTotal}，继续滚动加载更多` : undefined"
          @row-click="(item) => openDetail(item.code)"
          @scroll="onPoolScroll"
        >
          <template #name="{ row }">
            <span class="font-medium text-text">{{ row.name }}</span>
            <span class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
          </template>
          <template #price="{ row }">
            <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]">
              {{ formatPrice(row.price) }}
            </span>
          </template>
          <template #changePercent="{ row }">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
            >
              {{ formatPercent(row.changePercent) }}
            </span>
          </template>
          <template #continuousBoardCount="{ row }">
            <span
              v-if="row.continuousBoardCount !== null"
              class="font-medium"
              :class="row.continuousBoardCount >= 2 ? 'text-up' : 'text-text-secondary'"
            >
              {{ row.continuousBoardCount }}
            </span>
            <span v-else class="text-text-tertiary">--</span>
          </template>
          <template #firstBoardTime="{ row }">
            <span class="text-text-secondary">{{ formatBoardTime(row.firstBoardTime) }}</span>
          </template>
          <template #boardAmount="{ row }">
            <span class="text-text-secondary">
              {{ formatAmount(row.boardAmount === null ? null : row.boardAmount / 10_000) }}
            </span>
          </template>
          <template #turnoverRate="{ row }">
            <span class="text-text-secondary">{{ formatPercentUnsigned(row.turnoverRate) }}</span>
          </template>
          <template #industry="{ row }">
            <span class="text-text-secondary">{{ row.industry || '--' }}</span>
          </template>
        </BaseTable>
      </div>
      <BaseEmpty v-else text="股池暂无数据" />
    </BaseCard>

    <div v-if="mode === 'events'" class="grid gap-4 @4xl:grid-cols-2">
      <!-- 盘口异动 -->
      <BaseCard title="盘口异动">
        <div v-if="isEventsLoading && stockChanges.length === 0"><BaseSkeleton /></div>
        <ul v-else-if="stockChanges.length > 0" class="max-h-80 space-y-1 overflow-y-auto text-sm">
          <li
            v-for="(change, index) in stockChanges.slice(0, STOCK_CHANGE_MAX_ITEMS)"
            :key="`${change.time}-${change.code}-${index}`"
            class="flex items-baseline gap-2 rounded px-1 py-1 hover:bg-flat-weak/50"
          >
            <span class="shrink-0 text-xs tabular-nums text-text-tertiary">{{ change.time }}</span>
            <button
              type="button"
              class="pressable shrink-0 font-medium text-text active:scale-95"
              @click="openDetail(change.code)"
            >
              {{ change.name }}
            </button>
            <span
              class="shrink-0 rounded px-1.5 py-0.5 text-xs"
              :class="
                ['rocket_launch', 'quick_rebound', 'limit_up_seal', 'big_buy_order'].includes(
                  change.changeType,
                )
                  ? 'bg-up-weak text-up'
                  : 'bg-down-weak text-down'
              "
            >
              {{ change.changeTypeLabel || change.changeType }}
            </span>
            <span class="truncate text-xs text-text-tertiary">{{ change.info }}</span>
          </li>
        </ul>
        <BaseEmpty v-else text="暂无异动数据" />
      </BaseCard>

      <!-- 板块异动 -->
      <BaseCard title="板块异动">
        <div v-if="isEventsLoading && boardChanges.length === 0"><BaseSkeleton /></div>
        <BaseTable
          v-else-if="boardChanges.length > 0"
          :columns="boardChangeColumns"
          :rows="boardChanges"
          :row-key="(board) => board.name"
          scroll-class="table-scroll-sm"
          min-width="420px"
        >
          <template #name="{ row }">
            <span class="font-medium text-text">{{ row.name }}</span>
          </template>
          <template #changePercent="{ row }">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
            >
              {{ formatPercent(row.changePercent) }}
            </span>
          </template>
          <template #mainNetInflow="{ row }">
            <span :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'">
              {{ (row.mainNetInflow ?? 0) >= 0 ? '+' : '' }}{{ ((row.mainNetInflow ?? 0) / 1e8).toFixed(2) }}亿
            </span>
          </template>
          <template #totalChangeCount="{ row }">
            <span class="text-text-secondary">{{ row.totalChangeCount ?? '--' }}</span>
          </template>
          <template #topStockName="{ row }">
            <span class="text-text-secondary">{{ row.topStockName }}</span>
          </template>
        </BaseTable>
        <BaseEmpty v-else text="暂无异动数据" />
      </BaseCard>
    </div>
  </div>
</template>

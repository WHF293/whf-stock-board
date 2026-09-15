<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import { useTabConfig } from '../composables/use-tab-config';
import PanoramaCnBoard from '../components/business/PanoramaCnBoard.vue';
import {
  fetchGlobalFuturesPanorama,
  fetchGlobalIndexPanorama,
  fetchUsSectorPanorama,
} from '../api/panorama.api';
import { PANORAMA_MACRO_GROUPS } from '../constants/panorama.constants';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import type { PanoramaItem, PanoramaMacroGroup } from '../types/panorama.types';
import { getTrendByChangePercent } from '../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../constants/stock-colors.constants';
import { formatPercent } from '../utils/format-percent';
import { delay } from '../utils/delay';
import { useDataCacheStore } from '../stores/data-cache';
import { usePolling } from '../composables/use-polling';
import { POLLING_INTERVAL } from '../constants/polling.constants';

/**
 * 行情全景：A股全景（板块排行，含行业/概念/筛选/成分股）/ 美股全景 / 全球宏观
 *
 * 美股与全球宏观只展示名称 + 涨跌幅（网格卡片）；进入页面串行错峰拉取一次
 * （不参与轮询）；数据先取内存快照秒出 UI，接口成功后写回快照并刷新；
 * A股全景由 PanoramaCnBoard 组件自管数据（快照 / 轮询 / 成分股）
 */

/** 模块 tab 选项 */
const MODULE_TABS = [
  { label: 'A股全景', value: 'cn' },
  { label: '美股全景', value: 'us' },
  { label: '全球宏观', value: 'macro' },
] as const;

/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const REQUEST_GAP_MS = 500;

// 页签显隐 + 顺序可配置（持久化）；激活值被隐藏时自动回退首个可见 tab
const { visibleOptions: moduleTabOptions, activeValue: activeModule } = useTabConfig(
  'panorama',
  MODULE_TABS,
);

const dataCache = useDataCacheStore();

// 快照播种：切换回本页先展示上次数据
const cachedUs = dataCache.get<PanoramaItem[]>(DATA_CACHE_KEY.PANORAMA_US_BOARDS);
const cachedMacro = dataCache.get<PanoramaMacroGroup[]>(DATA_CACHE_KEY.PANORAMA_MACRO);

/** 美股行业 ETF 全景 */
const usBoards = ref<PanoramaItem[]>(cachedUs ?? []);
/** 全球宏观分组 */
const macroGroups = ref<PanoramaMacroGroup[]>(cachedMacro ?? []);
/** 当前模块是否拉取中（有快照则不进骨架） */
const isLoading = ref(
  activeModule.value === 'us'
    ? usBoards.value.length === 0
    : activeModule.value === 'macro'
      ? macroGroups.value.length === 0
      : false,
);
/** 当前模块拉取是否失败（且无快照） */
const isError = ref(false);

/**
 * 在条目列表内按关键词顺序匹配（名称包含即命中）：
 * 优先名称与关键词完全一致的条目（指数 / 主力连续合约），否则取最后一个命中
 * （外盘合约按到期月升序排列，最后一个为最新主力）
 * @param items 上游条目
 * @param keywords 展示关键词
 * @returns 匹配到的条目（顺序与 keywords 一致，未命中跳过）
 */
const matchKeywords = (items: PanoramaItem[], keywords: readonly string[]): PanoramaItem[] =>
  keywords.flatMap((keyword) => {
    const hits = items.filter((item) => item.name.includes(keyword));
    const exact = hits.find((item) => item.name === keyword);
    const hit = exact ?? hits.at(-1);
    return hit ? [hit] : [];
  });

/**
 * 拉取全球宏观（全球指数 → 外盘商品串行错峰，再按配置分组匹配）
 * @returns 分组后的宏观条目（无命中的分组剔除）
 */
const fetchMacro = async (): Promise<PanoramaMacroGroup[]> => {
  const indexItems = await fetchGlobalIndexPanorama();
  await delay(REQUEST_GAP_MS);
  const futuresItems = await fetchGlobalFuturesPanorama();
  return PANORAMA_MACRO_GROUPS.map((group) => {
    const pool = group.source === 'index' ? indexItems : futuresItems;
    return { label: group.label, items: matchKeywords(pool, group.keywords) };
  }).filter((group) => group.items.length > 0);
};

/** 拉取美股全景（成功后写快照；供轮询与模块切换复用） */
const fetchUsBoards = async (): Promise<void> => {
  usBoards.value = await fetchUsSectorPanorama();
  dataCache.set(DATA_CACHE_KEY.PANORAMA_US_BOARDS, usBoards.value);
};

/** 拉取当前模块数据（成功后写快照；A股模块由 PanoramaCnBoard 自管） */
const loadActiveModule = async (): Promise<void> => {
  isLoading.value = true;
  isError.value = false;
  try {
    if (activeModule.value === 'us') {
      await fetchUsBoards();
    } else if (activeModule.value === 'macro') {
      macroGroups.value = await fetchMacro();
      dataCache.set(DATA_CACHE_KEY.PANORAMA_MACRO, macroGroups.value);
    }
  } catch (error) {
    console.error('[panorama]', error);
    isError.value = true;
  } finally {
    isLoading.value = false;
  }
};

// 首次进入非 A 股模块时拉取一次（重接口不轮询，避免触发上游反爬）
if (activeModule.value !== 'cn') {
  void loadActiveModule();
}

// 美股全景轮询：仅在美股轮询窗口（21:30-24:00 与 00:00-04:00）内按间隔刷新，
// 窗口外与非 us tab 自动跳过
usePolling({
  task: async () => {
    if (activeModule.value === 'us') {
      await fetchUsBoards();
    }
  },
  intervalMs: POLLING_INTERVAL.US_BOARDS,
  tradingAware: true,
  market: 'US',
  immediate: false,
});

/**
 * 切换模块：有快照直接展示，无快照则拉取（A股模块由组件自管）
 */
const onSelectModule = (): void => {
  isError.value = false;
  if (activeModule.value === 'cn') {
    isLoading.value = false;
    return;
  }
  const hasSnapshot =
    activeModule.value === 'us'
      ? usBoards.value.length > 0
      : macroGroups.value.length > 0;
  if (hasSnapshot) {
    isLoading.value = false;
    return;
  }
  void loadActiveModule();
};

/** 是否为全球宏观模块 */
const isMacroModule = computed(() => activeModule.value === 'macro');

/** 是否为美股模块 */
const isUsModule = computed(() => activeModule.value === 'us');

/** 当前模块是否无数据（失败 / 空集；仅美股 / 宏观使用） */
const isEmpty = computed(
  () => !isLoading.value && (isMacroModule.value ? macroGroups.value.length === 0 : usBoards.value.length === 0),
);
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <div class="flex shrink-0 items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <BaseTabs
          v-model="activeModule"
          :options="moduleTabOptions"
          variant="underline"
          @update:model-value="onSelectModule"
        />
        <TabConfigButton page-id="panorama" :options="MODULE_TABS" />
      </div>
      <span class="text-xs text-text-tertiary">未开盘时展示最近交易日收盘数据</span>
    </div>

    <!-- A股全景：板块排行组件（数据自管；撑满剩余高度，表格尽量高） -->
    <PanoramaCnBoard v-if="activeModule === 'cn'" class="min-h-0 flex-1" />

    <!-- 加载骨架（美股 / 宏观） -->
    <BaseCard v-else-if="isLoading">
      <div class="grid grid-cols-4 gap-2" aria-hidden="true">
        <div v-for="i in 12" :key="i" class="h-11 animate-pulse rounded-lg bg-flat-weak" />
      </div>
    </BaseCard>

    <!-- 失败 / 空态 -->
    <BaseCard v-else-if="isEmpty">
      <BaseEmpty text="数据加载失败或暂无数据，请稍后重试（上游可能限频）" />
    </BaseCard>

    <!-- 全球宏观：分组网格 -->
    <template v-else-if="isMacroModule">
      <BaseCard v-for="group in macroGroups" :key="group.label" :title="group.label">
        <div class="grid grid-cols-4 gap-2">
          <div
            v-for="item in group.items"
            :key="item.name"
            class="flex items-center justify-between gap-2 rounded-lg bg-flat-weak px-3 py-2.5"
          >
            <span class="truncate text-sm text-text">{{ item.name }}</span>
            <span
              class="shrink-0 text-sm font-semibold tabular-nums"
              :class="TREND_TEXT_CLASS[getTrendByChangePercent(item.changePercent ?? 0)]"
            >
              {{ formatPercent(item.changePercent) }}
            </span>
          </div>
        </div>
      </BaseCard>
    </template>

    <!-- 美股：扁平网格 -->
    <BaseCard v-else-if="isUsModule">
      <div class="grid grid-cols-4 gap-2">
        <div
          v-for="item in usBoards"
          :key="item.name"
          class="flex items-center justify-between gap-2 rounded-lg bg-flat-weak px-3 py-2.5"
        >
          <span class="truncate text-sm text-text">{{ item.name }}</span>
          <span
            class="shrink-0 text-sm font-semibold tabular-nums"
            :class="TREND_TEXT_CLASS[getTrendByChangePercent(item.changePercent ?? 0)]"
          >
            {{ formatPercent(item.changePercent) }}
          </span>
        </div>
      </div>
    </BaseCard>
  </div>
</template>

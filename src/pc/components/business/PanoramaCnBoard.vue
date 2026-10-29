<script setup lang="ts">
import { computed, ref } from "vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseEmpty from "../ui/BaseEmpty.vue";
import { fetchCalendarBoardPanorama } from "../../../common/api/board-calendar.api.ts";
import { usePolling } from "../../../common/composables/use-polling";
import { POLLING_INTERVAL } from "../../../common/constants/polling.constants.ts";
import type { PanoramaItem } from "../../../common/types/panorama.types.ts";
import { getTrendByChangePercent } from "../../../common/constants/trend.constants.ts";
import { TREND_TEXT_CLASS } from "../../../common/constants/stock-colors.constants.ts";
import { formatPercent } from "../../../common/utils/format-percent";
import { useDataCacheStore } from "../../../common/stores/data-cache";
import { DATA_CACHE_KEY } from "../../../common/constants/data-cache.constants.ts";

/**
 * A股全景 · 36 板块平铺（2026-10-29 王总指定统一口径）
 *
 * 数据源与板块日历 / 题材轮动同池（CALENDAR_BOARDS：31 申万一级 + 5 热门题材），
 * 展示形式对齐美股全景：只保留「板块名 + 涨跌幅」平铺网格，无行业/概念切换、
 * 无筛选排序、无成分股下钻（原 496 行业/概念列表视图已随本改动移除）。
 * 单请求轻接口参与轮询；快照先行秒出，接口返回静默覆盖。
 */

const dataCache = useDataCacheStore();

/** 36 板块全景（涨跌幅降序） */
const boards = ref<PanoramaItem[]>(
  dataCache.get<PanoramaItem[]>(DATA_CACHE_KEY.CALENDAR_BOARD_PANORAMA) ?? [],
);
const isLoading = ref(boards.value.length === 0);
const isError = ref(false);

/** 拉取 36 板块全景（成功写快照；进行中调用共享同一任务防重入） */
let panoramaTask: Promise<void> | null = null;
const fetchPanorama = async (): Promise<void> => {
  if (!panoramaTask) {
    panoramaTask = (async () => {
      isError.value = false;
      try {
        boards.value = await fetchCalendarBoardPanorama();
        dataCache.set(DATA_CACHE_KEY.CALENDAR_BOARD_PANORAMA, boards.value);
      } catch (error) {
        isError.value = boards.value.length === 0;
        console.error("[panorama-cn]", error);
      } finally {
        isLoading.value = false;
      }
    })().finally(() => {
      panoramaTask = null;
    });
  }
  return panoramaTask;
};

usePolling({
  task: fetchPanorama,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// 挂载即拉一次（快照已有也重拉，KeepAlive / 重挂载场景下保证新鲜）
void fetchPanorama();

/** 是否无数据（失败 / 空集且无快照） */
const isEmpty = computed(() => !isLoading.value && boards.value.length === 0);
</script>

<template>
  <BaseCard title="A股板块（36 板块统一口径）" class="flex flex-col">
    <!-- 加载骨架（无快照时） -->
    <div
      v-if="isLoading"
      class="grid grid-cols-2 gap-2 @2xl:grid-cols-3 @4xl:grid-cols-4"
      aria-hidden="true"
    >
      <div v-for="i in 12" :key="i" class="h-11 animate-pulse rounded-lg bg-flat-weak" />
    </div>

    <!-- 失败 / 空态 -->
    <BaseEmpty
      v-else-if="isEmpty"
      text="数据加载失败或暂无数据，请稍后重试（上游可能限频）"
    />

    <!-- 平铺网格：板块名 + 涨跌幅（与美股全景同款单元格） -->
    <div
      v-else
      class="grid grid-cols-2 gap-2 overflow-y-auto @2xl:grid-cols-3 @4xl:grid-cols-4"
    >
      <div
        v-for="board in boards"
        :key="board.name"
        class="flex items-center justify-between gap-2 rounded-lg bg-flat-weak px-3 py-2.5"
      >
        <span class="truncate text-sm text-text" :title="board.name">
          {{ board.name }}
        </span>
        <span
          class="shrink-0 text-sm font-semibold tabular-nums"
          :class="TREND_TEXT_CLASS[getTrendByChangePercent(board.changePercent ?? 0)]"
        >
          {{ formatPercent(board.changePercent) }}
        </span>
      </div>
    </div>
  </BaseCard>
</template>

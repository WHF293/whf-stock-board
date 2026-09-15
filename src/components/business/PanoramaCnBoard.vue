<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BaseCard from "../ui/BaseCard.vue";
import BaseEmpty from "../ui/BaseEmpty.vue";
import BaseSkeleton from "../ui/BaseSkeleton.vue";
import BaseTable from "../ui/BaseTable.vue";
import BaseTabs from "../ui/BaseTabs.vue";
import type { TableColumn } from "../../types/table.types";
import {
  fetchConceptBoards,
  fetchIndustryBoards,
  fetchIndustryConstituents,
} from "../../api/board.api";
import { usePolling } from "../../composables/use-polling";
import { POLLING_INTERVAL } from "../../constants/polling.constants";
import type { IndustryBoardConstituent } from "../../types/board.types";
import { formatAmount } from "../../utils/format-amount";
import {
  formatPercent,
  formatPercentUnsigned,
} from "../../utils/format-percent";
import { formatPrice } from "../../utils/format-price";
import { useLazyRows } from "../../composables/use-lazy-rows";
import { formatYuan } from "../../utils/format-yuan";
import { useStockOpen } from "../../composables/use-stock-open";
import { useDataCacheStore } from "../../stores/data-cache";
import { DATA_CACHE_KEY } from "../../constants/data-cache.constants";
import { getTrendByChangePercent } from "../../constants/trend.constants";
import {
  TREND_PILL_CLASS,
  TREND_TEXT_CLASS,
} from "../../constants/stock-colors.constants";
import { useSettingsStore } from "../../stores/settings";
import {
  PANORAMA_CN_VIEW_MODE,
  PANORAMA_CN_VIEW_MODE_OPTIONS,
} from "../../constants/panorama.constants";
import type { PanoramaCnViewMode } from "../../constants/panorama.constants";
import {
  BOARD_FILTER,
  BOARD_FILTER_OPTIONS,
  BOARD_SORT_OPTIONS,
  BOARD_STAT_THRESHOLD,
  BOARD_TYPE_OPTIONS,
  matchBoardFilter,
  type BoardFilterValue,
  type BoardRow,
} from "../../constants/boards.constants";

/** 排行表每批放行行数 */
const BOARDS_CHUNK_SIZE = 60;

/** 成分股表每批放行行数 */

const dataCache = useDataCacheStore();

/**
 * A股全景 · 板块排行（原板块行情页整合）：行业 / 概念按钮组 + 涨跌统计与筛选 +
 * 点击板块行展开成分股（行内表格，点击成分股跳详情）
 */

const { openSidebar, openPage, toContextList } = useStockOpen();
const settingsStore = useSettingsStore();

/** 板块排行展示形式：列表 / 平铺（设置持久化，默认列表） */
const viewMode = computed(() => settingsStore.panoramaCnViewMode);

/** 是否为平铺模式 */
const isTileMode = computed(
  () => viewMode.value === PANORAMA_CN_VIEW_MODE.TILE,
);

/** 当前板块类型（industry / concept） */
const activeTab = ref<string>("industry");

/** 排序方式 */
const sortKey = ref<string>("changePercent");

/** 当前涨跌筛选 */
const filterKey = ref<BoardFilterValue>(BOARD_FILTER.ALL);

/** 板块排行快照键（按 tab 区分） */
const boardsCacheKey = computed(() =>
  activeTab.value === "industry"
    ? DATA_CACHE_KEY.BOARDS_LIST + ".industry"
    : DATA_CACHE_KEY.BOARDS_LIST + ".concept",
);

/** 板块排行列表 */
const boards = ref<BoardRow[]>([]);
const isBoardsLoading = ref(false);
const boardsError = ref(false);

/** 拉取板块排行（快照播种 + 成功写回） */
const fetchBoards = async (): Promise<void> => {
  isBoardsLoading.value = true;
  boardsError.value = false;
  try {
    // 先用快照秒出 UI
    const cached = dataCache.get<BoardRow[]>(boardsCacheKey.value);
    if (cached && boards.value.length === 0) {
      boards.value = cached;
      isBoardsLoading.value = false;
    }
    const list =
      activeTab.value === "industry"
        ? await fetchIndustryBoards()
        : await fetchConceptBoards();
    boards.value = list;
    dataCache.set(boardsCacheKey.value, list);
  } catch (error) {
    boardsError.value = boards.value.length === 0;
    console.error("[panorama-cn]", error);
  } finally {
    isBoardsLoading.value = false;
  }
};

usePolling({
  task: fetchBoards,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

watch(activeTab, () => {
  // 切 tab：先清空并用快照播种，再拉最新
  boards.value = [];
  const cached = dataCache.get<BoardRow[]>(boardsCacheKey.value);
  if (cached) {
    boards.value = cached;
  }
  void fetchBoards();
});

// 挂载即拉一次（组件首次渲染 / 从其他模块切回）
void fetchBoards();

/** 涨跌统计（基于当前板块全量，与筛选无关） */
const boardStats = computed(() => {
  const threshold = BOARD_STAT_THRESHOLD.STRONG;
  const list = boards.value;
  const count = (predicate: (pct: number) => boolean): number =>
    list.filter((board) => predicate(board.changePercent ?? 0)).length;
  return {
    upStrong: count((pct) => pct > threshold),
    upAll: count((pct) => pct >= 0),
    downMild: count((pct) => pct < 0 && pct >= -threshold),
    downStrong: count((pct) => pct < -threshold),
  };
});

/** 筛选 + 排序后的展示数据（空值沉底；排序作用于筛选结果全量，懒加载再切片） */
const sortedBoardsFull = computed(() => {
  const filtered = boards.value.filter((board) =>
    matchBoardFilter(board.changePercent, filterKey.value),
  );
  return filtered.sort(
    (a, b) =>
      (sortKey.value === "totalMarketCap"
        ? (b.totalMarketCap ?? -Infinity)
        : (b.changePercent ?? -Infinity)) -
      (sortKey.value === "totalMarketCap"
        ? (a.totalMarketCap ?? -Infinity)
        : (a.changePercent ?? -Infinity)),
  );
});

/** 排行懒加载：初始 60 行，滚动增量放行 */
const {
  rows: sortedBoards,
  total: boardsTotal,
  hasMore: boardsHasMore,
  onScroll: onBoardsScroll,
} = useLazyRows<BoardRow>(() => sortedBoardsFull.value, BOARDS_CHUNK_SIZE);

/** 已展开的板块 code 列表（扩展行受控） */
const expandedBoardCodes = ref<string[]>([]);
/** 各板块成分股（code -> 列表，扩展行内渲染） */
const constituentsMap = ref<Record<string, IndustryBoardConstituent[]>>({});
/** 正在拉取成分股的板块 code */
const loadingBoardCode = ref<string | null>(null);

/**
 * 板块行 / 展开图标点击：切换扩展行，并按需拉取成分股（重接口，不轮询）
 * @param board 板块行
 */
const onBoardToggle = (board: BoardRow): void => {
  expandedBoardCodes.value = expandedBoardCodes.value.includes(board.code)
    ? expandedBoardCodes.value.filter((code) => code !== board.code)
    : [...expandedBoardCodes.value, board.code];
  if (expandedBoardCodes.value.includes(board.code)) {
    void loadConstituents(board);
  }
};

const loadConstituents = async (board: BoardRow): Promise<void> => {
  // 快照播种：同板块先前拉取过则直接复用
  const cacheKey = DATA_CACHE_KEY.BOARDS_CONSTITUENTS_PREFIX + board.code;
  const cached = dataCache.get<IndustryBoardConstituent[]>(cacheKey);
  if (cached) {
    constituentsMap.value = { ...constituentsMap.value, [board.code]: cached };
    return;
  }
  loadingBoardCode.value = board.code;
  try {
    const list = await fetchIndustryConstituents(board.code);
    constituentsMap.value = { ...constituentsMap.value, [board.code]: list };
    dataCache.set(cacheKey, list);
  } catch (error) {
    console.error("[panorama-cn] constituents", error);
  } finally {
    loadingBoardCode.value = null;
  }
};

/** 排行表列配置（涨跌幅默认开启排序） */
const boardColumns: TableColumn<BoardRow>[] = [
  { key: "name", label: "板块" },
  { key: "price", label: "最新价", align: "right" },
  {
    key: "changePercent",
    label: "涨跌幅",
    align: "right",
    sortable: true,
    sortValue: (board) => board.changePercent,
  },
  { key: "totalMarketCap", label: "总市值", align: "right" },
  { key: "turnoverRate", label: "换手率", align: "right" },
  { key: "riseFall", label: "上涨/下跌", align: "right" },
  { key: "leader", label: "领涨股" },
];

/** 成分股表列配置（涨跌幅默认开启排序） */
const constituentColumns: TableColumn<IndustryBoardConstituent>[] = [
  { key: "name", label: "名称" },
  { key: "price", label: "现价", align: "right" },
  {
    key: "changePercent",
    label: "涨跌幅",
    align: "right",
    sortable: true,
    sortValue: (stock) => stock.changePercent,
  },
  { key: "amount", label: "成交额", align: "right" },
];

/**
 * 成分股代码跳详情（6 位纯代码 -> 完整符号）
 * @param code 成分股 6 位代码
 */
const openDetail = (code: string): void => {
  openSidebar(code);
};
</script>

<template>
  <div class="flex min-h-0 flex-col gap-4">
    <BaseCard
      fill
      class="min-h-0 flex-1"
      :title="`${activeTab === 'industry' ? '行业' : '概念'}板块排行（命中 ${sortedBoardsFull.length} / 共 ${boards.length} 个）`"
    >
      <template #extra>
        <div class="flex flex-wrap items-center gap-2">
          <BaseTabs v-model="sortKey" :options="BOARD_SORT_OPTIONS" />
          <BaseTabs v-model="activeTab" :options="BOARD_TYPE_OPTIONS" />
          <BaseTabs
            :model-value="viewMode"
            :options="PANORAMA_CN_VIEW_MODE_OPTIONS"
            aria-label="展示形式"
            @update:model-value="
              settingsStore.setPanoramaCnViewMode($event as PanoramaCnViewMode)
            "
          />
        </div>
      </template>

      <!-- 涨跌统计 + 筛选（列表 / 平铺共用；固定高度，把剩余空间让给下方列表） -->
      <div class="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div class="grid grid-cols-4 gap-2">
          <div class="rounded-lg bg-up-weak px-3 py-1.5">
            <p class="text-[10px] text-text-tertiary">涨幅&gt;3%</p>
            <p class="text-sm font-semibold tabular-nums text-up">
              {{ boardStats.upStrong }}
            </p>
          </div>
          <div class="rounded-lg bg-flat-weak px-3 py-1.5">
            <p class="text-[10px] text-text-tertiary">涨幅≥0%</p>
            <p class="text-sm font-semibold tabular-nums text-up">
              {{ boardStats.upAll }}
            </p>
          </div>
          <div class="rounded-lg bg-flat-weak px-3 py-1.5">
            <p class="text-[10px] text-text-tertiary">跌幅&lt;3%</p>
            <p class="text-sm font-semibold tabular-nums text-down">
              {{ boardStats.downMild }}
            </p>
          </div>
          <div class="rounded-lg bg-down-weak px-3 py-1.5">
            <p class="text-[10px] text-text-tertiary">跌幅&gt;3%</p>
            <p class="text-sm font-semibold tabular-nums text-down">
              {{ boardStats.downStrong }}
            </p>
          </div>
        </div>
        <BaseTabs v-model="filterKey" :options="BOARD_FILTER_OPTIONS" />
      </div>

      <div v-if="boardsError" class="py-10">
        <BaseEmpty text="板块数据加载失败，请稍后重试" />
      </div>
      <div v-else-if="isBoardsLoading && boards.length === 0">
        <BaseSkeleton />
      </div>
      <!-- 平铺网格（与美股全景一致：板块名 + 涨跌幅；高度同列表，名称不可点击） -->
      <div
        v-else-if="isTileMode && sortedBoardsFull.length > 0"
        class="table-scroll-fill"
      >
        <div class="grid grid-cols-4 gap-2">
          <div
            v-for="board in sortedBoardsFull"
            :key="board.code"
            class="flex items-center justify-between gap-2 rounded-lg bg-flat-weak px-3 py-2.5"
          >
            <span class="truncate text-sm text-text" :title="board.name">
              {{ board.name }}
            </span>
            <span
              class="shrink-0 text-sm font-semibold tabular-nums"
              :class="
                TREND_TEXT_CLASS[getTrendByChangePercent(board.changePercent ?? 0)]
              "
            >
              {{ formatPercent(board.changePercent) }}
            </span>
          </div>
        </div>
      </div>
      <!-- 列表：撑满卡片剩余高度（外层 div 是 flex 子项，必须自己也是 flex 列，
           否则表格的 flex:1 被普通块级父级吃掉，高度会退化成内容高） -->
      <div v-else-if="sortedBoardsFull.length > 0" class="flex min-h-0 flex-1 flex-col">
        <BaseTable
          :columns="boardColumns"
          :rows="sortedBoards"
          :row-key="(board) => board.code"
          min-width="760px"
          expandable
          :expanded-keys="expandedBoardCodes"
          scroll-class="table-scroll-fill"
          :footer-text="
            boardsHasMore
              ? `已展示 ${sortedBoards.length} / 共 ${boardsTotal}，继续滚动加载更多`
              : undefined
          "
          @toggle-expand="onBoardToggle"
          @scroll="onBoardsScroll"
        >
          <template #name="{ row }">
            <span class="block max-w-full truncate font-medium text-text" :title="row.name">
              {{ row.name }}
            </span>
          </template>
          <template #price="{ row }">
            <span class="text-text-secondary">{{
              formatPrice(row.price)
            }}</span>
          </template>
          <template #changePercent="{ row }">
            <span
              class="rounded-full px-2 py-0.5 text-xs font-semibold"
              :class="
                TREND_PILL_CLASS[
                  getTrendByChangePercent(row.changePercent ?? 0)
                ]
              "
            >
              {{ formatPercent(row.changePercent) }}
            </span>
          </template>
          <template #totalMarketCap="{ row }">
            <span class="text-text-secondary">{{
              formatYuan(row.totalMarketCap)
            }}</span>
          </template>
          <template #turnoverRate="{ row }">
            <span class="text-text-secondary">{{
              formatPercentUnsigned(row.turnoverRate)
            }}</span>
          </template>
          <template #riseFall="{ row }">
            <span class="text-up">{{ row.riseCount ?? 0 }}</span>
            <span class="text-text-tertiary"> / </span>
            <span class="text-down">{{ row.fallCount ?? 0 }}</span>
          </template>
          <template #leader="{ row }">
            <span class="text-text-secondary">{{
              row.leadingStock ?? "--"
            }}</span>
            <span
              class="ml-1 text-xs"
              :class="
                TREND_TEXT_CLASS[
                  getTrendByChangePercent(row.leadingStockChangePercent ?? 0)
                ]
              "
            >
              {{ formatPercent(row.leadingStockChangePercent) }}
            </span>
          </template>

          <!-- 扩展行：成分股表格 -->
          <template #expanded="{ row }">
            <div
              v-if="loadingBoardCode === row.code && !constituentsMap[row.code]"
              class="py-4"
            >
              <BaseSkeleton />
            </div>
            <BaseTable
              v-else-if="constituentsMap[row.code]?.length"
              :columns="constituentColumns"
              :rows="constituentsMap[row.code]"
              :row-key="(stock) => stock.code"
              min-width="560px"
              row-clickable
              @row-click="(stock) => openDetail(stock.code)"
              :enable-dblclick-nav="true"
              @row-dblclick="(stock) => openPage(stock.code, toContextList(constituentsMap[row.code] ?? [], (item) => item.code))"
            >
              <template #name="{ row: stock }">
                <span class="font-medium text-text">{{ stock.name }}</span>
                <span class="ml-2 text-xs text-text-tertiary">{{ stock.code }}</span>
              </template>
              <template #price="{ row: stock }">
                <span
                  :class="
                    TREND_TEXT_CLASS[
                      getTrendByChangePercent(stock.changePercent ?? 0)
                    ]
                  "
                >
                  {{ formatPrice(stock.price) }}
                </span>
              </template>
              <template #changePercent="{ row: stock }">
                <span
                  class="rounded-full px-2 py-0.5 text-xs font-semibold"
                  :class="
                    TREND_PILL_CLASS[
                      getTrendByChangePercent(stock.changePercent ?? 0)
                    ]
                  "
                >
                  {{ formatPercent(stock.changePercent) }}
                </span>
              </template>
              <template #amount="{ row: stock }">
                <span class="text-text-secondary">
                  {{ formatAmount(stock.amount === null ? null : stock.amount / 10_000) }}
                </span>
              </template>
            </BaseTable>
            <p v-else class="py-2 text-xs text-text-tertiary">暂无成分股数据</p>
          </template>
        </BaseTable>
      </div>
      <BaseEmpty v-else text="暂无板块数据" />
    </BaseCard>
  </div>
</template>

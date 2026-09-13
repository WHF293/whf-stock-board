<script setup lang="ts">
import { computed, ref, watch } from "vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseEmpty from "../components/ui/BaseEmpty.vue";
import BaseSkeleton from "../components/ui/BaseSkeleton.vue";
import BaseTable from "../components/ui/BaseTable.vue";
import BaseTabs from "../components/ui/BaseTabs.vue";
import type { TableColumn } from "../types/table.types";
import {
  fetchBlockTradeDetail,
  fetchDragonTigerDetail,
} from "../api/dragon-tiger.api";
import type {
  BlockTradeDetailItem,
  DragonTigerDetailItem,
} from "../types/dragon-tiger.types";
import { formatPercent } from "../utils/format-percent";
import { formatPrice } from "../utils/format-price";
import { formatYuanWithSign } from "../utils/format-yuan";
import { useLazyRows } from "../composables/use-lazy-rows";
import { useDataCacheStore } from "../stores/data-cache";
import { useDockPanelStore } from "../stores/dock-panel";
import { DATA_CACHE_KEY } from "../constants/data-cache.constants";
import { getTrendByChangePercent } from "../constants/trend.constants";
import {
  TREND_PILL_CLASS,
  TREND_TEXT_CLASS,
} from "../constants/stock-colors.constants";

/** 明细表每批放行行数 */
const LIST_CHUNK_SIZE = 50;

const dataCache = useDataCacheStore();

/**
 * 龙虎榜·大宗：龙虎榜明细 / 大宗交易明细，近 7 日数据按日期下拉切换（重接口不轮询）
 */
const dockPanel = useDockPanelStore();

const VIEW_TAB_OPTIONS = [
  { label: "龙虎榜", value: "dragon-tiger" },
  { label: "大宗交易", value: "block-trade" },
] as const;

/** 当前视图 */
const activeTab = ref<string>("dragon-tiger");

/** 龙虎榜涨/跌筛选按钮组（参考板块热力「热力图/列表」样式） */
const DIRECTION_TAB_OPTIONS = [
  { label: "涨", value: "up" },
  { label: "跌", value: "down" },
] as const;
const activeDirection =
  ref<(typeof DIRECTION_TAB_OPTIONS)[number]["value"]>("up");

// ---------- 龙虎榜（快照播种 + 成功写回） ----------
const dragonItems = ref<DragonTigerDetailItem[]>(
  dataCache.get<DragonTigerDetailItem[]>(DATA_CACHE_KEY.DRAGON_TIGER_ITEMS) ??
    [],
);
const isDragonLoading = ref(dragonItems.value.length === 0);
const dragonError = ref(false);

/** 拉取龙虎榜明细 */
const loadDragon = async (): Promise<void> => {
  isDragonLoading.value = true;
  dragonError.value = false;
  try {
    dragonItems.value = await fetchDragonTigerDetail();
    dataCache.set(DATA_CACHE_KEY.DRAGON_TIGER_ITEMS, dragonItems.value);
  } catch (error) {
    dragonError.value = dragonItems.value.length === 0;
    console.error("[dragon-tiger]", error);
  } finally {
    isDragonLoading.value = false;
  }
};

// ---------- 大宗交易（快照播种 + 成功写回） ----------
const blockItems = ref<BlockTradeDetailItem[]>(
  dataCache.get<BlockTradeDetailItem[]>(DATA_CACHE_KEY.BLOCK_TRADE_ITEMS) ?? [],
);
const isBlockLoading = ref(blockItems.value.length === 0);
const blockError = ref(false);

/** 拉取大宗交易明细 */
const loadBlock = async (): Promise<void> => {
  isBlockLoading.value = true;
  blockError.value = false;
  try {
    blockItems.value = await fetchBlockTradeDetail();
    dataCache.set(DATA_CACHE_KEY.BLOCK_TRADE_ITEMS, blockItems.value);
  } catch (error) {
    blockError.value = blockItems.value.length === 0;
    console.error("[block-trade]", error);
  } finally {
    isBlockLoading.value = false;
  }
};

// 初始拉取（两个重接口错峰：切 tab 时按需再拉）
const loadAll = async (): Promise<void> => {
  if (activeTab.value === "dragon-tiger" && dragonItems.value.length === 0) {
    await loadDragon();
  } else if (
    activeTab.value === "block-trade" &&
    blockItems.value.length === 0
  ) {
    await loadBlock();
  }
};

void loadAll();

watch(activeTab, () => {
  void loadAll();
});

/** 龙虎榜日期选项（从数据提取，倒序） */
const dragonDateOptions = computed(() => {
  const dates = [...new Set(dragonItems.value.map((item) => item.date))]
    .sort()
    .reverse();
  return dates.map((date) => ({ label: date, value: date }));
});

/** 大宗交易日期选项 */
const blockDateOptions = computed(() => {
  const dates = [...new Set(blockItems.value.map((item) => item.date))]
    .sort()
    .reverse();
  return dates.map((date) => ({ label: date, value: date }));
});

/** 选中的龙虎榜日期（默认最新一日） */
const dragonDate = ref<string>("");
const blockDate = ref<string>("");

// 数据到位后默认选中最新日期
watch(dragonDateOptions, (options) => {
  if (
    options.length > 0 &&
    !options.some((option) => option.value === dragonDate.value)
  ) {
    dragonDate.value = options[0].value;
  }
});
watch(blockDateOptions, (options) => {
  if (
    options.length > 0 &&
    !options.some((option) => option.value === blockDate.value)
  ) {
    blockDate.value = options[0].value;
  }
});

/** 选中日期 + 涨/跌方向的龙虎榜明细（懒加载） */
const dragonRowsFull = computed(() =>
  dragonItems.value.filter((item) => {
    if (dragonDate.value && item.date !== dragonDate.value) return false;
    const change = item.changePercent ?? 0;
    if (activeDirection.value === "up" && change <= 0) return false;
    if (activeDirection.value === "down" && change >= 0) return false;
    return true;
  }),
);
const {
  rows: dragonRows,
  total: dragonTotal,
  hasMore: dragonHasMore,
  onScroll: onDragonScroll,
} = useLazyRows<DragonTigerDetailItem>(
  () => dragonRowsFull.value,
  LIST_CHUNK_SIZE,
);

/** 选中日期的大宗明细（懒加载） */
const blockRowsFull = computed(() =>
  blockItems.value.filter(
    (item) => !blockDate.value || item.date === blockDate.value,
  ),
);
const {
  rows: blockRows,
  total: blockTotal,
  hasMore: blockHasMore,
  onScroll: onBlockScroll,
} = useLazyRows<BlockTradeDetailItem>(
  () => blockRowsFull.value,
  LIST_CHUNK_SIZE,
);

/** 龙虎榜表列配置（涨跌幅默认开启排序） */
const dragonColumns: TableColumn<DragonTigerDetailItem>[] = [
  { key: "name", label: "个股" },
  { key: "close", label: "收盘", align: "right" },
  {
    key: "changePercent",
    label: "涨跌幅",
    align: "right",
    sortable: true,
    sortValue: (item) => item.changePercent,
  },
  { key: "netBuyAmount", label: "龙虎榜净买额", align: "right" },
  { key: "netBuyRatio", label: "净买占比", align: "right" },
  { key: "reason", label: "上榜原因" },
  { key: "afterChange5d", label: "上榜后5日", align: "right" },
];

/** 大宗交易表列配置 */
const blockColumns: TableColumn<BlockTradeDetailItem>[] = [
  { key: "name", label: "个股" },
  { key: "dealPrice", label: "成交价", align: "right" },
  { key: "dealVolume", label: "成交量(万股)", align: "right" },
  {
    key: "dealAmount",
    label: "成交额",
    align: "right",
    sortable: true,
    sortValue: (item) => item.dealAmount,
  },
  { key: "premiumRate", label: "溢价率", align: "right" },
  { key: "buyBranch", label: "买方营业部" },
  { key: "sellBranch", label: "卖方营业部" },
];

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
    <!-- 视图切换：龙虎榜 / 大宗交易（与行情全景一致的 underline 风格） -->
    <div class="flex items-center justify-between gap-2">
      <BaseTabs v-model="activeTab" :options="VIEW_TAB_OPTIONS" variant="underline" />
      <span class="text-xs text-text-tertiary">近 7 日数据 · 按日期下拉切换</span>
    </div>
    <BaseCard>
      <!-- 龙虎榜 -->
      <template v-if="activeTab === 'dragon-tiger'">
        <div v-if="isDragonLoading"><BaseSkeleton /></div>
        <div v-else-if="dragonError" class="py-10">
          <BaseEmpty text="龙虎榜数据加载失败，请稍后重试" />
        </div>
        <template v-else-if="dragonItems.length > 0">
          <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div>
              <span class="text-xs text-text-tertiary mr-2">上榜日期</span>
              <select
                v-model="dragonDate"
                class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
              >
                <option
                  v-for="option in dragonDateOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
            <!-- 涨/跌按钮组（与板块热力「热力图/列表」同 BaseTabs 样式） -->
            <div>
              <span class="text-xs text-text-tertiary mr-2">共 {{ dragonRows.length }} 只上榜（总 {{ dragonTotal }}）</span>
              <BaseTabs
                v-model="activeDirection"
                :options="DIRECTION_TAB_OPTIONS"
              />
            </div>
          </div>
          <div @scroll="onDragonScroll">
            <BaseTable
              :columns="dragonColumns"
              :rows="dragonRows"
              :row-key="(item) => `${item.date}-${item.code}`"
              min-width="820px"
              row-clickable
              :footer-text="
                dragonHasMore
                  ? `已展示 ${dragonRows.length} / 共 ${dragonTotal}，继续滚动加载更多`
                  : undefined
              "
              @row-click="(item) => openDetail(item.code)"
            >
              <template #name="{ row }">
                <span class="font-medium text-text">{{ row.name }}</span>
                <span class="ml-1 text-xs text-text-tertiary">{{
                  row.code
                }}</span>
              </template>
              <template #close="{ row }">
                <span class="text-text-secondary">{{
                  formatPrice(row.close)
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
              <template #netBuyAmount="{ row }">
                <span
                  class="font-medium"
                  :class="
                    (row.netBuyAmount ?? 0) >= 0 ? 'text-up' : 'text-down'
                  "
                >
                  {{ formatYuanWithSign(row.netBuyAmount) }}
                </span>
              </template>
              <template #netBuyRatio="{ row }">
                <span class="text-text-secondary">{{
                  formatPercent(row.netBuyRatio)
                }}</span>
              </template>
              <template #reason="{ row }">
                <span
                  class="block max-w-56 truncate text-text-secondary"
                  :title="row.reason"
                >
                  {{ row.reason }}
                </span>
              </template>
              <template #afterChange5d="{ row }">
                <span
                  :class="
                    TREND_TEXT_CLASS[
                      getTrendByChangePercent(row.afterChange5d ?? 0)
                    ]
                  "
                >
                  {{
                    row.afterChange5d === null
                      ? "--"
                      : formatPercent(row.afterChange5d)
                  }}
                </span>
              </template>
            </BaseTable>
          </div>
        </template>
        <BaseEmpty v-else text="暂无龙虎榜数据" />
      </template>

      <!-- 大宗交易 -->
      <template v-else>
        <div v-if="isBlockLoading"><BaseSkeleton /></div>
        <div v-else-if="blockError" class="py-10">
          <BaseEmpty text="大宗交易数据加载失败，请稍后重试" />
        </div>
        <template v-else-if="blockItems.length > 0">
          <div class="mb-3 flex items-center gap-2">
            <span class="text-xs text-text-tertiary">交易日期</span>
            <select
              v-model="blockDate"
              class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
            >
              <option
                v-for="option in blockDateOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
            <span class="text-xs text-text-tertiary">共 {{ blockRows.length }} 笔（总 {{ blockTotal }}）</span>
          </div>
          <div @scroll="onBlockScroll">
            <BaseTable
              :columns="blockColumns"
              :rows="blockRows"
              :row-key="(item) => `${item.date}-${item.code}`"
              min-width="820px"
              row-clickable
              :footer-text="
                blockHasMore
                  ? `已展示 ${blockRows.length} / 共 ${blockTotal}，继续滚动加载更多`
                  : undefined
              "
              @row-click="(item) => openDetail(item.code)"
            >
              <template #name="{ row }">
                <span class="font-medium text-text">{{ row.name }}</span>
                <span class="ml-1 text-xs text-text-tertiary">{{
                  row.code
                }}</span>
              </template>
              <template #dealPrice="{ row }">
                <span class="text-text-secondary">{{
                  formatPrice(row.dealPrice)
                }}</span>
              </template>
              <template #dealVolume="{ row }">
                <span class="text-text-secondary">
                  {{
                    row.dealVolume === null
                      ? "--"
                      : (row.dealVolume / 10_000).toFixed(2)
                  }}
                </span>
              </template>
              <template #dealAmount="{ row }">
                <span
                  :class="
                    TREND_TEXT_CLASS[
                      getTrendByChangePercent(row.changePercent ?? 0)
                    ]
                  "
                >
                  {{ formatYuanWithSign(row.dealAmount) }}
                </span>
              </template>
              <template #premiumRate="{ row }">
                <span class="text-text-secondary">{{
                  formatPercent(row.premiumRate)
                }}</span>
              </template>
              <template #buyBranch="{ row }">
                <span
                  class="block max-w-52 truncate text-text-secondary"
                  :title="row.buyBranch"
                >
                  {{ row.buyBranch || "--" }}
                </span>
              </template>
              <template #sellBranch="{ row }">
                <span
                  class="block max-w-52 truncate text-text-secondary"
                  :title="row.sellBranch"
                >
                  {{ row.sellBranch || "--" }}
                </span>
              </template>
            </BaseTable>
          </div>
        </template>
        <BaseEmpty v-else text="暂无大宗交易数据" />
      </template>
    </BaseCard>
  </div>
</template>

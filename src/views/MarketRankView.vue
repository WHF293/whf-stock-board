<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import { useTabConfig } from '../composables/use-tab-config';
import type { TableColumn } from '../types/table.types';
import { sdk } from '../api/sdk';
import { usePolling } from '../composables/use-polling';
import { useDataCacheStore } from '../stores/data-cache';
import { useStockOpen } from '../composables/use-stock-open';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import {
  fetchFundFlowRank,
  fetchNorthboundHoldingRank,
  fetchSectorFundFlowRank,
} from '../api/flow.api';
import { fetchIndustryConstituents } from '../api/board.api';
import { getTrendByChangePercent } from '../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../constants/stock-colors.constants';
import { formatAmount } from '../utils/format-amount';
import { formatPercent, formatPercentUnsigned } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import { formatVolume } from '../utils/format-volume';
import { formatYuanWithSign } from '../utils/format-yuan';
import type { FullQuote } from '../types/stock-quote.types';
import type {
  FundFlowRankItem,
  NorthboundHoldingRankItem,
  SectorFundFlowItem,
} from '../types/flow.types';
import type { IndustryBoardConstituent } from '../types/board.types';
import { delay } from '../utils/delay';

/**
 * 市场榜单：全 A 股行情按指定列排序（涨跌幅 / 涨跌额 / 成交量 / 换手率），
 * 数据源 stock-sdk `getAllAShareQuotes`（上游东方财富 push2.eastmoney.com，代理通道）。
 *
 * 一次拉取全市场报价（约 5k+ 只），在前端按 sortKey 排序展示前 N 条；
 * 默认轮询 30 秒（与市场宽度一致）；行点击打开右侧个股详情
 */
const { openSidebar, openPage, toContextList } = useStockOpen();

/** 资金流表上下文列表（板块 tab 行非个股，给空列表走单只兜底） */
const flowContextList = computed(() =>
  sortKey.value === 'sector'
    ? []
    : toContextList(currentFlowItems.value, (row) => String(row.code)),
);
const dataCache = useDataCacheStore();

/** 列表展示条数（Top N） */
const DISPLAY_COUNT = 100;

/** 页签：前四个为全 A 报价排序榜，后三个为资金流榜单（自管数据） */
const SORT_TAB_OPTIONS = [
  { label: '涨幅榜', value: 'changePercent' },
  { label: '跌幅榜', value: 'changePercentDesc' },
  { label: '成交额榜', value: 'amount' },
  { label: '换手率榜', value: 'turnoverRate' },
  { label: '板块主力', value: 'sector' },
  { label: '个股主力', value: 'stock' },
  { label: '北向持股', value: 'north' },
] as const;

/** 页签值 */
type RankTab = (typeof SORT_TAB_OPTIONS)[number]['value'];

// 页签显隐 + 顺序可配置（持久化）；激活值被隐藏时自动回退首个可见 tab
const { visibleOptions: sortTabOptions, activeValue: sortKey } = useTabConfig<RankTab>(
  'market-rank',
  SORT_TAB_OPTIONS,
);

/** 是否为资金流榜单类页签 */
const isFlowTab = computed(() =>
  sortKey.value === 'sector' || sortKey.value === 'stock' || sortKey.value === 'north',
);

// 快照播种
const allQuotes = ref<FullQuote[]>(
  dataCache.get<FullQuote[]>(DATA_CACHE_KEY.MARKET_RANK_QUOTES) ?? [],
);
const isLoading = ref(allQuotes.value.length === 0);
const isError = ref(false);

/** 拉取全市场行情（轮询调用） */
const fetchAll = async (): Promise<void> => {
  try {
    const quotes = await sdk.batch.cn();
    allQuotes.value = quotes;
    dataCache.set(DATA_CACHE_KEY.MARKET_RANK_QUOTES, quotes);
    isError.value = false;
  } catch (error) {
    isError.value = allQuotes.value.length === 0;
    console.error('[market-rank]', error);
  } finally {
    isLoading.value = false;
  }
};

void fetchAll();

usePolling({
  task: fetchAll,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

// ---------- 资金流三榜单（板块主力 / 个股主力 / 北向持股；自管数据，进页拉一次） ----------
/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const FLOW_REQUEST_GAP_MS = 500;

/** 表格展示条数 */
const RANK_DISPLAY_COUNT = 15;

const sectorRank = ref<SectorFundFlowItem[]>(
  dataCache.get<SectorFundFlowItem[]>(DATA_CACHE_KEY.FUNDS_SECTOR_RANK) ?? [],
);
const stockRank = ref<FundFlowRankItem[]>(
  dataCache.get<FundFlowRankItem[]>(DATA_CACHE_KEY.FUNDS_STOCK_RANK) ?? [],
);
const northRank = ref<NorthboundHoldingRankItem[]>(
  dataCache.get<NorthboundHoldingRankItem[]>(DATA_CACHE_KEY.FUNDS_NORTH_RANK) ?? [],
);
const isFlowLoading = ref(false);
const flowError = ref(false);

// ---------- 板块主力扩展行：成分股 ----------
/** 已展开的板块 code 列表（BK 编号） */
const expandedSectorCodes = ref<string[]>([]);
/** 各板块成分股（BK 编号 -> 列表） */
const sectorConstituentsMap = ref<Record<string, IndustryBoardConstituent[]>>({});
/** 正在拉取成分股的板块 code */
const loadingSectorCode = ref<string | null>(null);

/**
 * 板块行 / 展开图标点击：切换扩展行，并按需拉取成分股
 * @param board 板块主力行
 */
const onSectorToggle = (board: SectorFundFlowItem): void => {
  expandedSectorCodes.value = expandedSectorCodes.value.includes(board.code)
    ? expandedSectorCodes.value.filter((code) => code !== board.code)
    : [...expandedSectorCodes.value, board.code];
  if (expandedSectorCodes.value.includes(board.code) && !sectorConstituentsMap.value[board.code]) {
    void loadSectorConstituents(board.code);
  }
};

const loadSectorConstituents = async (code: string): Promise<void> => {
  loadingSectorCode.value = code;
  try {
    const list = await fetchIndustryConstituents(code);
    sectorConstituentsMap.value = { ...sectorConstituentsMap.value, [code]: list };
  } catch (error) {
    console.error('[market-rank] sector constituents', error);
  } finally {
    loadingSectorCode.value = null;
  }
};

/** 成分股列配置 */
const sectorConstituentColumns: TableColumn<IndustryBoardConstituent>[] = [
  { key: 'name', label: '名称' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (stock) => stock.changePercent,
  },
  { key: 'amount', label: '成交额', align: 'right' },
];

/** 拉取资金流三榜单（串行错峰；成功写快照） */
const loadFlowRanks = async (): Promise<void> => {
  isFlowLoading.value = true;
  flowError.value = false;
  try {
    sectorRank.value = await fetchSectorFundFlowRank();
    dataCache.set(DATA_CACHE_KEY.FUNDS_SECTOR_RANK, sectorRank.value);
    await delay(FLOW_REQUEST_GAP_MS);
    stockRank.value = await fetchFundFlowRank();
    dataCache.set(DATA_CACHE_KEY.FUNDS_STOCK_RANK, stockRank.value);
    await delay(FLOW_REQUEST_GAP_MS);
    northRank.value = await fetchNorthboundHoldingRank();
    dataCache.set(DATA_CACHE_KEY.FUNDS_NORTH_RANK, northRank.value);
  } catch (error) {
    flowError.value = sectorRank.value.length === 0;
    console.error('[market-rank] flow', error);
  } finally {
    isFlowLoading.value = false;
  }
};

// 首次切到资金流页签时拉取（快照已有数据则跳过）
watch(isFlowTab, (active) => {
  if (active && sectorRank.value.length === 0 && !isFlowLoading.value) {
    void loadFlowRanks();
  }
});
void (async () => {
  // 首屏即处于资金流页签（如路由记忆）时补拉
  await delay(FLOW_REQUEST_GAP_MS);
  if (isFlowTab.value && sectorRank.value.length === 0) {
    void loadFlowRanks();
  }
})();

/**
 * 当前排序维度的可比数值（null 视为 -Infinity 排到末尾）
 * @param quote 个股报价
 * @returns 用于比较的数值
 */
const sortValueOf = (quote: FullQuote): number => {
  switch (sortKey.value) {
    case 'changePercent':
    case 'changePercentDesc':
      return quote.changePercent ?? 0;
    case 'amount':
      return quote.amount ?? 0;
    case 'turnoverRate':
      return quote.turnoverRate ?? 0;
    default:
      return 0;
  }
};

/** 按当前排序维度取前 N 条；涨跌幅榜按降序，跌幅榜按升序，其余按降序 */
const displayedRows = computed<FullQuote[]>(() => {
  const arr = [...allQuotes.value];
  const isDesc =
    sortKey.value === 'changePercent' ||
    sortKey.value === 'amount' ||
    sortKey.value === 'turnoverRate';
  arr.sort((a, b) => {
    const va = sortValueOf(a);
    const vb = sortValueOf(b);
    if (isDesc) return vb - va;
    return va - vb;
  });
  return arr.slice(0, DISPLAY_COUNT);
});

/** 当前资金流榜单数据 */
const currentFlowItems = computed<FlowRow[]>(() => {
  if (sortKey.value === 'sector') return sectorRank.value;
  if (sortKey.value === 'stock') return stockRank.value;
  return northRank.value;
});

/** 当前资金流榜单列配置（行对象按联合类型宽松消费） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FlowRow = any;

const currentFlowColumns = computed<TableColumn<FlowRow>[]>(() => {
  if (sortKey.value === 'sector') return sectorColumns;
  if (sortKey.value === 'stock') return stockColumns;
  return northColumns;
});

/** 表格列（按当前排序维度动态决定涨跌着色） */
const columns = computed<TableColumn<FullQuote>[]>(() => {
  return [
    { key: 'name', label: '个股' },
    {
      key: 'price',
      label: '最新价',
      align: 'right',
      sortable: false,
    },
    {
      key: 'changePercent',
      label: sortKey.value === 'changePercentDesc' ? '涨跌幅 ↓' : '涨跌幅',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.changePercent,
    },
    {
      key: 'change',
      label: '涨跌额',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.change,
    },
    {
      key: 'volume',
      label: '成交量',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.volume,
    },
    {
      key: 'amount',
      label: '成交额',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.amount,
    },
    {
      key: 'turnoverRate',
      label: '换手率',
      align: 'right',
      sortable: true,
      sortValue: (row) => row.turnoverRate,
    },
    { key: 'volumeRatio', label: '量比', align: 'right' },
    { key: 'pe', label: '市盈率', align: 'right' },
  ];
});

/** 板块主力排名列配置 */
const sectorColumns: TableColumn<SectorFundFlowItem>[] = [
  { key: 'name', label: '板块' },
  {
    key: 'changePercent',
    label: '涨跌幅',
    align: 'right',
    sortable: true,
    sortValue: (sector) => sector.changePercent,
  },
  { key: 'mainNetInflow', label: '主力净流入' },
];

/** 个股主力排名列配置 */
const stockColumns: TableColumn<FundFlowRankItem>[] = [
  { key: 'name', label: '个股' },
  { key: 'price', label: '现价', align: 'right' },
  {
    key: 'mainNetInflow',
    label: '主力净流入',
    sortable: true,
    sortValue: (stock) => stock.mainNetInflow,
  },
];

/** 北向持股排名列配置 */
const northColumns: TableColumn<NorthboundHoldingRankItem>[] = [
  { key: 'name', label: '个股' },
  { key: 'holdMarketValue', label: '持股市值', align: 'right' },
  { key: 'holdRatioFloat', label: '占流通比' },
];

/**
 * 个股代码跳详情（6 位纯代码 -> 完整符号）
 * @param code 个股 6 位代码
 */
const openDetail = (code: string): void => {
  openSidebar(code);
};

</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 排序维度切换（与行情全景一致的 underline 风格） -->
    <div class="flex shrink-0 items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <BaseTabs v-model="sortKey" :options="sortTabOptions" variant="underline" />
        <TabConfigButton page-id="market-rank" :options="SORT_TAB_OPTIONS" />
      </div>
      <span class="text-xs text-text-tertiary">
        共 {{ allQuotes.length }} 只 · 前 {{ displayedRows.length }} 名 · 30 秒自动刷新
      </span>
    </div>

    <!-- 资金流三榜单 -->
    <BaseCard v-if="isFlowTab" fill class="min-h-0 flex-1">
      <div v-if="isFlowLoading && currentFlowItems.length === 0"><BaseSkeleton /></div>
      <div v-else-if="flowError && currentFlowItems.length === 0" class="py-10">
        <BaseEmpty text="资金流榜单加载失败，请稍后重试" />
      </div>
      <BaseTable
        v-else-if="currentFlowItems.length > 0"
        :columns="currentFlowColumns"
        :rows="currentFlowItems.slice(0, RANK_DISPLAY_COUNT)"
        :row-key="(row: FlowRow) => String(row.code)"
        min-width="720px"
        scroll-class="table-scroll-fill"
        :row-clickable="sortKey !== 'sector'"
        :expandable="sortKey === 'sector'"
        :expanded-keys="expandedSectorCodes"
        :enable-dblclick-nav="true"
        @row-click="
          (row: FlowRow) =>
            sortKey !== 'sector' && openDetail(String(row.code))
        "
        @row-dblclick="(row) => sortKey !== 'sector' && openPage(String(row.code), flowContextList)"
        @toggle-expand="(row: FlowRow) => onSectorToggle(row as SectorFundFlowItem)"
      >
        <template #name="{ row }: { row: FlowRow }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span v-if="row.topStockName" class="block text-[10px] text-text-tertiary">{{ row.topStockName }}</span>
          <span v-else-if="row.code" class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #price="{ row }: { row: FlowRow }">
          <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]">
            {{ formatPrice(row.price) }}
          </span>
        </template>
        <template #changePercent="{ row }: { row: FlowRow }">
          <span
            class="rounded-full px-2 py-0.5 font-semibold"
            :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
          >
            {{ formatPercent(row.changePercent) }}
          </span>
        </template>
        <template #mainNetInflow="{ row }: { row: FlowRow }">
          <span
            class="font-medium"
            :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
          >
            {{ formatYuanWithSign(row.mainNetInflow) }}
          </span>
        </template>
        <template #holdMarketValue="{ row }: { row: FlowRow }">
          <span class="text-text-secondary">{{ formatYuanWithSign(row.holdMarketValue) }}</span>
        </template>
        <template #holdRatioFloat="{ row }: { row: FlowRow }">
          <span class="text-text-secondary">{{ formatPercentUnsigned(row.holdRatioFloat) }}</span>
        </template>

        <!-- 扩展行（仅板块主力）：成分股表格 -->
        <template v-if="sortKey === 'sector'" #expanded="{ row }: { row: FlowRow }">
          <div
            v-if="loadingSectorCode === String(row.code) && !sectorConstituentsMap[String(row.code)]"
            class="py-4"
          >
            <BaseSkeleton />
          </div>
          <BaseTable
            v-else-if="sectorConstituentsMap[String(row.code)]?.length"
            :columns="sectorConstituentColumns"
            :rows="sectorConstituentsMap[String(row.code)]"
            :row-key="(stock: IndustryBoardConstituent) => stock.code"
            min-width="560px"
            row-clickable
            @row-click="(stock: IndustryBoardConstituent) => openDetail(stock.code)"
            :enable-dblclick-nav="true"
            @row-dblclick="(stock) => openPage(stock.code, toContextList(sectorConstituentsMap[String(row.code)] ?? [], (item) => item.code))"
          >
            <template #name="{ row: stock }: { row: IndustryBoardConstituent }">
              <span class="font-medium text-text">{{ stock.name }}</span>
              <span class="ml-2 text-xs text-text-tertiary">{{ stock.code }}</span>
            </template>
            <template #price="{ row: stock }: { row: IndustryBoardConstituent }">
              <span
                :class="
                  TREND_TEXT_CLASS[getTrendByChangePercent(stock.changePercent ?? 0)]
                "
              >
                {{ formatPrice(stock.price) }}
              </span>
            </template>
            <template #changePercent="{ row: stock }: { row: IndustryBoardConstituent }">
              <span
                class="rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="
                  TREND_PILL_CLASS[getTrendByChangePercent(stock.changePercent ?? 0)]
                "
              >
                {{ formatPercent(stock.changePercent) }}
              </span>
            </template>
            <template #amount="{ row: stock }: { row: IndustryBoardConstituent }">
              <span class="text-text-secondary">{{ formatAmount(stock.amount) }}</span>
            </template>
          </BaseTable>
          <p v-else class="py-2 text-xs text-text-tertiary">暂无成分股数据</p>
        </template>
      </BaseTable>
      <BaseEmpty v-else text="暂无数据" />
    </BaseCard>

    <!-- 报价排序榜 -->
    <BaseCard v-else fill class="min-h-0 flex-1">
      <div v-if="isLoading && allQuotes.length === 0"><BaseSkeleton /></div>
      <div v-else-if="isError && allQuotes.length === 0" class="py-10">
        <BaseEmpty text="市场榜单加载失败，请稍后重试（上游可能限频或封禁）" />
      </div>
      <BaseTable
        v-else-if="displayedRows.length > 0"
        :columns="columns"
        :rows="displayedRows"
        :row-key="(row) => row.code"
        min-width="900px"
        scroll-class="table-scroll-fill"
        row-clickable
        @row-click="(row) => openDetail(row.code)"
        :enable-dblclick-nav="true"
        @row-dblclick="(row) => openPage(row.code, toContextList(displayedRows, (item) => item.code))"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
          <span class="ml-1 text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #price="{ row }">
          <span
            class="tabular-nums"
            :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
          >
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
        <template #change="{ row }">
          <span
            class="tabular-nums"
            :class="(row.change ?? 0) >= 0 ? 'text-up' : 'text-down'"
          >
            {{ row.change > 0 ? '+' : '' }}{{ formatPrice(row.change) }}
          </span>
        </template>
        <template #volume="{ row }">
          <span class="tabular-nums text-text-secondary">{{ formatVolume(row.volume) }}</span>
        </template>
        <template #amount="{ row }">
          <span class="tabular-nums text-text-secondary">{{ formatAmount(row.amount) }}</span>
        </template>
        <template #turnoverRate="{ row }">
          <span class="tabular-nums text-text-secondary">{{ formatPercentUnsigned(row.turnoverRate) }}</span>
        </template>
        <template #volumeRatio="{ row }">
          <span class="tabular-nums text-text-secondary">
            {{ row.volumeRatio === null ? '--' : row.volumeRatio.toFixed(2) }}
          </span>
        </template>
        <template #pe="{ row }">
          <span class="tabular-nums text-text-secondary">
            {{ row.pe === null ? '--' : row.pe.toFixed(2) }}
          </span>
        </template>
      </BaseTable>
      <BaseEmpty v-else text="暂无数据" />
    </BaseCard>
  </div>
</template>

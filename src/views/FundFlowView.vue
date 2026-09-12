<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTable from '../components/ui/BaseTable.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MarketFundFlowTrendChart from '../components/charts/MarketFundFlowTrendChart.vue';
import type { TableColumn } from '../types/table.types';
import {
  fetchFundFlowRank,
  fetchMarketFundFlow,
  fetchNorthboundHoldingRank,
  fetchSectorFundFlowRank,
} from '../api/flow.api';
import type {
  FundFlowRankItem,
  MarketFundFlow,
  NorthboundHoldingRankItem,
  SectorFundFlowItem,
} from '../types/flow.types';
import { delay } from '../utils/delay';
import { formatPercent, formatPercentUnsigned } from '../utils/format-percent';
import { formatPrice } from '../utils/format-price';
import { formatYuanWithSign } from '../utils/format-yuan';
import { useDataCacheStore } from '../stores/data-cache';
import { useDockPanelStore } from '../stores/dock-panel';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';
import { getTrendByChangePercent } from '../constants/trend.constants';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../constants/stock-colors.constants';

/**
 * 资金动向：大盘资金流 / 板块资金排名 / 个股主力排名 / 北向持股排名
 *
 * 四个均为东财重接口，进入页面时串行错峰拉取一次（不参与轮询）；
 * 数据先取内存快照秒出 UI，接口成功后写回快照并刷新显示
 */
const dockPanel = useDockPanelStore();
const dataCache = useDataCacheStore();

/** 各接口请求间隔（毫秒）：对同一上游串行错峰 */
const FLOW_REQUEST_GAP_MS = 500;

/** 表格展示条数 */
const RANK_DISPLAY_COUNT = 15;

/** 大盘资金流保留的交易日数（近 10 日） */
const MARKET_FLOW_DAYS = 10;

/** 大盘资金流展示形式：曲线（默认） / 列表 */
const MARKET_VIEW_MODE = {
  CHART: 'chart',
  TABLE: 'table',
} as const;

/** 大盘资金流展示形式按钮组选项 */
const MARKET_VIEW_MODE_OPTIONS = [
  { label: '曲线', value: MARKET_VIEW_MODE.CHART },
  { label: '列表', value: MARKET_VIEW_MODE.TABLE },
] as const;

/** 当前展示形式（局部状态，不持久化） */
const marketViewMode = ref<typeof MARKET_VIEW_MODE[keyof typeof MARKET_VIEW_MODE]>(
  MARKET_VIEW_MODE.CHART,
);

/** 大盘资金流视图高度（像素）：曲线与列表共用，避免切换时布局跳动 */
const MARKET_FLOW_VIEW_HEIGHT_PX = 400;

// 快照播种：切换回本页先展示上次数据
const cachedFlow = dataCache.get<MarketFundFlow[]>(DATA_CACHE_KEY.FUNDS_MARKET_FLOW);
const cachedSector = dataCache.get<SectorFundFlowItem[]>(DATA_CACHE_KEY.FUNDS_SECTOR_RANK);
const cachedStock = dataCache.get<FundFlowRankItem[]>(DATA_CACHE_KEY.FUNDS_STOCK_RANK);
const cachedNorth = dataCache.get<NorthboundHoldingRankItem[]>(DATA_CACHE_KEY.FUNDS_NORTH_RANK);

/** 大盘资金流（近 10 日，升序；上游全量历史在此截断收敛快照体积） */
const marketFlow = ref<MarketFundFlow[]>(
  (cachedFlow ?? []).slice(-MARKET_FLOW_DAYS),
);
/** 板块资金排名 */
const sectorRank = ref<SectorFundFlowItem[]>(cachedSector ?? []);
/** 个股主力排名 */
const stockRank = ref<FundFlowRankItem[]>(cachedStock ?? []);
/** 北向持股排名 */
const northRank = ref<NorthboundHoldingRankItem[]>(cachedNorth ?? []);
/** 首载中 */
const isLoading = ref(marketFlow.value.length === 0);
/** 首载是否全部失败 */
const isError = ref(false);

/** 拉取全部资金数据（串行错峰；成功后逐项写快照） */
const loadAll = async (): Promise<void> => {
  isLoading.value = true;
  isError.value = false;
  try {
    marketFlow.value = (await fetchMarketFundFlow()).slice(-MARKET_FLOW_DAYS);
    dataCache.set(DATA_CACHE_KEY.FUNDS_MARKET_FLOW, marketFlow.value);
    await delay(FLOW_REQUEST_GAP_MS);
    sectorRank.value = await fetchSectorFundFlowRank();
    dataCache.set(DATA_CACHE_KEY.FUNDS_SECTOR_RANK, sectorRank.value);
    await delay(FLOW_REQUEST_GAP_MS);
    stockRank.value = await fetchFundFlowRank();
    dataCache.set(DATA_CACHE_KEY.FUNDS_STOCK_RANK, stockRank.value);
    await delay(FLOW_REQUEST_GAP_MS);
    northRank.value = await fetchNorthboundHoldingRank();
    dataCache.set(DATA_CACHE_KEY.FUNDS_NORTH_RANK, northRank.value);
  } catch (error) {
    isError.value = marketFlow.value.length === 0;
    console.error('[fund-flow]', error);
  } finally {
    isLoading.value = false;
  }
};

// 进入页面拉取一次（重接口不轮询，避免触发上游反爬）
void loadAll();

/** 大盘资金流列配置 */
const marketColumns: TableColumn<MarketFundFlow>[] = [
  { key: 'date', label: '日期' },
  {
    key: 'mainNetInflow',
    label: '主力净流入',
    align: 'right',
    sortable: true,
    sortValue: (day) => day.mainNetInflow,
  },
  { key: 'mainNetInflowPercent', label: '主力占比', align: 'right' },
  { key: 'superLargeNetInflow', label: '超大单', align: 'right' },
  { key: 'largeNetInflow', label: '大单', align: 'right' },
  { key: 'smallNetInflow', label: '小单', align: 'right' },
];

/** 板块资金排名列配置 */
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

/** 大盘近 10 日数据（倒序展示） */
const marketFlowRows = computed(() => [...marketFlow.value].slice(-10).reverse());

/** 大盘近 10 日数据（升序，供折线图） */
const marketFlowAsc = computed(() => marketFlow.value.slice(-10));

/**
 * 个股代码跳详情（6 位纯代码 -> 完整符号）
 * @param code 个股 6 位代码
 */
const openDetail = (code: string): void => {
  dockPanel.openStock(code);
};
</script>

<template>
  <div class="space-y-4">
    <!-- 大盘资金流 -->
    <BaseCard title="大盘资金流（近10日）">
      <template #extra>
        <BaseTabs v-model="marketViewMode" :options="MARKET_VIEW_MODE_OPTIONS" />
      </template>
      <div v-if="isError" class="py-10">
        <BaseEmpty text="资金数据加载失败，请稍后重试（上游可能限频或封禁）" />
      </div>
      <BaseSkeleton v-else-if="isLoading && marketFlow.length === 0" />
      <template v-else-if="marketFlowRows.length > 0">
        <!-- 曲线视图 -->
        <div v-if="marketViewMode === MARKET_VIEW_MODE.CHART">
          <MarketFundFlowTrendChart :days="marketFlowAsc" :height="MARKET_FLOW_VIEW_HEIGHT_PX" />
        </div>
        <!-- 列表视图 -->
        <BaseTable
          v-else
          :columns="marketColumns"
          :rows="marketFlowRows"
          :row-key="(day) => day.date"
          scroll-class="table-scroll-sm"
        >
          <template #date="{ row }">
            <span class="text-text-secondary">{{ row.date.slice(5) }}</span>
          </template>
          <template #mainNetInflow="{ row }">
            <span
              class="font-medium"
              :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatYuanWithSign(row.mainNetInflow) }}
            </span>
          </template>
          <template #mainNetInflowPercent="{ row }">
            <span class="text-text-secondary">{{ formatPercent(row.mainNetInflowPercent) }}</span>
          </template>
          <template #superLargeNetInflow="{ row }">
            <span :class="(row.superLargeNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'">
              {{ formatYuanWithSign(row.superLargeNetInflow) }}
            </span>
          </template>
          <template #largeNetInflow="{ row }">
            <span :class="(row.largeNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'">
              {{ formatYuanWithSign(row.largeNetInflow) }}
            </span>
          </template>
          <template #smallNetInflow="{ row }">
            <span :class="(row.smallNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'">
              {{ formatYuanWithSign(row.smallNetInflow) }}
            </span>
          </template>
        </BaseTable>
      </template>
      <BaseEmpty v-else text="暂无数据" />
    </BaseCard>

    <div class="grid gap-4 @4xl:grid-cols-3">
      <!-- 板块资金排名 -->
      <BaseCard title="板块主力排名 Top15">
        <BaseSkeleton v-if="isLoading && sectorRank.length === 0" />
        <BaseTable
          v-else-if="sectorRank.length > 0"
          :columns="sectorColumns"
          :rows="sectorRank.slice(0, RANK_DISPLAY_COUNT)"
          :row-key="(sector) => sector.code"
          scroll-class="table-scroll-sm"
        >
          <template #name="{ row }">
            <span class="font-medium text-text">{{ row.name }}</span>
            <p v-if="row.topStockName" class="text-[10px] text-text-tertiary">{{ row.topStockName }}</p>
          </template>
          <template #changePercent="{ row }">
            <span
              class="rounded-full px-1.5 py-0.5 font-semibold"
              :class="TREND_PILL_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]"
            >
              {{ formatPercent(row.changePercent) }}
            </span>
          </template>
          <template #mainNetInflow="{ row }">
            <span
              class="font-medium"
              :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatYuanWithSign(row.mainNetInflow) }}
            </span>
          </template>
        </BaseTable>
        <BaseEmpty v-else text="暂无数据" />
      </BaseCard>

      <!-- 个股主力排名 -->
      <BaseCard title="个股主力排名 Top15">
        <BaseSkeleton v-if="isLoading && stockRank.length === 0" />
        <BaseTable
          v-else-if="stockRank.length > 0"
          :columns="stockColumns"
          :rows="stockRank.slice(0, RANK_DISPLAY_COUNT)"
          :row-key="(stock) => stock.code"
          scroll-class="table-scroll-sm"
          row-clickable
          @row-click="(stock) => openDetail(stock.code)"
        >
          <template #name="{ row }">
            <span class="font-medium text-text">{{ row.name }}</span>
            <span class="ml-1 text-[10px] text-text-tertiary">{{ row.code }}</span>
          </template>
          <template #price="{ row }">
            <span :class="TREND_TEXT_CLASS[getTrendByChangePercent(row.changePercent ?? 0)]">
              {{ formatPrice(row.price) }}
            </span>
          </template>
          <template #mainNetInflow="{ row }">
            <span
              class="font-medium"
              :class="(row.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatYuanWithSign(row.mainNetInflow) }}
            </span>
          </template>
        </BaseTable>
        <BaseEmpty v-else text="暂无数据" />
      </BaseCard>

      <!-- 北向持股排名 -->
      <BaseCard title="北向持股排名 Top15">
        <BaseSkeleton v-if="isLoading && northRank.length === 0" />
        <BaseTable
          v-else-if="northRank.length > 0"
          :columns="northColumns"
          :rows="northRank.slice(0, RANK_DISPLAY_COUNT)"
          :row-key="(stock) => stock.code"
          scroll-class="table-scroll-sm"
          row-clickable
          @row-click="(stock) => openDetail(stock.code)"
        >
          <template #name="{ row }">
            <span class="font-medium text-text">{{ row.name }}</span>
            <span class="ml-1 text-[10px] text-text-tertiary">{{ row.code }}</span>
          </template>
          <template #holdMarketValue="{ row }">
            <span class="text-text-secondary">{{ formatYuanWithSign(row.holdMarketValue) }}</span>
          </template>
          <template #holdRatioFloat="{ row }">
            <span class="text-text-secondary">{{ formatPercentUnsigned(row.holdRatioFloat) }}</span>
          </template>
        </BaseTable>
        <BaseEmpty v-else text="暂无数据" />
      </BaseCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import DistributionChart from '../components/charts/DistributionChart.vue';
import HeatmapChart from '../components/charts/HeatmapChart.vue';
import HeatmapBoardList from '../components/business/HeatmapBoardList.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import StockQuoteCard from '../components/business/StockQuoteCard.vue';
import {
  fetchAllMarketQuotes,
  fetchFullQuotes,
} from '../api/quotes.api';
import { fetchIndustryBoards } from '../api/board.api';
import { fetchMarketFundFlow } from '../api/flow.api';
import { usePolling } from '../composables/use-polling';
import {
  INDEX_SYMBOLS,
} from '../constants/index-symbols.constants';
import {
  HEATMAP_TOP_TAB_OPTIONS,
  HEATMAP_VIEW_MODE,
  HEATMAP_VIEW_MODE_OPTIONS,
} from '../constants/heatmap.constants';
import { POLLING_INTERVAL } from '../constants/polling.constants';
import { useHeatmapDrill } from '../composables/use-heatmap-drill';
import { useDockPanelStore } from '../stores/dock-panel';
import type { DistributionCount } from '../types/distribution.types';
import type {
  HeatmapBoard,
  IndustryBoard,
} from '../types/board.types';
import type { MarketFundFlow } from '../types/flow.types';
import type { FullQuote } from '../types/stock-quote.types';
import { formatAmount } from '../utils/format-amount';
import { formatYuanWithSign } from '../utils/format-yuan';
import { countDistribution } from '../utils/count-distribution';
import { delay } from '../utils/delay';
import { useSettingsStore } from '../stores/settings';
import { useDataCacheStore } from '../stores/data-cache';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';

/** 市场宽度各接口请求间隔（毫秒）：对同一上游串行错峰 */
const BREADTH_REQUEST_GAP_MS = 500;

/**
 * 市场总览：指数卡片（轮询，点击跳 K 线详情）+ 涨跌分布 / 资金速览 +
 * 板块热力（轮询，支持热力图 / 列表两种展示形式，下钻状态两视图共享；
 * 点击下钻成分股 → 点击个股跳详情）
 *
 * 数据先取内存快照秒出 UI，接口成功后写回快照并刷新显示
 *
 * 注：北向净买额已从资金速览移除——上游实时与历史口径均已停止披露（NET_DEAL_AMT 恒 null）
 */
const dockPanel = useDockPanelStore();
const settingsStore = useSettingsStore();
const dataCache = useDataCacheStore();

// 板块下钻状态机：热力图 / 列表两视图共享，切换展示形式不丢下钻位置
const { drillView, isDrillLoading, drillError, drillInto, backToBoards } = useHeatmapDrill();

/** Top 数量按钮组 v-model 适配：BaseTabs 要求字符串 value，设置项存 number */
const heatmapTopNModel = computed<string>({
  get: () => String(settingsStore.heatmapTopN),
  set: (value) => settingsStore.setHeatmapTopN(Number(value)),
});

/** 指数报价（快照播种） */
const indexQuotes = ref<FullQuote[]>([]);

/** 涨跌分布分桶计数 */
const distribution = ref<DistributionCount[]>([]);
/** 行业板块列表 */
const industryBoards = ref<IndustryBoard[]>([]);
/** 当日大盘资金流（取最新一条） */
const marketFundFlow = ref<MarketFundFlow | null>(null);
/** 两市成交额合计（万） */
const totalAmountWan = ref<number | null>(null);

/** 市场宽度快照结构 */
interface BreadthSnapshot {
  distribution: DistributionCount[];
  totalAmountWan: number;
  boards: IndustryBoard[];
  fundFlow: MarketFundFlow | null;
}

// 快照播种：切换回本页先展示上次数据
const cachedIndex = dataCache.get<FullQuote[]>(DATA_CACHE_KEY.DASHBOARD_INDEX_QUOTES);
if (cachedIndex) {
  indexQuotes.value = cachedIndex;
}
const cachedBreadth = dataCache.get<BreadthSnapshot>(DATA_CACHE_KEY.DASHBOARD_BREADTH);
if (cachedBreadth) {
  distribution.value = cachedBreadth.distribution;
  totalAmountWan.value = cachedBreadth.totalAmountWan;
  industryBoards.value = cachedBreadth.boards;
  marketFundFlow.value = cachedBreadth.fundFlow;
}

/** 拉取指数行情（成功后写快照） */
const fetchIndexQuotes = async (): Promise<void> => {
  indexQuotes.value = await fetchFullQuotes(INDEX_SYMBOLS);
  dataCache.set(DATA_CACHE_KEY.DASHBOARD_INDEX_QUOTES, indexQuotes.value);
};

/** 拉取市场宽度数据（全市场快照 + 板块 + 资金流；成功后写快照） */
const fetchMarketBreadth = async (): Promise<void> => {
  // 对同一上游（东财系）串行错峰请求，避免并发齐射触发反爬封禁
  const quotes = await fetchAllMarketQuotes();
  await delay(BREADTH_REQUEST_GAP_MS);
  const boards = await fetchIndustryBoards();
  await delay(BREADTH_REQUEST_GAP_MS);
  const flows = await fetchMarketFundFlow();

  distribution.value = countDistribution(quotes.map((quote) => quote.changePercent));
  totalAmountWan.value = quotes.reduce((acc, quote) => acc + (quote.amount ?? 0), 0);
  industryBoards.value = boards;
  marketFundFlow.value = flows.at(-1) ?? null;

  const snapshot: BreadthSnapshot = {
    distribution: distribution.value,
    totalAmountWan: totalAmountWan.value,
    boards: industryBoards.value,
    fundFlow: marketFundFlow.value,
  };
  dataCache.set(DATA_CACHE_KEY.DASHBOARD_BREADTH, snapshot);
};

usePolling({
  task: fetchIndexQuotes,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});
usePolling({
  task: fetchMarketBreadth,
  intervalMs: POLLING_INTERVAL.MARKET_BREADTH,
  tradingAware: true,
});

/** 板块热力数据：按总市值排序取用户设置的 Top N（保留完整字段供列表视图消费） */
const topBoards = computed<IndustryBoard[]>(() =>
  [...industryBoards.value]
    .filter((board) => board.changePercent !== null && board.totalMarketCap !== null)
    .sort((a, b) => (b.totalMarketCap ?? 0) - (a.totalMarketCap ?? 0))
    .slice(0, settingsStore.heatmapTopN),
);

/** 热力图 cell 视图模型（由 topBoards 映射） */
const heatmapBoards = computed<HeatmapBoard[]>(() =>
  topBoards.value.map((board) => ({
    code: board.code,
    name: board.name,
    changePercent: board.changePercent ?? 0,
    weight: board.totalMarketCap ?? 0,
  })),
);

/**
 * 点击指数卡跳 K 线详情
 *
 * ⚠️ 指数 FullQuote.code 为 6 位纯代码（如 000001），归一化后无法区分上证指数 /
 * 平安银行，故按 INDEX_SYMBOLS 下标还原完整符号（fetchFullQuotes 保持输入顺序）
 * @param index 指数在 INDEX_SYMBOLS 中的下标
 */
const onOpenIndexDetail = (index: number): void => {
  const symbol = INDEX_SYMBOLS[index];
  if (symbol) {
    dockPanel.openStock(symbol);
  }
};

/**
 * 热力图成分股点击跳 K 线详情（6 位纯代码归一化带市场前缀）
 * @param code 成分股 6 位代码
 */
const onOpenHeatmapStock = (code: string): void => {
  dockPanel.openStock(code);
};

/** 涨跌分布是否就绪（首次加载完成） */
const isDistributionReady = computed(() => distribution.value.length > 0);
</script>

<template>
  <div class="space-y-6">
    <!-- 指数卡片：点击跳 K 线详情 -->
    <div v-if="indexQuotes.length > 0" class="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
      <StockQuoteCard
        v-for="(quote, index) in indexQuotes"
        :key="quote.code"
        :quote="quote"
        clickable
        @click="onOpenIndexDetail(index)"
      />
    </div>
    <div v-else class="grid grid-cols-2 gap-4 @3xl:grid-cols-4">
      <BaseCard v-for="i in 4" :key="i"><BaseSkeleton /></BaseCard>
    </div>

    <!-- 涨跌分布 + 资金速览 -->
    <div class="grid gap-4 @3xl:grid-cols-3">
      <BaseCard title="涨跌分布" class="@3xl:col-span-2">
        <DistributionChart v-if="isDistributionReady" :data="distribution" />
        <BaseSkeleton v-else />
      </BaseCard>
      <BaseCard title="资金速览">
        <div v-if="totalAmountWan !== null" class="space-y-4">
          <div>
            <p class="text-xs text-text-tertiary">两市成交额</p>
            <p class="mt-1 text-xl font-semibold tabular-nums text-text">
              {{ formatAmount(totalAmountWan) }}
            </p>
          </div>
          <div>
            <p class="text-xs text-text-tertiary">主力净流入</p>
            <p
              class="mt-1 text-xl font-semibold tabular-nums"
              :class="(marketFundFlow?.mainNetInflow ?? 0) >= 0 ? 'text-up' : 'text-down'"
            >
              {{ formatYuanWithSign(marketFundFlow?.mainNetInflow) }}
            </p>
          </div>
        </div>
        <BaseSkeleton v-else />
      </BaseCard>
    </div>

    <!-- 板块热力 -->
    <BaseCard title="板块热力（按总市值加权）">
      <template #extra>
        <div class="flex flex-wrap items-center gap-2">
          <!-- 展示形式：热力图 / 列表 -->
          <BaseTabs v-model="settingsStore.heatmapViewMode" :options="HEATMAP_VIEW_MODE_OPTIONS" />
          <!-- Top 数量：两种展示形式下均生效 -->
          <BaseTabs v-model="heatmapTopNModel" :options="HEATMAP_TOP_TAB_OPTIONS" />
        </div>
      </template>
      <template v-if="topBoards.length > 0">
        <!-- 热力图形式 -->
        <HeatmapChart
          v-if="settingsStore.heatmapViewMode === HEATMAP_VIEW_MODE.HEATMAP"
          :boards="heatmapBoards"
          :drill-view="drillView"
          :is-drill-loading="isDrillLoading"
          :drill-error="drillError"
          @stock-click="onOpenHeatmapStock"
          @board-click="drillInto"
          @back="backToBoards"
        />
        <!-- 列表形式 -->
        <HeatmapBoardList
          v-else
          :boards="topBoards"
          :drill-view="drillView"
          :is-drill-loading="isDrillLoading"
          :drill-error="drillError"
          @stock-click="onOpenHeatmapStock"
          @board-click="drillInto"
          @back="backToBoards"
        />
      </template>
      <BaseSkeleton v-else />
    </BaseCard>
  </div>
</template>

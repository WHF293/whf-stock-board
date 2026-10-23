<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PanoramaSectorFlowBoard from '../components/business/PanoramaSectorFlowBoard.vue';
import RealtimeTurnoverCard from '../components/business/RealtimeTurnoverCard.vue';
import MarketFundFlowTrendChart from '../components/charts/MarketFundFlowTrendChart.vue';
import TurnoverTrendChart from '../components/charts/TurnoverTrendChart.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import { fetchMarketFundFlow } from '../../common/api/flow.api.ts';
import { fetchMarketTurnover } from '../../common/api/turnover.api.ts';
import { TURNOVER_CHART_METRIC, TURNOVER_RANGE_DEFAULT } from '../../common/constants/turnover.constants.ts';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { useDataCacheStore } from '../../common/stores/data-cache';
import type { MarketFundFlow } from '../../common/types/flow.types.ts';
import type { TurnoverDayItem } from '../../common/types/turnover.types.ts';

/**
 * 资金流向（原「板块资金流向」，2026-10-22 王总更名）：原「行情全景-最新板块资金」模块独立成页（2026-10-13，王总）
 *
 * 板块净流入榜单 + 行业资金曲面的渲染与数据逻辑全部在 PanoramaSectorFlowBoard
 * （自管数据 + 轮询）。2026-10-22 王总指定在其上方新增两行市场级图表（各 160px 高）：
 * - 行 1：实时成交额（RealtimeTurnoverCard compact，自管取数轮询）｜主力净流入（近 10 日，fetchMarketFundFlow）
 * - 行 2：历史成交量｜相对成交量（同一份成交额历史，TurnoverTrendChart 两种量纲口径）
 * 成交额历史为日频数据，进页拉一次 + dataCache 播种（与市场总览成交额模块同 key 共享快照）。
 */

/** 主力净流入图表窗口（交易日数）：与市场总览「主力净流入（近10日）」同口径 */
const MARKET_FLOW_WINDOW_DAYS = 10;

/** 新增两行图表的画布高度（px，王总指定） */
const FLOW_CHART_HEIGHT_PX = 160;

const dataCache = useDataCacheStore();

/** 主力净流入日频历史（升序；取数口径与市场总览一致） */
const marketFlowHistory = ref<MarketFundFlow[]>([]);
/** 成交额日频历史（升序；历史成交量 / 相对成交量两图共用） */
const turnoverHistory = ref<TurnoverDayItem[]>([]);
/** 主力净流入取数失败 */
const isFlowError = ref(false);
/** 成交额历史取数失败 */
const isTurnoverError = ref(false);

/** 历史成交量图数据窗口（近 10 日，与市场总览默认档一致） */
const amountDays = computed<TurnoverDayItem[]>(() =>
  turnoverHistory.value.slice(-TURNOVER_RANGE_DEFAULT),
);

/** 相对成交量图数据窗口（多取 1 天：首日无前值，图表内部 slice(1) 后恰为近 10 日） */
const relativeDays = computed<TurnoverDayItem[]>(() =>
  turnoverHistory.value.slice(-(TURNOVER_RANGE_DEFAULT + 1)),
);

/** 主力净流入图数据窗口（近 10 日） */
const marketFlowDays = computed<MarketFundFlow[]>(() =>
  marketFlowHistory.value.slice(-MARKET_FLOW_WINDOW_DAYS),
);

/** 拉取主力净流入历史（失败置错误态，图表卡内兜底空态） */
const loadMarketFlow = async (): Promise<void> => {
  try {
    const flows = await fetchMarketFundFlow();
    marketFlowHistory.value = flows;
    isFlowError.value = flows.length === 0;
  } catch (error) {
    console.error('[board-flow] 主力净流入取数失败', error);
    isFlowError.value = marketFlowHistory.value.length === 0;
  }
};

/** 拉取成交额历史（dataCache 快照播种秒出，成功后写回；与市场总览成交额模块同 key） */
const loadTurnover = async (): Promise<void> => {
  const cached = dataCache.get<TurnoverDayItem[]>(DATA_CACHE_KEY.DASHBOARD_TURNOVER);
  if (cached && cached.length > 0) {
    turnoverHistory.value = cached;
  }
  try {
    turnoverHistory.value = await fetchMarketTurnover();
    dataCache.set(DATA_CACHE_KEY.DASHBOARD_TURNOVER, turnoverHistory.value);
    isTurnoverError.value = turnoverHistory.value.length === 0;
  } catch (error) {
    console.error('[board-flow] 成交额历史取数失败', error);
    isTurnoverError.value = turnoverHistory.value.length === 0;
  }
};

onMounted(() => {
  void loadMarketFlow();
  void loadTurnover();
});
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4 overflow-y-auto">
    <!-- 行 1：实时成交额（compact 隐藏均值行）｜主力净流入（2026-10-22 王总指定新增） -->
    <div class="flex shrink-0 flex-wrap gap-4">
      <BaseCard title="实时成交额" class="min-w-[360px] flex-1">
        <div class="h-[160px]">
          <RealtimeTurnoverCard compact />
        </div>
      </BaseCard>
      <BaseCard title="主力净流入（近10日）" class="min-w-[360px] flex-1">
        <BaseEmpty v-if="isFlowError" text="资金数据加载失败，请稍后重试" />
        <BaseSkeleton v-else-if="marketFlowDays.length === 0" />
        <MarketFundFlowTrendChart
          v-else
          :days="marketFlowDays"
          :height="FLOW_CHART_HEIGHT_PX"
        />
      </BaseCard>
    </div>

    <!-- 行 2：历史成交量｜相对成交量（同一份成交额历史，两种量纲口径；2026-10-22 王总指定新增） -->
    <div class="flex shrink-0 flex-wrap gap-4">
      <BaseCard title="历史成交量" class="min-w-[360px] flex-1">
        <BaseEmpty v-if="isTurnoverError" text="成交额数据加载失败，请稍后重试" />
        <BaseSkeleton v-else-if="amountDays.length === 0" />
        <TurnoverTrendChart
          v-else
          :days="amountDays"
          :metric="TURNOVER_CHART_METRIC.AMOUNT"
          :height="FLOW_CHART_HEIGHT_PX"
        />
      </BaseCard>
      <BaseCard title="相对成交量" class="min-w-[360px] flex-1">
        <BaseEmpty v-if="isTurnoverError" text="成交额数据加载失败，请稍后重试" />
        <BaseSkeleton v-else-if="relativeDays.length === 0" />
        <TurnoverTrendChart
          v-else
          :days="relativeDays"
          :metric="TURNOVER_CHART_METRIC.RELATIVE"
          :height="FLOW_CHART_HEIGHT_PX"
        />
      </BaseCard>
    </div>

    <!-- 板块资金流入模块（页面主体，自管数据 + 轮询；上方两行挤占时保底 480px 高） -->
    <PanoramaSectorFlowBoard class="min-h-[480px] flex-1" />
  </div>
</template>

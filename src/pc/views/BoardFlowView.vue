<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PanoramaSectorFlowBoard from '../components/business/PanoramaSectorFlowBoard.vue';
import RealtimeTurnoverCard from '../components/business/RealtimeTurnoverCard.vue';
import MarketFundFlowTrendChart from '../components/charts/MarketFundFlowTrendChart.vue';
import NorthboundMinuteChart from '../components/charts/NorthboundMinuteChart.vue';
import TurnoverTrendChart from '../components/charts/TurnoverTrendChart.vue';
import NorthboundSummaryCard from '../components/business/northbound/NorthboundSummaryCard.vue';
import NorthboundFlowTrendCard from '../components/business/northbound/NorthboundFlowTrendCard.vue';
import NorthboundHoldingRankCard from '../components/business/northbound/NorthboundHoldingRankCard.vue';
import NorthboundIndividualDrawer from '../components/business/northbound/NorthboundIndividualDrawer.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import { useRowClamp } from '../../common/composables/use-row-clamp';
import { fetchMarketFundFlow } from '../../common/api/flow.api.ts';
import {
  fetchNorthboundMinute,
  fetchNorthboundSummary,
} from '../../common/api/northbound.api.ts';
import { fetchMarketTurnover } from '../../common/api/turnover.api.ts';
import { TURNOVER_CHART_METRIC, TURNOVER_RANGE_DEFAULT } from '../../common/constants/turnover.constants.ts';
import {
  NORTHBOUND_MINUTE_EMPTY_NOTICE,
  NORTHBOUND_POLLING_INTERVAL_MS,
} from '../../common/constants/northbound.constants.ts';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { usePolling } from '../../common/composables/use-polling';
import type { MarketFundFlow } from '../../common/types/flow.types.ts';
import type {
  NorthboundFlowSummary,
  NorthboundMinuteItem,
  NorthboundRankRow,
} from '../../common/types/northbound.types.ts';
import type { TurnoverDayItem } from '../../common/types/turnover.types.ts';

/**
 * 资金流向（原「板块资金流向」，2026-10-22 王总更名）：原「行情全景-最新板块资金」模块独立成页（2026-10-13，王总）
 *
 * 板块净流入榜单 + 行业资金曲面的渲染与数据逻辑全部在 PanoramaSectorFlowBoard
 * （自管数据 + 轮询）。2026-10-22 王总指定在其上方新增两行市场级图表（各 160px 高）：
 * - 行 1：实时成交额（RealtimeTurnoverCard compact，自管取数轮询）｜主力净流入（近 10 日，fetchMarketFundFlow）
 * - 行 2：历史成交量｜相对成交量（同一份成交额历史，TurnoverTrendChart 两种量纲口径）
 * 2026-10-30 王总指定新增沪深港通三行（stock-sdk northbound 能力）；同日王总指定：
 * 北向每日净买额经实测已无公开数据来源（日度持股披露同步停止），UI 收窄为南向口径：
 * - 行 3：南向资金汇总｜当日分时净流入（summary + minute 共用单个 60s tradingAware 轮询，
 *   一节拍 Promise.all 两请求，≤2 req/min 远低于东财红线；汇总卡只渲染南向两通道）
 * - 行 4：南向资金历史（范围切换，参数触发不轮询，自管数据）
 * - 行 5：北向持股排行（季度披露快照，进页一次；行尾「持仓」开个股持仓历史抽屉）
 * 2026-10-30 王总二次指定：①主力净流入 ↔ 当日分时净流入位置互换（分时上行 1、主力落行 3 右）；
 * ②参考市场总览指数卡片的 row-clamp 展开收起——收起只露行 1（实时成交额｜当日分时净流入），
 * 展开显示行 2~5（历史/相对成交量、南向汇总+主力净流入、资金历史、持股排行），
 * 板块分时净流入模块固定底部不参与折叠。
 * 成交额历史为日频数据，进页拉一次 + dataCache 播种（与市场总览成交额模块同 key 共享快照）。
 */

/** 主力净流入图表窗口（交易日数）：与市场总览「主力净流入（近10日）」同口径 */
const MARKET_FLOW_WINDOW_DAYS = 10;

/** 新增两行图表的画布高度（px，王总指定） */
const FLOW_CHART_HEIGHT_PX = 160;

/** 沪深港通分时图高度（px） */
const NORTHBOUND_MINUTE_CHART_HEIGHT_PX = 160;

const dataCache = useDataCacheStore();

// ---------- 顶部资金图表展开/收起（2026-10-30 王总指定，参考市场总览指数卡片） ----------
// 行 1~5 收进同一 row-clamp 裁剪容器：收起只露行 1（DOM 不卸载，数据/轮询不受影响）；
// 板块分时净流入模块在容器外固定底部，不随展开收起变化
const {
  setGridRef: setFlowRowsRef,
  isExpanded: isFlowExpanded,
  hasOverflow: hasFlowOverflow,
  clampStyle: flowClampStyle,
  toggle: toggleFlowExpanded,
} = useRowClamp();

/** 主力净流入日频历史（升序；取数口径与市场总览一致） */
const marketFlowHistory = ref<MarketFundFlow[]>([]);
/** 成交额日频历史（升序；历史成交量 / 相对成交量两图共用） */
const turnoverHistory = ref<TurnoverDayItem[]>([]);
/** 主力净流入取数失败 */
const isFlowError = ref(false);
/** 成交额历史取数失败 */
const isTurnoverError = ref(false);

/** 沪深港通资金汇总（四通道） */
const northboundSummary = ref<NorthboundFlowSummary[]>([]);
/** 沪深港通汇总是否首载（骨架屏） */
const isSummaryLoading = ref(true);

/** 南向汇总行（北向每日净买额停披露且无公开替代来源，仅展示南向两通道） */
const southboundSummary = computed(() =>
  northboundSummary.value.filter((row) => row.direction === '南向'),
);

/** 分时序列（方向固定南向） */
const minuteRows = ref<NorthboundMinuteItem[]>([]);

/** 分时是否首载（骨架屏） */
const isMinuteLoading = ref(true);

/** 分时非空点数（全空时展示口径空态） */
const minuteValidCount = computed(
  () => minuteRows.value.filter((row) => row.totalNetInflow !== null).length,
);

/** summary + minute 双请求（轮询单节拍体 / 手动刷新共用） */
const loadNorthboundRealtime = async (): Promise<void> => {
  const [summary, minute] = await Promise.all([
    fetchNorthboundSummary(),
    fetchNorthboundMinute('south'),
  ]);
  northboundSummary.value = summary;
  isSummaryLoading.value = false;
  minuteRows.value = minute;
  isMinuteLoading.value = false;
};

/** 单个 usePolling 节拍拉 summary + minute（60s tradingAware，卸载 / 切页自动停） */
usePolling({
  task: () => loadNorthboundRealtime(),
  intervalMs: NORTHBOUND_POLLING_INTERVAL_MS,
  tradingAware: true,
  market: 'A',
});

/** 手动刷新（汇总卡「刷新」按钮）：立即执行一次双请求（不与轮询节拍互斥，轻量） */
const refreshNorthboundRealtime = (): void => {
  void loadNorthboundRealtime().catch((error) => {
    console.error('[board-flow] 沪深港通实时资金刷新失败', error);
  });
};

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

/** 个股持仓历史抽屉 */
const isIndividualDrawerOpen = ref(false);
/** 抽屉标的（6 位纯代码） */
const individualSymbol = ref<string | null>(null);
/** 抽屉标的名称 */
const individualName = ref('');

/**
 * 打开个股北向持仓历史抽屉
 * @param row 排行行
 */
const openIndividualDrawer = (row: NorthboundRankRow): void => {
  individualSymbol.value = row.code;
  individualName.value = row.name;
  isIndividualDrawerOpen.value = true;
};

onMounted(() => {
  void loadMarketFlow();
  void loadTurnover();
});
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
    <!--
      顶部图表区（行 1~5）：收起只露行 1（实时成交额｜当日分时净流入），展开显示全部
      （2026-10-30 王总指定，参考市场总览指数卡片）。DOM 始终完整——收起不卸载，
      各卡数据与轮询不受折叠影响；「首行 = 行 1」由内层 flex-col 的确定性顺序保证
    -->
    <div class="row-clamp shrink-0" :style="flowClampStyle">
      <div :ref="setFlowRowsRef" class="flex flex-col gap-4">
        <!-- 行 1：实时成交额（compact 隐藏均值行）｜当日分时净流入（与主力净流入互换后上移收起态可见） -->
        <div class="flex flex-wrap gap-4">
          <BaseCard title="实时成交额" class="min-w-[360px] flex-1">
            <div class="h-[160px]">
              <RealtimeTurnoverCard compact />
            </div>
          </BaseCard>
          <BaseCard title="当日分时净流入（南向）" class="min-w-[360px] flex-1">
            <BaseSkeleton v-if="isMinuteLoading" class="h-[160px]" />
            <div v-else-if="minuteValidCount === 0" class="grid h-[160px] place-items-center">
              <p class="text-xs text-text-tertiary">{{ NORTHBOUND_MINUTE_EMPTY_NOTICE }}</p>
            </div>
            <NorthboundMinuteChart
              v-else
              :rows="minuteRows"
              :height="NORTHBOUND_MINUTE_CHART_HEIGHT_PX"
            />
          </BaseCard>
        </div>

        <!-- 行 2：历史成交量｜相对成交量（同一份成交额历史，两种量纲口径；2026-10-22 王总指定新增） -->
        <div class="flex flex-wrap gap-4">
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

        <!-- 行 3：南向资金汇总｜主力净流入（互换后主力落行 3 右，两卡等宽；单节拍轮询；北向无公开来源不展示） -->
        <div class="flex flex-wrap gap-4">
          <NorthboundSummaryCard
            class="min-w-[420px] flex-1"
            :summary="southboundSummary"
            :loading="isSummaryLoading"
            @refresh="refreshNorthboundRealtime"
          />
          <BaseCard title="主力净流入（近10日）" class="min-w-[420px] flex-1">
            <BaseEmpty v-if="isFlowError" text="资金数据加载失败，请稍后重试" />
            <BaseSkeleton v-else-if="marketFlowDays.length === 0" />
            <MarketFundFlowTrendChart
              v-else
              :days="marketFlowDays"
              :height="FLOW_CHART_HEIGHT_PX"
            />
          </BaseCard>
        </div>

        <!-- 行 4：南向资金历史（范围切换，参数触发不轮询；自管数据） -->
        <NorthboundFlowTrendCard />

        <!-- 行 5：北向持股排行（季度披露快照，进页一次；自管数据） -->
        <NorthboundHoldingRankCard @open-individual="openIndividualDrawer" />
      </div>
    </div>

    <!-- 展开/收起开关：首行之外还有内容才显示（-mt-3 收掉裁剪容器 12px 阴影呼吸位，与市场总览一致） -->
    <div v-if="hasFlowOverflow" class="-mt-3 flex justify-center">
      <button
        type="button"
        class="pressable rounded-full p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
        :aria-expanded="isFlowExpanded"
        aria-label="资金图表"
        :title="isFlowExpanded ? '收起图表' : '展开全部图表'"
        @click="toggleFlowExpanded"
      >
        <MenuIcon
          name="chevronDown"
          :size="16"
          class="transition-transform"
          :class="isFlowExpanded ? 'rotate-180' : ''"
        />
      </button>
    </div>

    <NorthboundIndividualDrawer
      v-model:open="isIndividualDrawerOpen"
      :symbol="individualSymbol"
      :name="individualName"
    />

    <!-- 板块资金流入模块（页面主体，自管数据 + 轮询；固定底部不参与上方折叠；上方各行挤占时保底 480px 高） -->
    <PanoramaSectorFlowBoard class="min-h-[480px] flex-1" />
  </div>
</template>

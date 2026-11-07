<script setup lang="ts">
import { computed, ref } from 'vue';
import DockResizer from '../DockResizer.vue';
import NorthboundEstimateCard from './NorthboundEstimateCard.vue';
import NorthboundFlowTrendCard from './NorthboundFlowTrendCard.vue';
import NorthboundHoldingRankCard from './NorthboundHoldingRankCard.vue';
import NorthboundIndividualDrawer from './NorthboundIndividualDrawer.vue';
import NorthboundNorthHistoryCard from './NorthboundNorthHistoryCard.vue';
import NorthboundSummaryCard from './NorthboundSummaryCard.vue';
import NorthboundMinuteChart from '../../charts/NorthboundMinuteChart.vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import {
  NORTHBOUND_MINUTE_EMPTY_NOTICE,
  NORTHBOUND_POLLING_INTERVAL_MS,
} from '../../../../common/constants/northbound.constants.ts';
import {
  fetchNorthboundMinute,
  fetchNorthboundSummary,
} from '../../../../common/api/northbound.api.ts';
import { useMutualSidebarStore } from '../../../../common/stores/mutual-sidebar';
import { usePolling } from '../../../../common/composables/use-polling';
import type {
  NorthboundFlowSummary,
  NorthboundMinuteItem,
  NorthboundRankRow,
} from '../../../../common/types/northbound.types.ts';

/**
 * 南北向资金侧边栏（资金流向页右侧，2026-11-06 王总指定）
 *
 * 资金流向页顶部「南北向资金」按钮开合；页面原有南北向模块全部迁入本栏：
 * 南向资金汇总 / 当日分时净流入（南向）/ 南向资金历史 / 北向持股排行，
 * 新增北向资金流向估算（季度差分）与北向资金历史（成交额口径）两卡。
 *
 * 数据自管：summary + minute 共用单个 60s tradingAware 轮询（一节拍 Promise.all
 * 两请求，≤2 req/min 远低于东财红线）——原页面轮询整体迁入，侧边栏收起（v-if
 * 卸载）即停，KeepAlive 切页由 usePolling 的生命周期钩子暂停。
 *
 * 宽度：DockResizer 拖拽调整（手柄骑左缘），store 持久化；个股持仓历史抽屉
 * 留在本栏内部（由持股排行行尾「持仓」触发，BaseDrawer 全局层叠不受栏宽影响）
 */

/** 沪深港通分时图高度（px，与原页面口径一致） */
const NORTHBOUND_MINUTE_CHART_HEIGHT_PX = 160;

const store = useMutualSidebarStore();

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
    console.error('[mutual-sidebar] 沪深港通实时资金刷新失败', error);
  });
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

/** 根元素引用（拖拽时取右缘坐标） */
const rootRef = ref<HTMLElement | null>(null);

/**
 * 拖拽调宽：鼠标 X 换算为侧边栏宽度（右缘 − 鼠标 X），store 内 clamp 并持久化
 * @param clientX 鼠标屏幕 X 坐标
 */
const onResize = (clientX: number): void => {
  const rect = rootRef.value?.getBoundingClientRect();
  if (!rect) return;
  store.setWidth(rect.right - clientX);
};
</script>

<template>
  <aside
    ref="rootRef"
    class="relative flex h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-2xl bg-surface shadow-island"
    :style="{ width: `${store.width}px` }"
  >
    <!-- 拖拽调宽手柄（骑左缘，长按 ≥120ms 进入拖拽，贯穿竖线由组件内 Teleport 渲染） -->
    <DockResizer :on-resize="onResize" />

    <!-- 标题行 -->
    <div class="flex h-12 shrink-0 items-center justify-between border-b border-flat-weak pl-4 pr-2">
      <span class="text-sm font-semibold text-text">南北向资金</span>
      <button
        type="button"
        class="pressable rounded-lg p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
        aria-label="收起南北向资金侧边栏"
        title="收起"
        @click="store.closeSidebar()"
      >
        <MenuIcon name="close" :size="16" />
      </button>
    </div>

    <!-- 模块堆叠（纵向一列，栏内自滚动；顺序：实时 → 估算 → 历史 → 持仓） -->
    <div class="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
      <NorthboundSummaryCard
        :summary="southboundSummary"
        :loading="isSummaryLoading"
        @refresh="refreshNorthboundRealtime"
      />

      <BaseCard title="当日分时净流入（南向）">
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

      <NorthboundEstimateCard />

      <NorthboundFlowTrendCard />

      <NorthboundNorthHistoryCard />

      <NorthboundHoldingRankCard @open-individual="openIndividualDrawer" />
    </div>

    <!-- 个股北向持仓历史抽屉（BaseDrawer 全局层叠，盖在侧边栏之上） -->
    <NorthboundIndividualDrawer
      v-model:open="isIndividualDrawerOpen"
      :symbol="individualSymbol"
      :name="individualName"
    />
  </aside>
</template>

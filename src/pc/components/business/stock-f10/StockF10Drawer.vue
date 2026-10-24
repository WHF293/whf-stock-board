<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import NoticeBar from '../../ui/NoticeBar.vue';
import StockFinancialTab from '../stock-financial/StockFinancialTab.vue';
import StockNewsPanel from '../StockNewsPanel.vue';
import EtfProfileCard from '../EtfProfileCard.vue';
import StockF10BaseInfoTab from './StockF10BaseInfoTab.vue';
import StockF10ExecutiveTab from './StockF10ExecutiveTab.vue';
import StockF10HoldTab from './StockF10HoldTab.vue';
import StockTradeRecordsTab from './StockTradeRecordsTab.vue';
import EtfHoldingsCard from '../EtfHoldingsCard.vue';
import { toFullSymbol } from '../../../../common/utils/to-full-symbol';
import { isEtfSymbol } from '../../../../common/utils/is-etf-symbol';
import { useDockPanelStore } from '../../../../common/stores/dock-panel';
import {
  ETF_F10_TAB_DEFAULT,
  ETF_F10_TAB_ORDER,
  F10_TAB_SOURCE_NOTICES,
  STOCK_F10_TAB_DEFAULT,
  STOCK_F10_TAB_OPTIONS,
  STOCK_F10_TAB_ORDER,
  type StockF10Tab,
} from '../../../../common/constants/stock-f10.constants.ts';

/**
 * 个股 F10（更多信息）抽屉（dock 内容组件，股票详情页顶栏「更多信息」按钮发起）
 *
 * 页签分组：财务 / 基金概况（随标的类型二选一，复用详情页已有组件）+
 * 资讯（复用）+ 四个新增页签（基本资料 / 发行相关 / 高管简介 / 参股控股，
 * 数据从东财 emh5 F10 静态页解析）+ 交易记录 / 成分股（2026-10-24 王总指定
 * 从详情页底部迁入）；来源标注（NoticeBar）渲染在页签行下方并随页签切换——
 * 不同页签数据来源不同（2026-10-24 王总指定，原常驻顶部）
 */
const props = defineProps<{
  /** 标的符号（sh600519 / 600519 等形态均可，内部归一化） */
  symbol: string;
  /** 标的名称（空时仅按符号展示） */
  name: string;
}>();

const dockPanel = useDockPanelStore();

/**
 * 成分股页签单击行：把抽屉切到该成分股（名称未知传空，标题回退符号展示）
 * @param next 成分股符号
 */
const switchDrawerStock = (next: string): void => {
  dockPanel.openF10(next, '');
};

/** 归一化符号 */
const normalized = computed<string>(() => toFullSymbol(String(props.symbol ?? '')));

/** 当前标的是否为场内基金（ETF / LOF，按代码段判定） */
const isEtf = computed<boolean>(() => isEtfSymbol(normalized.value));

/** 页签选项：场内基金用「基金概况」承接财务披露口径，普通股票展示「财务」 */
const tabOptions = computed(() => {
  const optionByValue = new Map<string, { label: string; value: StockF10Tab }>(
    STOCK_F10_TAB_OPTIONS.map((option) => [option.value, { label: option.label, value: option.value }]),
  );
  const order = isEtf.value ? ETF_F10_TAB_ORDER : STOCK_F10_TAB_ORDER;
  return order
    .map((value) => optionByValue.get(value))
    .filter((option) => option != null);
});

/** 当前页签（切换标的时重置为该类型默认页签） */
const tab = ref<StockF10Tab>(STOCK_F10_TAB_DEFAULT);

watch(
  normalized,
  () => {
    tab.value = isEtf.value ? ETF_F10_TAB_DEFAULT : STOCK_F10_TAB_DEFAULT;
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex size-full min-h-0 flex-col gap-2">
    <!-- 页签行（下划线式，与详情页底部页签同款） -->
    <BaseTabs
      v-model="tab"
      :options="tabOptions"
      variant="underline"
      aria-label="更多信息资料页签"
      class="shrink-0"
    />

    <!-- 来源公告条：随页签切换（各页签数据来源不同，2026-10-24 王总指定移到页签下方） -->
    <NoticeBar :text="F10_TAB_SOURCE_NOTICES[tab]" class="shrink-0" />

    <!-- 页签内容：切入才挂载拉数（与原详情页底部页签同口径） -->
    <div class="min-h-0 flex-1 overflow-y-auto">
      <StockFinancialTab v-if="tab === 'financial'" :symbol="normalized" />
      <EtfProfileCard v-else-if="tab === 'fund'" :symbol="normalized" />
      <StockNewsPanel v-else-if="tab === 'news'" :symbol="normalized" />
      <StockF10BaseInfoTab
        v-else-if="tab === 'baseInfo' || tab === 'publish'"
        :symbol="normalized"
        :section="tab === 'publish' ? 'publish' : 'baseInfo'"
      />
      <StockF10ExecutiveTab v-else-if="tab === 'executive'" :symbol="normalized" />
      <StockF10HoldTab v-else-if="tab === 'hold'" :symbol="normalized" />
      <!-- 交易记录 / 成分股：自详情页底部迁入（2026-10-24 王总指定），复用同款交互 -->
      <StockTradeRecordsTab v-else-if="tab === 'trade'" :symbol="normalized" />
      <EtfHoldingsCard
        v-else-if="tab === 'etf'"
        :symbol="normalized"
        @open="switchDrawerStock"
      />
    </div>
  </div>
</template>

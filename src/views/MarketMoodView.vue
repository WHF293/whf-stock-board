<script setup lang="ts">
import { computed } from 'vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import { useTabConfig } from '../composables/use-tab-config';
import MarketEventView from './MarketEventView.vue';
import DragonTigerView from './DragonTigerView.vue';

/**
 * 市场异动：涨停 / 异动 / 龙虎榜 / 大宗交易 四合一页面，
 * 页面级 underline tabs 与行情全景风格一致；
 * 龙虎榜 / 大宗共享 DragonTigerView（受控视图，内部切换隐藏）
 */

/** 页签选项 */
const MOOD_TAB_OPTIONS = [
  { label: '涨停', value: 'event' },
  { label: '异动', value: 'events' },
  { label: '龙虎榜', value: 'dragon-tiger' },
  { label: '大宗交易', value: 'block-trade' },
] as const;

// 页签显隐 + 顺序可配置（持久化）；激活值被隐藏时自动回退首个可见 tab
const { visibleOptions: moodTabOptions, activeValue: activeTab } = useTabConfig(
  'market-mood',
  MOOD_TAB_OPTIONS,
);

/** DragonTigerView 受控视图（event 页签时保持上次值即可，隐藏不销毁数据也无必要） */
const dragonTab = computed<'dragon-tiger' | 'block-trade'>(() =>
  activeTab.value === 'block-trade' ? 'block-trade' : 'dragon-tiger',
);
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 页面级切换（与行情全景一致的 underline 风格） -->
    <div class="flex shrink-0 items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <BaseTabs v-model="activeTab" :options="moodTabOptions" variant="underline" />
        <TabConfigButton page-id="market-mood" :options="MOOD_TAB_OPTIONS" />
      </div>
      <span class="text-xs text-text-tertiary">近 7 日数据 · 重接口不参与轮询</span>
    </div>

    <!-- 涨停（连板梯队 + 股池） -->
    <MarketEventView v-if="activeTab === 'event'" mode="zt" class="min-h-0 flex-1" />

    <!-- 异动（盘口异动 + 板块异动） -->
    <MarketEventView v-else-if="activeTab === 'events'" mode="events" class="min-h-0 flex-1" />

    <!-- 龙虎榜 / 大宗交易（受控视图） -->
    <DragonTigerView v-else v-model="dragonTab" class="min-h-0 flex-1" />
  </div>
</template>

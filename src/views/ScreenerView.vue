<script setup lang="ts">
import BaseTabs from '../components/ui/BaseTabs.vue';
import TabConfigButton from '../components/ui/TabConfigButton.vue';
import { useTabConfig } from '../composables/use-tab-config';
import BasicScreener from '../components/screener/BasicScreener.vue';
import EodPicker from '../components/screener/EodPicker.vue';
import SignalScanner from '../components/screener/SignalScanner.vue';

/**
 * 选股器：三种选股工具 tab 切换（参考 stock-dashboard）
 *
 * - 基础筛选：条件筛选（涨幅/换手/量比/PE）+ 简单回测
 * - 信号扫描：股票池（自选/板块/榜单/股池/异动）× 技术信号模板（MA/MACD/RSI/BOLL）
 * - 尾盘选股：全市场按市值/量比/涨幅/换手过滤后按分时强度精筛
 *
 * 全部为重接口，均由用户点击触发，不做轮询
 */

/** 工具 tab 选项 */
const TOOL_TABS = [
  { label: '基础筛选', value: 'basic' },
  { label: '信号扫描', value: 'scanner' },
  { label: '尾盘选股', value: 'eod' },
] as const;

/** 当前工具 tab */
// 页签显隐 + 顺序可配置（持久化）；激活值被隐藏时自动回退首个可见 tab
const { visibleOptions: toolTabOptions, activeValue: activeTool } = useTabConfig(
  'screener',
  TOOL_TABS,
);
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center gap-1">
      <BaseTabs v-model="activeTool" :options="toolTabOptions" variant="underline" />
      <TabConfigButton page-id="screener" :options="TOOL_TABS" />
    </div>

    <BasicScreener v-if="activeTool === 'basic'" />
    <SignalScanner v-else-if="activeTool === 'scanner'" />
    <EodPicker v-else />
  </div>
</template>

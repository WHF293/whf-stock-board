<script setup lang="ts">
import MarketStatusBadge from "../components/business/MarketStatusBadge.vue";
import HeaderItemHost from "../components/plugin/HeaderItemHost.vue";
import BaseTooltip from "../components/ui/BaseTooltip.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import { HOST_HEADER_ITEM } from "../constants/header.constants";
import type { HeaderRenderItem } from "../types/header.types";

/**
 * 应用顶栏工具条（市场状态徽标 + 明暗切换 / 搜索 / Agent / 白皮书 + 插件条目）
 *
 * 纯渲染组件：条目列表与全部动作由使用方（MainLayout）提供 ——
 * 同一份模板渲染在三个位置：浏览器是页面 header 右侧；Tauri 桌面端在自绘
 * TitleBar 的左侧工具位（#leading-tools：交易状态 / Agent）与右侧工具条
 * （#tools：明暗 / 搜索 / 白皮书 + 插件条目如盯盘），页面 header 为空。
 */
defineProps<{
  /** 顶栏渲染项：宿主自带项（按 id 分支）与插件条目（渲染 HeaderItemHost） */
  items: HeaderRenderItem[];
  /** 当前是否暗色模式（决定明暗切换按钮图标） */
  isDark: boolean;
}>();

defineEmits<{
  /** 切换明暗模式 */
  (event: 'toggle-theme'): void;
  /** 打开全局个股搜索弹窗 */
  (event: 'open-search'): void;
  /** 打开 Agent 分析（桌面开独立窗口 / 浏览器站内路由） */
  (event: 'open-agent'): void;
  /** 打开软件白皮书 */
  (event: 'open-whitepaper'): void;
}>();
</script>

<template>
  <div class="flex items-center gap-1.5">
    <template v-for="item in items" :key="item.key">
      <MarketStatusBadge v-if="item.id === HOST_HEADER_ITEM.MARKET_STATUS" />
      <button
        v-else-if="item.id === HOST_HEADER_ITEM.THEME"
        type="button"
        class="group relative pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90"
        :aria-label="isDark ? '切换为亮色模式' : '切换为暗色模式'"
        data-track="NAV_THEME_TOGGLE"
        @click="$emit('toggle-theme')"
      >
        <MenuIcon :name="isDark ? 'sun' : 'moon'" :size="16" />
        <BaseTooltip :text="isDark ? '切换为亮色模式' : '切换为暗色模式'" placement="bottom" />
      </button>
      <!-- 搜索：点击打开弹窗 -->
      <button
        v-else-if="item.id === HOST_HEADER_ITEM.SEARCH"
        type="button"
        class="group relative pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90"
        aria-label="搜索个股"
        data-track="NAV_SEARCH_OPEN"
        @click="$emit('open-search')"
      >
        <MenuIcon name="search" :size="16" />
        <BaseTooltip text="搜索个股" placement="bottom" />
      </button>
      <!-- Agent 分析：Tauri 开独立窗口，浏览器回退站内 standalone 路由 -->
      <button
        v-else-if="item.id === HOST_HEADER_ITEM.AGENT"
        type="button"
        class="group relative pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90"
        aria-label="Agent 分析"
        data-track="NAV_AGENT_OPEN"
        @click="$emit('open-agent')"
      >
        <MenuIcon name="agent" :size="16" />
        <BaseTooltip text="Agent 分析" placement="bottom" />
      </button>
      <!-- 软件白皮书：站内文档页，hover 提示用途 -->
      <button
        v-else-if="item.id === HOST_HEADER_ITEM.WHITEPAPER"
        type="button"
        class="group relative pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90"
        aria-label="软件白皮书"
        data-track="NAV_WHITEPAPER_OPEN"
        @click="$emit('open-whitepaper')"
      >
        <MenuIcon name="whitepaper" :size="16" />
        <BaseTooltip text="软件白皮书" placement="bottom" />
      </button>
      <!-- 插件贡献的顶栏条目：图标 + 单条轮播，点击展开下拉面板 -->
      <HeaderItemHost v-else-if="item.panel" :item="item.panel" />
    </template>
  </div>
</template>

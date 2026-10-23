<script setup lang="ts">
import { ref } from "vue";
import MarketStatusBadge from "../components/business/MarketStatusBadge.vue";
import HeaderItemHost from "../components/plugin/HeaderItemHost.vue";
import BaseTooltip from "../components/ui/BaseTooltip.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import { HOST_HEADER_ITEM } from "../../common/constants/header.constants.ts";
import type { HeaderRenderItem } from "../../common/types/header.types.ts";

/**
 * 应用顶栏工具条（市场状态徽标 + 明暗切换 / 搜索 / Agent / 软件文档 + 插件条目）
 *
 * 纯渲染组件：条目列表与全部动作由使用方（MainLayout）提供 ——
 * 同一份模板渲染在三个位置：浏览器是页面 header 右侧；Tauri 桌面端在自绘
 * TitleBar 的左侧工具位（#leading-tools：交易状态 / Agent）与右侧工具条
 * （#tools：明暗 / 搜索 / 软件文档 + 插件条目如盯盘），页面 header 为空。
 */
defineProps<{
  /** 顶栏渲染项：宿主自带项（按 id 分支）与插件条目（渲染 HeaderItemHost） */
  items: HeaderRenderItem[];
  /** 当前是否暗色模式（决定明暗切换按钮图标） */
  isDark: boolean;
}>();

const emit = defineEmits<{
  /** 切换明暗模式 */
  (event: 'toggle-theme'): void;
  /** 打开全局个股搜索弹窗 */
  (event: 'open-search'): void;
  /** 打开 Agent 分析（桌面开独立窗口 / 浏览器站内路由） */
  (event: 'open-agent'): void;
  /** 应用内打开官网「软件文档」（WebviewWindow / 新标签页） */
  (event: 'open-site-docs-in-app'): void;
  /** 系统默认浏览器打开官网「软件文档」 */
  (event: 'open-site-docs-in-browser'): void;
}>();

/** 软件文档打开方式气泡开关（点击书本图标切换，点外部 / 选中后收起） */
const docsMenuOpen = ref(false);

/**
 * 选中打开方式：上报对应动作并收起气泡
 * @param mode app = 应用内打开 / browser = 浏览器打开
 */
const onPickDocsMode = (mode: 'app' | 'browser'): void => {
  docsMenuOpen.value = false;
  if (mode === 'app') {
    emit('open-site-docs-in-app');
  } else {
    emit('open-site-docs-in-browser');
  }
};
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
      <!-- 软件文档：点击弹出打开方式气泡（应用内 / 浏览器），hover 提示用途 -->
      <div v-else-if="item.id === HOST_HEADER_ITEM.WHITEPAPER" class="relative">
        <button
          type="button"
          class="group relative pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90"
          :class="docsMenuOpen ? 'bg-flat-weak text-text' : ''"
          aria-label="软件文档"
          aria-haspopup="menu"
          :aria-expanded="docsMenuOpen"
          data-track="NAV_SITE_DOCS_OPEN"
          @click="docsMenuOpen = !docsMenuOpen"
        >
          <MenuIcon name="whitepaper" :size="16" />
          <BaseTooltip text="软件白皮书" placement="bottom" />
        </button>
        <!-- 打开方式气泡：点外部收起（透明遮罩） -->
        <div v-if="docsMenuOpen" class="fixed inset-0 z-40" @click="docsMenuOpen = false" />
        <div
          v-if="docsMenuOpen"
          class="absolute right-0 top-full z-50 mt-1.5 w-44 rounded-xl border border-flat-weak bg-surface p-1 shadow-[var(--shadow-card)]"
          role="menu"
        >
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text hover:bg-flat-weak"
            role="menuitem"
            @click="onPickDocsMode('app')"
          >
            <MenuIcon name="whitepaper" :size="14" class="shrink-0 text-text-secondary" />
            在应用内打开
          </button>
          <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-text hover:bg-flat-weak"
            role="menuitem"
            @click="onPickDocsMode('browser')"
          >
            <MenuIcon name="globe" :size="14" class="shrink-0 text-text-secondary" />
            在浏览器打开
          </button>
        </div>
      </div>
      <!-- 插件贡献的顶栏条目：图标 + 单条轮播，点击展开下拉面板 -->
      <HeaderItemHost v-else-if="item.panel" :item="item.panel" />
    </template>
  </div>
</template>

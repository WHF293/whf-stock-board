<script setup lang="ts">
import { useIntervalFn, onClickOutside, watchImmediate } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import MarketStatusBadge from "../components/business/MarketStatusBadge.vue";
import StockSearchInput from "../components/business/StockSearchInput.vue";
import DockPanel from "../components/dock/DockPanel.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import { useTheme } from "../composables/use-theme";
import { MARKET_STATUS_REFRESH_INTERVAL_MS } from "../constants/polling.constants";
import { MENU_ITEMS, ROUTE_PATH } from "../constants/router-meta.constants";
import { useDockPanelStore } from "../stores/dock-panel";
import { useMarketStatusStore } from "../stores/market-status";
import { useSettingsStore } from "../stores/settings";
import type { SearchResult } from "../types/stock-quote.types";

/**
 * 主布局：左侧导航（桌面固定 / 窄屏抽屉）+ 右侧路由内容区 + 右侧停靠面板（默认收起）
 *
 * 侧栏底部为设置入口（数据来源链接在设置页「数据获取」卡片内）；
 * 头部展示页面标题、交易时段徽标与明暗切换；
 * 挂载后刷新市场状态并每 10 分钟同步，供全部轮询消费
 */
const route = useRoute();
const { isDark, toggleDark } = useTheme();
const marketStatusStore = useMarketStatusStore();
const settingsStore = useSettingsStore();
const dockPanel = useDockPanelStore();

// 主题色写入 <html data-theme>（CSS 变量按属性覆盖，全站自动跟随）
watchImmediate(
  () => settingsStore.themeColor,
  (color) => {
    document.documentElement.dataset.theme = color;
  },
);

// 涨跌配色主题写入 <html data-trend>（文本类跟随变量，图表组件读变量重绘）
watchImmediate(
  () => settingsStore.trendTheme,
  (theme) => {
    document.documentElement.dataset.trend = theme;
  },
);

/** 头部页面标题（路由 meta.title） */
const pageTitle = computed(() => route.meta.title ?? "");

/** 窄屏抽屉侧栏开关（桌面端常驻显示，不受影响） */
const sidebarOpen = ref(false);

/** 头部搜索面板开关 */
const searchOpen = ref(false);

/** 搜索区域根元素（搜索按钮 + 面板）：点击区域外任意位置关闭面板 */
const searchAreaRef = ref<HTMLElement | null>(null);

// 点击搜索区域（按钮 + 面板）以外时收起面板
onClickOutside(searchAreaRef, () => {
  searchOpen.value = false;
});

// 路由切换后自动收起抽屉与搜索面板
watch(
  () => route.path,
  () => {
    sidebarOpen.value = false;
    searchOpen.value = false;
  },
);

/**
 * 展开/收起搜索面板
 */
const toggleSearch = (): void => {
  searchOpen.value = !searchOpen.value;
};

/**
 * 搜索面板按键处理：Esc 关闭
 * @param event 键盘事件
 */
const onSearchPanelKeydown = (event: KeyboardEvent): void => {
  if (event.key === 'Escape') {
    searchOpen.value = false;
  }
};

/**
 * 选中搜索结果：右侧面板打开个股详情并收起搜索
 * @param result 搜索结果
 */
const onHeaderSearchSelect = (result: SearchResult): void => {
  dockPanel.openStock(result.code);
  searchOpen.value = false;
};

/**
 * 菜单项是否激活（当前路由完全匹配或位于其子路径下）
 * @param path 菜单路径
 * @returns 是否激活
 */
const isActive = (path: string): boolean =>
  route.path === path || route.path.startsWith(`${path}/`);

useIntervalFn(
  () => marketStatusStore.refresh(),
  MARKET_STATUS_REFRESH_INTERVAL_MS,
);
// 分钟级时钟 tick：交易窗口（09:15-15:00 / 美股时段）边界到达时自动开停轮询
useIntervalFn(
  () => marketStatusStore.tick(),
  60_000,
);
// 挂载即刷新一次市场状态（store 内部已做错误降级）
void marketStatusStore.refresh();
</script>

<template>
  <div class="flex h-screen overflow-hidden">
    <!-- 窄屏抽屉遮罩 -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-black/40 lg:hidden"
      @click="sidebarOpen = false"
    />

    <!-- 左侧导航：窄屏为抽屉，桌面常驻 -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-56 shrink-0 transform flex-col border-r border-flat-weak bg-surface transition-transform duration-200 lg:static lg:z-auto lg:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'"
    >
      <div class="flex items-center gap-2 px-4 py-5">
        <span
          class="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-weak text-primary"
        >
          <MenuIcon name="funds" :size="18" />
        </span>
        <span class="text-base font-semibold text-text">股票看板</span>
      </div>
      <nav class="flex-1 space-y-1 overflow-y-auto px-2">
        <RouterLink
          v-for="item in MENU_ITEMS"
          :key="item.path"
          :to="item.path"
          class="pressable flex items-center gap-3 rounded-lg px-3 py-2 text-sm active:scale-[0.98]"
          :class="
            isActive(item.path)
              ? 'bg-primary-weak font-medium text-primary'
              : 'text-text-secondary hover:bg-flat-weak'
          "
        >
          <MenuIcon :name="item.icon" :size="16" />
          {{ item.title }}
        </RouterLink>
      </nav>
      <!-- 侧栏底部：数据来源（主题色强调）+ 设置入口 -->
      <div class="space-y-2 border-t border-flat-weak px-4 py-3">
        <RouterLink
          :to="ROUTE_PATH.SETTINGS"
          class="pressable flex items-center gap-2 rounded-lg px-1 py-1 text-xs active:scale-[0.98]"
          :class="
            isActive(ROUTE_PATH.SETTINGS)
              ? 'font-medium text-primary'
              : 'text-text-secondary hover:text-text'
          "
        >
          <MenuIcon name="settings" :size="14" />
          设置
        </RouterLink>
      </div>
    </aside>

    <!-- 右侧内容区 -->
    <div class="relative flex min-w-0 flex-1 flex-col">
      <header
        class="flex h-14 shrink-0 items-center justify-between border-b border-flat-weak bg-surface px-4 lg:px-6"
      >
        <div class="flex min-w-0 items-center gap-2">
          <button
            type="button"
            class="pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90 lg:hidden"
            aria-label="打开导航菜单"
            @click="sidebarOpen = true"
          >
            <MenuIcon name="menu" :size="18" />
          </button>
          <h1 class="truncate text-base font-semibold text-text">
            {{ pageTitle }}
          </h1>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <MarketStatusBadge />
          <button
            type="button"
            class="pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90"
            :aria-label="isDark ? '切换为亮色模式' : '切换为暗色模式'"
            @click="toggleDark()"
          >
            <MenuIcon :name="isDark ? 'sun' : 'moon'" :size="16" />
          </button>
          <!-- 搜索区域：按钮 + 浮层面板，点击区域外自动收起 -->
          <div ref="searchAreaRef" class="relative flex items-center">
            <button
              type="button"
              class="pressable rounded-lg p-2 text-text-secondary hover:bg-flat-weak active:scale-90"
              :class="searchOpen ? 'text-primary' : ''"
              :aria-label="searchOpen ? '关闭搜索' : '搜索个股'"
              @click="toggleSearch"
            >
              <MenuIcon :name="searchOpen ? 'close' : 'search'" :size="16" />
            </button>
            <div
              v-if="searchOpen"
              class="absolute right-0 top-full z-30 mt-2 w-80 max-w-[calc(100vw-2rem)]"
              @keydown="onSearchPanelKeydown"
            >
              <StockSearchInput auto-focus @select="onHeaderSearchSelect" />
            </div>
          </div>
        </div>
      </header>
      <main class="flex-1 overflow-y-auto">
        <div class="@container mx-auto w-full max-w-[1440px] p-4 lg:p-6">
          <RouterView />
        </div>
      </main>
    </div>

    <!-- 右侧停靠面板（个股详情等可插拔内容，默认收起；窄屏全屏覆盖） -->
    <DockPanel />
  </div>
</template>

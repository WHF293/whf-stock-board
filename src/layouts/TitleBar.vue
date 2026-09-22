<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { getCurrentWindow } from "@tauri-apps/api/window";
import MenuIcon from "../components/ui/MenuIcon.vue";
import { useSettingsStore } from "../stores/settings";
import { syncCloseToTray } from "../api/tray.api";
import { ROUTE_PATH } from "../constants/router-meta.constants";

/**
 * 自定义标题栏（仅 Tauri 桌面端由 MainLayout 渲染；浏览器无窗口概念，不渲染）
 *
 * 替代系统原生标题栏：左侧品牌区（logo + 名称，自侧栏顶部上移，点击回市场总览）+
 * 侧栏收起/展开开关（自侧栏顶部移此，panelLeft 形状）+ 左侧工具位
 * （`#leading-tools` slot：Agent 分析 / 交易状态徽标），右侧经 `#tools` slot 渲染
 * 其余顶栏工具（明暗切换 / 搜索 / 白皮书，由 MainLayout 传入），最右是自绘
 * 最小化 / 最大化 / 关闭按钮；颜色走应用主题 token（bg-surface 等），
 * 跟随应用内明暗模式，与系统主题解耦。
 *
 * 拖拽与双击最大化由 Tauri 注入脚本处理（元素须带 data-tauri-drag-region，
 * 且事件 target 是带属性的元素才生效——按钮与图标不带，不会误触发）：
 * - 按住拖动 = start_dragging，内部走 WM_NCLBUTTONDOWN/HTCAPTION，
 *   Windows 原生 Aero Snap（拖到屏幕边缘分屏、Win+方向键）完整保留；
 * - 双击 = internal_toggle_maximize（最大化 / 还原）。
 *
 * 已知取舍：Windows 11 悬停在最大化按钮上的「贴靠布局」弹窗（Snap Layouts
 * flyout）需要原生 HTMAXBUTTON 命中测试，自绘按钮给不了，双击最大化是替代。
 */

const appWindow = getCurrentWindow();
const settingsStore = useSettingsStore();

/** 切换侧栏收起 / 展开（持久化在 settings；原侧栏顶部按钮移入本栏） */
const toggleSidebar = (): void => {
  settingsStore.toggleSidebarCollapsed();
};

const router = useRouter();

/** 点击品牌区（logo / 股票看板）：回到市场总览 */
const goHome = (): void => {
  void router.push(ROUTE_PATH.DASHBOARD);
};

/** 是否处于最大化（决定最大化按钮显示 □ 还是还原图标） */
const isMaximized = ref(false);

/** resize 事件解除监听句柄（onResized 返回 Promise<UnlistenFn>） */
let unlistenResized: (() => void) | null = null;

/** 同步最大化状态（查询型 IPC，仅在挂载与 resize 回调里调用） */
const syncMaximized = (): void => {
  void appWindow
    .isMaximized()
    .then((value) => {
      isMaximized.value = value;
    })
    .catch(() => {
      /* 查询失败保持原值（非致命，仅影响按钮图标） */
    });
};

onMounted(() => {
  syncMaximized();
  // 把持久化的「关闭按钮最小化到托盘」设置同步给 Rust（启动时一次；此后设置页改动即时同步）
  void syncCloseToTray(settingsStore.closeToTray);
  void appWindow
    .onResized(() => {
      // 拖拽缩放会连续触发 resize，这里只做轻量查询同步按钮态
      syncMaximized();
    })
    .then((unlisten) => {
      unlistenResized = unlisten;
    });
});

onBeforeUnmount(() => {
  unlistenResized?.();
});

/** 最小化窗口 */
const minimizeWindow = (): void => {
  void appWindow.minimize();
};

/** 最大化 / 还原窗口 */
const toggleMaximizeWindow = (): void => {
  void appWindow.toggleMaximize();
};

/** 关闭窗口（与系统关闭按钮同生命周期） */
const closeWindow = (): void => {
  void appWindow.close();
};
</script>

<template>
  <div
    data-tauri-drag-region
    class="flex h-9 shrink-0 select-none items-center justify-between border-b border-flat-weak bg-surface pl-4"
  >
    <!-- 品牌区 + 侧栏开关：品牌点击回市场总览，拖拽窗口用标题栏其余空白区 -->
    <div class="flex min-w-0 items-center gap-1">
      <!-- 品牌区（logo + 名称）：点击回到市场总览；按钮不带 drag-region 属性，
           不会与窗口拖拽冲突（拖拽仍可用品牌区以外的标题栏空白区） -->
      <button
        type="button"
        class="flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 hover:bg-flat-weak"
        aria-label="回到市场总览"
        title="回到市场总览"
        data-track="NAV_BRAND_HOME"
        @click="goHome"
      >
        <img
          src="/favicon.svg"
          alt="股票看板"
          draggable="false"
          class="h-4 w-4 shrink-0 rounded"
        />
        <span class="truncate text-sm font-semibold text-text">股票看板</span>
      </button>
      <!-- 侧栏收起/展开开关（自侧栏顶部移入）：panelLeft 形状，与详情页信息栏开关同款 -->
      <button
        type="button"
        class="pressable flex shrink-0 items-center justify-center rounded-md p-1.5 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
        :aria-label="settingsStore.sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        :title="settingsStore.sidebarCollapsed ? '展开侧栏' : '收起侧栏'"
        data-track="NAV_SIDEBAR_TOGGLE"
        @click="toggleSidebar"
      >
        <MenuIcon name="panelLeft" :size="14" />
      </button>
      <!-- 开关后沿的左侧工具位：交易状态徽标 + Agent 分析（MainLayout 经 #leading-tools 传入） -->
      <slot name="leading-tools" />
    </div>

    <!-- 右侧：顶栏工具条（slot，MainLayout 传入）+ 窗口控制按钮。
         工具条按钮不带 drag-region 属性，点击不会误触发拖拽 -->
    <div class="flex h-full items-stretch">
      <div class="flex items-center pr-2">
        <slot name="tools" />
      </div>

      <!-- 窗口控制按钮：不带 drag-region 属性，点击/双击不会误触发拖拽或最大化 -->
      <div class="flex h-full items-stretch">
        <button
          type="button"
          aria-label="最小化"
          data-track="WINDOW_MINIMIZE"
          class="pressable flex w-11 items-center justify-center text-text-secondary hover:bg-flat-weak hover:text-text"
          @click="minimizeWindow"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1 6h10" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
        <button
          type="button"
          :aria-label="isMaximized ? '还原' : '最大化'"
          data-track="WINDOW_TOGGLE_MAXIMIZE"
          class="pressable flex w-11 items-center justify-center text-text-secondary hover:bg-flat-weak hover:text-text"
          @click="toggleMaximizeWindow"
        >
          <!-- 最大化：单框；还原：两错位框（右上前、左下后） -->
          <svg v-if="!isMaximized" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="1.5" y="1.5" width="9" height="9" rx="1" stroke="currentColor" stroke-width="1.2" fill="none" />
          </svg>
          <svg v-else width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <rect x="3.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2" fill="none" />
            <path d="M8.5 10.5h-7v-7" stroke="currentColor" stroke-width="1.2" fill="none" />
          </svg>
        </button>
        <button
          type="button"
          aria-label="关闭"
          data-track="WINDOW_CLOSE"
          class="pressable flex w-11 items-center justify-center text-text-secondary hover:bg-[#e81123] hover:text-white"
          @click="closeWindow"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

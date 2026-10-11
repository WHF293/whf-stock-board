<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Agent 分析独立窗口的自定义标题栏（decorations:false 后的替代，仅 standalone 渲染）
 *
 * 与主窗口 TitleBar 同款交互：data-tauri-drag-region 拖拽（Tauri 注入脚本处理，
 * 按钮不带该属性不会误触发）+ 双击最大化 + 自绘 最小化 / 最大化 / 关闭 三键；
 * 颜色走应用主题 token，跟随应用内明暗模式。
 *
 * 刻意不复用主窗口 TitleBar：它耦合品牌区（回市场总览）、侧栏开关、顶栏工具
 * slots、UpdateBadge 与「关闭到托盘」同步——这些对 Agent 独立窗口都没有意义。
 */

const appWindow = getCurrentWindow();

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

/** 关闭窗口 */
const closeWindow = (): void => {
  void appWindow.close();
};
</script>

<template>
  <div
    data-tauri-drag-region
    class="flex h-9 shrink-0 select-none items-center justify-between border-b border-flat-weak bg-surface pl-4"
  >
    <!-- 左：图标 + 标题（按钮不带 drag-region，拖拽用其余空白区） -->
    <div class="flex min-w-0 items-center gap-2" data-tauri-drag-region>
      <img
        src="/favicon.svg"
        alt="Agent 分析"
        draggable="false"
        class="h-4 w-4 shrink-0 rounded"
      />
      <span class="truncate text-sm font-semibold text-text">Agent 分析</span>
    </div>

    <!-- 右：窗口控制三键（与主窗口 TitleBar 同款 svg 与命中区） -->
    <div class="flex h-full items-stretch">
      <button
        type="button"
        aria-label="最小化"
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
        class="pressable flex w-11 items-center justify-center text-text-secondary hover:bg-[#e81123] hover:text-white"
        @click="closeWindow"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>
  </div>
</template>

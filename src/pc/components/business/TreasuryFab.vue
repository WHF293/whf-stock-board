<script setup lang="ts">
import MenuIcon from '../ui/MenuIcon.vue';
import { openTreasuryWindow } from '../../../common/utils/treasury-window';

/**
 * 「大A宝典」主窗口内兜底入口（仅浏览器开发态渲染）
 *
 * 演进：页内固钉胶囊 → icon 圆钮（页内可拖拽）→ **桌面横条独立窗口**
 * （2026-11-03 王总指定参考盯盘条形态：常驻屏幕、条内轮播祖训、点击开弹窗，
 * 见 src/widget/TreasuryBar.vue 与 MainLayout 的 ensureTreasuryBarWindow）。
 * Tauri 桌面端横条窗口接管后本组件不再渲染；浏览器开发模式保留一个
 * 右下角圆钮打开弹窗小窗（window.open 回退），保持开发体验一致。
 */
</script>

<template>
  <button
    type="button"
    class="pressable pc-nav-bubble pc-nav-bubble--primary fixed bottom-5 right-5 z-40 flex h-10 w-10 items-center justify-center rounded-full text-primary"
    aria-label="大A宝典"
    title="大A宝典 · 打开独立窗口"
    @click="openTreasuryWindow()"
  >
    <MenuIcon name="flame" :size="18" class="shrink-0" />
  </button>
</template>

<script setup lang="ts">
import type { Component } from 'vue';
import { useDocumentThemeSync } from '../composables/use-document-theme';

/**
 * 小组件根组件（独立窗口的 App 层）
 *
 * 主题落 <html>（暗色 class / data-theme / data-trend）必须在这里做而不是布局里：
 * 小组件是独立 app 实例，不经过 MainLayout；多窗口共享同一份 whf:app 整包，
 * 主窗口切换主题时本窗口经 storage 事件即时跟随（复用宿主同一份实现）。
 */
const props = defineProps<{
  /** 本次窗口承载的视图（盯盘条 / 气泡，由入口按路由参数选定） */
  view: Component;
}>();

useDocumentThemeSync();
</script>

<template>
  <component :is="props.view" />
</template>

<style>
/* 透明窗口：页面背景必须透出桌面，底色由条 / 气泡各自的根容器承担 */
html,
body,
#widget {
  background: transparent;
  overflow: hidden;
}
</style>

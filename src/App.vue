<script setup lang="ts">
import { onMounted } from 'vue';
import GlobalWatermark from './components/GlobalWatermark.vue';
import { initBoardCalendarSync } from './composables/use-board-calendar-sync';
import { useDocumentThemeSync } from './composables/use-document-theme';

/**
 * 根组件：路由视图 + 全局水印（设置页可开关）
 *
 * 启动钩子：
 * - 全局主题落 <html>（暗色 class / data-theme / data-trend）+ 跨窗口实时同步。
 *   必须在根组件做：独立 WebviewWindow（Agent 分析、新闻原文）不经过 MainLayout，
 *   在布局里做会导致新窗口回落亮色 + 默认涨跌色
 * - 板块日历采集（延迟执行、仅桌面端、异常全吞），见 use-board-calendar-sync
 */
useDocumentThemeSync();

onMounted(() => {
  initBoardCalendarSync();
});
</script>

<template>
  <RouterView />
  <GlobalWatermark />
</template>

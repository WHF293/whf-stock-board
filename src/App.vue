<script setup lang="ts">
import { onMounted } from 'vue';
import GlobalWatermark from './components/GlobalWatermark.vue';
import { initBoardCalendarSync } from './composables/use-board-calendar-sync';

/**
 * 根组件：路由视图 + 全局水印（设置页可开关）
 *
 * 启动钩子：板块日历采集（延迟执行、仅桌面端、异常全吞），见 use-board-calendar-sync
 */
onMounted(() => {
  initBoardCalendarSync();
});
</script>

<template>
  <RouterView />
  <GlobalWatermark />
</template>

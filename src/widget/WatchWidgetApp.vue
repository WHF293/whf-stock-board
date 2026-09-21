<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import type { Component } from 'vue';
import { listen } from '@tauri-apps/api/event';
import { useDocumentThemeSync } from '../composables/use-document-theme';
import { useTheme } from '../composables/use-theme';
import { useSettingsStore } from '../stores/settings';
import { WATCH_WIDGET_EVENTS } from '../plugins/watch-widget/constants';
import type { WatchWidgetThemePayload } from '../types/watch-widget.types';

/**
 * 小组件根组件（独立窗口的 App 层）
 *
 * 主题落 <html>（暗色 class / data-theme / data-trend）必须在这里做而不是布局里：
 * 小组件是独立 app 实例，不经过 MainLayout。初始主题读共享的 whf:app 整包；
 * **运行期跟随不走 storage 事件**（WebView2 跨窗口 storage 事件实测不可达），
 * 而是消费主窗口推送的 `watch-widget://theme` 事件（与行情数据同一条通道）。
 */
const props = defineProps<{
  /** 本次窗口承载的视图（盯盘条 / 气泡，由入口按路由参数选定） */
  view: Component;
}>();

useDocumentThemeSync();

const { isDark } = useTheme();
const settingsStore = useSettingsStore();

let unlistenTheme: (() => void) | undefined;

onMounted(() => {
  void (async () => {
    unlistenTheme = await listen<WatchWidgetThemePayload>(
      WATCH_WIDGET_EVENTS.THEME,
      (event) => {
        const { dark, theme, trend } = event.payload;
        if (dark !== isDark.value) isDark.value = dark;
        if (theme !== settingsStore.themeColor) settingsStore.themeColor = theme;
        if (trend !== settingsStore.trendTheme) settingsStore.trendTheme = trend;
      },
    );
  })();
});

onBeforeUnmount(() => {
  unlistenTheme?.();
});
</script>

<template>
  <component :is="props.view" />
</template>

<style>
/* 透明窗口：页面必须整页透明 + 撑满窗口（黑块 = 未覆盖区域被 theme.css 的
 * body 底色填充，因此这里用 id 选择器压过 `body { background-color }`）。
 * 底色由条 / 气泡各自的根容器绘制。 */
html,
#widget {
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}
body#watch-widget-page {
  height: 100%;
  margin: 0;
  overflow: hidden;
  background: transparent;
}
</style>

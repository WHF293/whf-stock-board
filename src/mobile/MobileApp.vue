<script setup lang="ts">
import { useDocumentThemeSync } from '../composables/use-document-theme';
import MobileTabBar from './components/MobileTabBar.vue';

// 主题三轴落 <html>（明暗 class / data-theme / data-trend），与桌面共用同一持久化；
// 设置 store 经 localStorage 整包共享，跨端切换后水合正确
useDocumentThemeSync();
</script>

<template>
  <div class="m-root">
    <!-- keep-alive：主 Tab 页在进出二级页（原文 / 设置 / 主题）时保活，
         返回后保留源 / 平台选中态与列表滚动位置；隐藏页轮询经 onDeactivated 停止 -->
    <router-view v-slot="{ Component }">
      <keep-alive>
        <component :is="Component" />
      </keep-alive>
    </router-view>
    <MobileTabBar />
  </div>
</template>

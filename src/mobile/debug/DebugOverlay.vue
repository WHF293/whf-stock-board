<script setup lang="ts">
import { ref } from 'vue';
import DebugFloatingBall from './DebugFloatingBall.vue';
import NetworkDebugPanel from './NetworkDebugPanel.vue';

/**
 * 调试覆盖层宿主（移动端专属）：悬浮球 + 网络请求面板
 *
 * 由 MobileApp 在调试模式开启时挂载（v-if），关闭调试模式整体卸载；
 * 放在 router-view 之外，任意页面（含 keep-alive 缓存页）都可见可开。
 */
const panelOpen = ref(false);
</script>

<template>
  <DebugFloatingBall @activate="panelOpen = true" />
  <NetworkDebugPanel v-model:show="panelOpen" />
</template>

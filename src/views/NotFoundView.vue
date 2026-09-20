<script setup lang="ts">
import { useRouter } from 'vue-router';
import BaseButton from '../components/ui/BaseButton.vue';
import { ROUTE_PATH } from '../constants/router-meta.constants';

/**
 * 404 兜底页：未匹配路径与已下线旧路径统一落这里，
 * 中间提供一键返回市场总览的入口
 */
const router = useRouter();

/** 返回市场总览（replace：404 路径不值得留在历史记录里） */
const goHome = (): void => {
  void router.replace(ROUTE_PATH.DASHBOARD);
};
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] flex-col items-center justify-center gap-3">
    <p class="text-5xl font-bold tabular-nums text-text-secondary">404</p>
    <p class="text-sm text-text-tertiary">该页面已停牌——路径不存在或已下线</p>
    <BaseButton class="mt-2" @click="goHome">返回市场总览</BaseButton>
  </div>
</template>

<script setup lang="ts">
import PanoramaSectorFlowBoard from '../components/business/PanoramaSectorFlowBoard.vue';

/**
 * 板块资金流向：原「行情全景-最新板块资金」模块独立成页（2026-10-13，王总）
 *
 * 板块净流入榜单 + 行业资金曲面的渲染与数据逻辑全部在 PanoramaSectorFlowBoard
 * （自管数据 + 轮询），本页只做全屏高度容器；行情全景内不再保留该模块。
 */
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col">
    <PanoramaSectorFlowBoard class="min-h-0 flex-1" />
  </div>
</template>

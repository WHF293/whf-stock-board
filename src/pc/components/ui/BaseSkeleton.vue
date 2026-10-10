<script setup lang="ts">
/**
 * 骨架屏：脉冲动画占位，默认提供三行文本形状，可用默认插槽自定义
 */
</script>

<template>
  <div class="animate-pulse space-y-3" aria-hidden="true">
    <slot>
      <div class="h-4 w-1/3 rounded bg-flat-weak" />
      <div class="h-3 w-2/3 rounded bg-flat-weak" />
      <div class="h-3 w-1/2 rounded bg-flat-weak" />
    </slot>
  </div>
</template>

<script setup lang="ts">
/**
 * 空态占位：一句引导文案
 */
withDefaults(
  defineProps<{
    /** 空态文案 */
    text?: string;
  }>(),
  { text: '暂无数据' },
);
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 py-10 text-text-tertiary">
    <svg
      width="36"
      height="36"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7h18l-1.5 12a2 2 0 0 1-2 1.8h-11a2 2 0 0 1-2-1.8z" />
      <path d="M8 10V6a4 4 0 0 1 8 0v4" />
    </svg>
    <p class="text-sm">{{ text }}</p>
  </div>
</template>

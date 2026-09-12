<script setup lang="ts">
/**
 * 基础卡片：圆角 + 卡片面 + 柔和阴影，可选标题与右侧 extra 插槽
 */
defineProps<{
  /** 卡片标题；不传且无 extra 插槽时不渲染头部 */
  title?: string;
}>();
</script>

<template>
  <section class="rounded-card bg-surface p-4 shadow-card">
    <header v-if="title || $slots.extra" class="mb-3 flex items-center justify-between gap-2">
      <h2 class="text-sm font-semibold text-text">{{ title }}</h2>
      <slot name="extra" />
    </header>
    <slot />
  </section>
</template>

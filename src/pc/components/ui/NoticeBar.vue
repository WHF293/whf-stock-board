<script setup lang="ts">
import MenuIcon from './MenuIcon.vue';

/**
 * 公告条：主色弱底提示条（图标 + 文案），用于设置页轮询规则等全局说明
 */
defineProps<{
  /** 公告文案 */
  text: string;
}>();
</script>

<template>
  <div
    class="flex items-start gap-2 rounded-lg bg-primary-weak px-3 py-2.5 text-xs leading-5 text-text-secondary"
    role="note"
  >
    <MenuIcon name="info" :size="14" class="mt-0.5 shrink-0 text-primary" />
    <p>{{ text }}</p>
  </div>
</template>

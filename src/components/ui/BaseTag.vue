<script setup lang="ts">
import { computed } from 'vue';

/**
 * 基础标签：弱色底胶囊
 */
const props = withDefaults(
  defineProps<{
    /** 标签色调 */
    tone?: 'primary' | 'up' | 'down' | 'flat';
  }>(),
  { tone: 'flat' },
);

/** 色调 -> 样式类名（弱色底 + 语义文字色） */
const TONE_CLASS = {
  primary: 'bg-primary-weak text-primary',
  up: 'bg-up-weak text-up',
  down: 'bg-down-weak text-down',
  flat: 'bg-flat-weak text-text-secondary',
} as const;

const toneClass = computed(() => TONE_CLASS[props.tone]);
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
    :class="toneClass"
  >
    <slot />
  </span>
</template>

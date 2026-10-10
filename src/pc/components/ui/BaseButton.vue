<script setup lang="ts">
import { computed } from 'vue';

/**
 * 基础按钮：主色 / 幽灵 / 危险三种变体
 */
const props = withDefaults(
  defineProps<{
    /** 按钮变体 */
    variant?: 'primary' | 'ghost' | 'danger';
    /** 是否禁用 */
    disabled?: boolean;
    /**
     * 原生 button type：
     * - button：普通按钮（默认，不触发表单 submit）
     * - submit：表单内提交按钮（form @submit 的触发源）
     * - reset：表单内重置按钮
     */
    type?: 'button' | 'submit' | 'reset';
  }>(),
  { variant: 'primary', disabled: false, type: 'button' },
);

/** 变体 -> 样式类名 */
const VARIANT_CLASS = {
  primary: 'bg-primary text-on-primary hover:opacity-90',
  ghost: 'bg-flat-weak text-text hover:bg-flat-weak/70',
  danger: 'bg-up-weak text-up hover:opacity-80',
} as const;

const variantClass = computed(() => VARIANT_CLASS[props.variant]);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="pressable inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    :class="variantClass"
  >
    <slot />
  </button>
</template>

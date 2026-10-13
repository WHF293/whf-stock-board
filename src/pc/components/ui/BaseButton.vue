<script setup lang="ts">
import { computed } from 'vue';

/**
 * 基础按钮：主色 / 幽灵 / 危险三种变体
 *
 * 2026-10-13 王总：三种变体统一改高光玻璃底（.pc-nav-bubble，含斜向光带 + 内高光 +
 * 磨砂），语义差异靠描边色 + 文字色区分——主色绿描边、危险红描边、幽灵无着色
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

/** 变体 -> 样式类名（玻璃底统一，语义色走描边 + 文字） */
const VARIANT_CLASS = {
  primary: 'pc-nav-bubble pc-nav-bubble--primary text-primary',
  ghost: 'pc-nav-bubble text-text',
  danger: 'pc-nav-bubble pc-nav-bubble--danger text-up',
} as const;

const variantClass = computed(() => VARIANT_CLASS[props.variant]);
</script>

<template>
  <button
    :type="type"
    :disabled="disabled"
    class="pressable inline-flex items-center justify-center gap-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium transition-transform duration-150 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:scale-100"
    :class="variantClass"
  >
    <slot />
  </button>
</template>

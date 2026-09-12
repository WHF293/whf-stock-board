<script setup lang="ts">
/**
 * 简易文本 tooltip：父元素 hover 时显示在父元素右侧垂直居中
 *
 * 适用于侧栏收起后的图标菜单（替代原生 title，美观且可控）；
 * 使用约束：父元素需带 class="group"（group-hover 触发显隐）
 */
defineProps<{
  /** 提示文本 */
  text: string;
}>();
</script>

<template>
  <span
    class="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs text-surface opacity-0 shadow-md transition-opacity group-hover:opacity-100"
    role="tooltip"
  >
    {{ text }}
  </span>
</template>

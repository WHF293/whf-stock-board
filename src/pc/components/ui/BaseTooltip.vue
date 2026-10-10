<script setup lang="ts">
import { computed } from "vue";

/**
 * 简易文本 tooltip：父元素 hover 时显示提示文本
 *
 * - 默认显示在父元素右侧垂直居中（侧栏收起后的图标菜单用）；
 * - placement="bottom" 显示在父元素下方水平居中（顶栏右侧图标用，避免向右溢出屏幕）；
 * 使用约束：父元素需带 class="group"（group-hover 触发显隐）且 position 非 static
 */
const props = defineProps<{
  /** 提示文本 */
  text: string;
  /** 弹出方位：right（默认，侧栏用）/ bottom（顶栏用） */
  placement?: "right" | "bottom";
}>();

/** 方位定位类（其余外观类两档共用） */
const placementClass = computed(() =>
  props.placement === "bottom"
    ? "left-1/2 top-full mt-2 -translate-x-1/2"
    : "left-full top-1/2 ml-2 -translate-y-1/2",
);
</script>

<template>
  <span
    class="pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs text-surface opacity-0 shadow-md transition-opacity group-hover:opacity-100"
    :class="placementClass"
    role="tooltip"
  >
    {{ text }}
  </span>
</template>

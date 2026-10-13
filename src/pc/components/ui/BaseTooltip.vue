<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";

/**
 * 简易文本 tooltip：父元素 hover 时显示提示文本
 *
 * - 默认显示在父元素右侧垂直居中（侧栏收起后的图标菜单用）；
 * - placement="bottom" 显示在父元素下方水平居中（顶栏右侧图标用，避免向右溢出屏幕）；
 *
 * 定位实现（2026-10-13 起）：tooltip **Teleport 到 body 用 fixed 定位**，挂载时监听
 * 父元素（锚点 span 的 parentElement）的 mouseenter / mouseleave 计算视口坐标。
 * 旧实现是纯 CSS group-hover + absolute，会被任意带 overflow 裁剪的滚动容器剪没
 * （侧栏收起态的 nav 有 overflow 裁剪，tooltip 整条不可见）——Teleport 后不受任何
 * overflow 影响。使用约束：本组件必须作为目标元素的子元素渲染（取 parentElement 定位）。
 */
const props = defineProps<{
  /** 提示文本 */
  text: string;
  /** 弹出方位：right（默认，侧栏用）/ bottom（顶栏用） */
  placement?: "right" | "bottom";
}>();

/** 锚点占位（零尺寸 span；parentElement 即挂目标元素） */
const anchor = ref<HTMLElement | null>(null);

/** 显隐与视口坐标（fixed 定位） */
const visible = ref(false);
const pos = ref({ x: 0, y: 0 });

/** 悬停目标元素（mouseenter / mouseleave 挂在它上面） */
let parent: HTMLElement | null = null;

/** 依据父元素实时位置计算 tooltip 坐标并显示 */
const show = (): void => {
  const el = parent;
  if (!el) return;
  const rect = el.getBoundingClientRect();
  pos.value =
    props.placement === "bottom"
      ? { x: rect.left + rect.width / 2, y: rect.bottom + 8 }
      : { x: rect.right + 8, y: rect.top + rect.height / 2 };
  visible.value = true;
};

const hide = (): void => {
  visible.value = false;
};

onMounted(() => {
  parent = anchor.value?.parentElement ?? null;
  parent?.addEventListener("mouseenter", show);
  parent?.addEventListener("mouseleave", hide);
});

onBeforeUnmount(() => {
  parent?.removeEventListener("mouseenter", show);
  parent?.removeEventListener("mouseleave", hide);
  parent = null;
});
</script>

<template>
  <span ref="anchor" class="hidden"></span>
  <Teleport to="body">
    <span
      class="pointer-events-none fixed z-50 whitespace-nowrap rounded-md bg-text px-2 py-1 text-xs text-surface shadow-md transition-opacity"
      :class="visible ? 'opacity-100' : 'opacity-0'"
      role="tooltip"
      :style="
        placement === 'bottom'
          ? { left: `${pos.x}px`, top: `${pos.y}px`, transform: 'translateX(-50%)' }
          : { left: `${pos.x}px`, top: `${pos.y}px`, transform: 'translateY(-50%)' }
      "
    >
      {{ text }}
    </span>
  </Teleport>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, type CSSProperties } from 'vue';

/**
 * 长文本 hover 气泡（承载被截断的完整描述）
 *
 * 与 BaseTooltip 的分工：
 * - BaseTooltip 是单行小标签（图标菜单用），absolute 定位在父元素内部，
 *   会被弹窗正文的 overflow-y-auto 裁剪，且 whitespace-nowrap 不换行；
 * - 本组件承载**长描述**：Teleport 到 body + position:fixed 定位，
 *   因此不受任何滚动容器裁剪，并自动换行限宽。
 *
 * 用法：直接替换原本承载文本的元素（as 指定标签名），截断类留在根上即可 ——
 * `<BaseTextTip as="p" class="truncate text-xs" :text="full">{{ full }}</BaseTextTip>`
 * 根元素带 overflow-hidden 也不影响气泡（气泡不在根元素的盒子里）。
 */
const props = withDefaults(
  defineProps<{
    /** 完整文本（空字符串不弹气泡） */
    text: string;
    /** 默认弹出方位；视口空间不足时自动翻到另一侧 */
    placement?: 'top' | 'bottom';
    /** 根元素标签名（默认 p，替换原承载元素即可保留其全部布局类） */
    as?: string;
  }>(),
  { placement: 'bottom', as: 'p' },
);

// 根元素需要承接调用方传的 class（truncate / text-xs 等），故手动绑定 $attrs
defineOptions({ inheritAttrs: false });

/** 气泡与触发元素的间距 */
const GAP = 8;
/** 气泡与视口边缘的最小留白 */
const MARGIN = 8;

const rootRef = ref<HTMLElement | null>(null);
const tipRef = ref<HTMLElement | null>(null);
const visible = ref(false);
const tipStyle = ref<CSSProperties>({});

/** 按触发元素位置算气泡坐标（下方空间不足则翻到上方） */
const reposition = (): void => {
  const trigger = rootRef.value;
  const tip = tipRef.value;
  if (!trigger || !tip) return;
  const rect = trigger.getBoundingClientRect();
  const { width, height } = tip.getBoundingClientRect();
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  let placement = props.placement;
  if (placement === 'bottom' && spaceBelow < height + GAP && spaceAbove > spaceBelow) {
    placement = 'top';
  } else if (placement === 'top' && spaceAbove < height + GAP && spaceBelow > spaceAbove) {
    placement = 'bottom';
  }
  const top = placement === 'bottom' ? rect.bottom + GAP : rect.top - height - GAP;
  // 水平居中于触发元素，再夹在视口内
  const centered = rect.left + rect.width / 2 - width / 2;
  const left = Math.min(Math.max(MARGIN, centered), window.innerWidth - width - MARGIN);
  tipStyle.value = { top: `${top}px`, left: `${left}px` };
};

/** 视口内任意滚动/缩放都收起：气泡是 fixed 定位，不跟随滚动会与触发元素错位 */
const hide = (): void => {
  visible.value = false;
  window.removeEventListener('scroll', hide, true);
  window.removeEventListener('resize', hide);
};

/** hover 显示：先挂全局监听（惰性），再等气泡渲染后量尺寸定位 */
const show = (): void => {
  if (!props.text) return;
  hide(); // 清掉可能残留的监听，避免重复挂载
  visible.value = true;
  window.addEventListener('scroll', hide, true);
  window.addEventListener('resize', hide);
  void nextTick(reposition);
};

onBeforeUnmount(() => {
  window.removeEventListener('scroll', hide, true);
  window.removeEventListener('resize', hide);
});
</script>

<template>
  <!-- data-text-tip 为语义标记：该元素 hover 会弹出完整文本（也便于 UI 冒烟精确定位） -->
  <component
    :is="as"
    ref="rootRef"
    data-text-tip
    v-bind="$attrs"
    @mouseenter="show"
    @mouseleave="hide"
  >
    <slot />
  </component>
  <!-- z-[60] 高于 BaseModal 的 z-50，且 pointer-events-none 不挡下层交互 -->
  <Teleport to="body">
    <div
      v-if="visible"
      ref="tipRef"
      class="pointer-events-none fixed z-[60] max-w-xs rounded-lg border border-flat-weak bg-surface px-3 py-2 text-left text-xs leading-relaxed break-words text-text-secondary shadow-xl"
      :style="tipStyle"
      role="tooltip"
    >
      {{ text }}
    </div>
  </Teleport>
</template>

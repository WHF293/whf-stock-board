<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useSlidingThumb } from "../../../common/composables/use-sliding-thumb";

/**
 * 标签页组件：v-model 选中值，选项驱动渲染
 *
 * - segmented（默认）：胶囊式分段控件（bg-flat-weak 容器 + 滑动玻璃气泡选中态——
 *   选中态玻璃质感挂在组内共享 thumb 层上，切换时气泡按移动端 TabBar 同款动画滑到新项，
 *   规格见 common/constants/sliding-thumb.constants.ts）
 * - underline：antd Tabs 风格（透明容器 + 底部下划线指示器 + 主色文字）
 */
const props = withDefaults(
  defineProps<{
    /** 选项列表（value 需唯一；groupStart 标记分组首项，在其前渲染组名标签与组间分隔线） */
    options: readonly {
      label: string;
      value: string;
      groupStart?: boolean;
      groupName?: string;
    }[];
    /** 视觉变体：segmented 胶囊 / underline 下划线（antd 风格） */
    variant?: "segmented" | "underline";
  }>(),
  { variant: "segmented" },
);

const model = defineModel<string>({ required: true });

/** segmented 容器（滑动气泡的定位父级） */
const containerRef = ref<HTMLElement | null>(null);

/** 激活项序号（驱动气泡位移；未匹配 = -1 气泡隐藏） */
const activeIndex = computed(() =>
  props.options.findIndex((option) => option.value === model.value),
);

const { thumbStyle, measure } = useSlidingThumb({
  container: containerRef,
  activeIndex,
});

// 选项列表变化（增删项）后重量取气泡几何
watch(
  () => props.options,
  () => {
    void nextTick(measure);
  },
  { flush: "post" },
);

/** 容器类名 */
const containerClass = computed(() => {
  if (props.variant === "underline") {
    // antd 风格：透明容器 + 底部 1px 分隔线（被激活 tab 的 2px 主色下划线覆盖）；
    // 父容器放不下所有子项时横向滚动
    return "flex overflow-y-hidden overflow-x-auto border-b border-flat-weak [scrollbar-width:thin]";
  }
  // relative：滑动气泡（absolute）的定位父级
  return "relative inline-flex max-w-full items-center gap-0.5 overflow-y-hidden overflow-x-auto rounded-lg bg-flat-weak p-0.5 [scrollbar-width:none]";
});

/**
 * 组名标签类名（分组首项前的小标签）
 *
 * underline 容器透明，标签加 bg-flat-weak 底色成 chip；segmented 容器本身
 * 就是 bg-flat-weak，标签只用文字色区分。
 * @returns 组名标签类名
 */
const groupLabelClass = (): string =>
  props.variant === "underline"
    ? "shrink-0 self-center whitespace-nowrap rounded bg-flat-weak px-1.5 py-0.5 text-xs text-text-tertiary"
    : "shrink-0 self-center whitespace-nowrap px-1 text-xs text-text-tertiary";

/**
 * tab 按钮类名
 * @param active 是否激活
 * @returns 类名数组
 */
const tabClass = (active: boolean): string[] => {
  if (props.variant === "underline") {
    return [
      // -mb-px 让 2px 边框覆盖容器的 1px 分隔线，激活态形成无缝连接的内容区；
      // shrink-0 + whitespace-nowrap：禁止压缩换行（否则文字竖排），超出由容器横向滚动
      "pressable shrink-0 whitespace-nowrap px-4 py-2.5 text-sm transition-colors -mb-px border-b-2",
      active
        ? "font-medium text-primary border-primary"
        : "border-transparent text-text-secondary hover:text-text",
    ];
  }
  return [
    // relative：让按钮叠在气泡层之上（气泡是 positioned 元素，按钮不抬层会被盖住）；
    // 选中态只留文字色，玻璃底由组内共享滑动气泡提供
    "pressable relative shrink-0 whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium active:scale-95",
    active ? "text-primary" : "text-text-secondary hover:text-text",
  ];
};
</script>

<template>
  <div ref="containerRef" :class="containerClass" role="tablist">
    <!-- 滑动玻璃气泡：选中态底座，切换时按移动端同款动画滑到新项 -->
    <span
      v-if="variant === 'segmented' && thumbStyle"
      class="pc-nav-bubble pointer-events-none absolute left-0 top-0 z-0 rounded-md"
      :style="thumbStyle"
    ></span>
    <!-- 分组首项：组名标签（groupName 有值时）+ 组间分隔竖线（首项无线）。
         用 span 而非 button——useSlidingThumb 按 ':scope > button' 取项集，
         非 button 节点不进索引，气泡几何量测不受影响 -->
    <template v-for="(option, index) in options" :key="option.value">
      <template v-if="option.groupStart">
        <span
          v-if="index > 0"
          class="mx-1 h-4 w-px shrink-0 self-center bg-flat-weak"
          aria-hidden="true"
        />
        <span v-if="option.groupName" :class="groupLabelClass()">
          {{ option.groupName }}
        </span>
      </template>
      <button
        type="button"
        role="tab"
        :aria-selected="model === option.value"
        :class="tabClass(model === option.value)"
        @click="model = option.value"
      >
        {{ option.label }}
      </button>
    </template>
  </div>
</template>

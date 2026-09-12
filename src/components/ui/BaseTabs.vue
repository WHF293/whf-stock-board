<script setup lang="ts">
import { computed } from 'vue';

/**
 * 标签页组件：v-model 选中值，选项驱动渲染
 *
 * - segmented（默认）：胶囊式分段控件（bg-flat-weak 容器 + 白色选中态）
 * - underline：antd Tabs 风格（透明容器 + 底部下划线指示器 + 主色文字）
 */
const props = withDefaults(
  defineProps<{
    /** 选项列表（value 需唯一） */
    options: readonly { label: string; value: string }[];
    /** 视觉变体：segmented 胶囊 / underline 下划线（antd 风格） */
    variant?: 'segmented' | 'underline';
  }>(),
  { variant: 'segmented' },
);

const model = defineModel<string>({ required: true });

/** 容器类名 */
const containerClass = computed(() => {
  if (props.variant === 'underline') {
    // antd 风格：透明容器 + 底部 1px 分隔线（被激活 tab 的 2px 主色下划线覆盖）
    return 'flex border-b border-flat-weak';
  }
  return 'inline-flex items-center gap-0.5 rounded-lg bg-flat-weak p-0.5';
});

/**
 * tab 按钮类名
 * @param active 是否激活
 * @returns 类名数组
 */
const tabClass = (active: boolean): string[] => {
  if (props.variant === 'underline') {
    return [
      // -mb-px 让 2px 边框覆盖容器的 1px 分隔线，激活态形成无缝连接的内容区
      'pressable px-4 py-2.5 text-sm transition-colors -mb-px border-b-2',
      active
        ? 'font-medium text-primary border-primary'
        : 'border-transparent text-text-secondary hover:text-text',
    ];
  }
  return [
    'pressable whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium active:scale-95',
    active
      ? 'bg-surface text-text shadow-sm'
      : 'text-text-secondary hover:text-text',
  ];
};
</script>

<template>
  <div :class="containerClass" role="tablist">
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      :class="tabClass(model === option.value)"
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

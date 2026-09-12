<script setup lang="ts">
/**
 * 分段切换标签组：v-model 选中值，选项驱动渲染，带按压动效
 */
defineProps<{
  /** 选项列表（value 需唯一） */
  options: readonly { label: string; value: string }[];
}>();

const model = defineModel<string>({ required: true });
</script>

<template>
  <div
    class="inline-flex items-center gap-0.5 rounded-lg bg-flat-weak p-0.5"
    role="tablist"
  >
    <button
      v-for="option in options"
      :key="option.value"
      type="button"
      role="tab"
      :aria-selected="model === option.value"
      class="pressable whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium active:scale-95"
      :class="
        model === option.value
          ? 'bg-surface text-text shadow-sm'
          : 'text-text-secondary hover:text-text'
      "
      @click="model = option.value"
    >
      {{ option.label }}
    </button>
  </div>
</template>

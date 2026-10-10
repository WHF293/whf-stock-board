<script setup lang="ts">
/**
 * 基础输入框（v-model 双向绑定）
 */
withDefaults(
  defineProps<{
    /** 占位文案 */
    placeholder?: string;
    /** 输入类型 */
    type?: string;
  }>(),
  { placeholder: '', type: 'text' },
);

const model = defineModel<string>({ default: '' });
</script>

<template>
  <input
    v-model="model"
    :type="type"
    :placeholder="placeholder"
    class="w-full rounded-lg bg-flat-weak px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-tertiary focus:ring-1 focus:ring-primary"
  />
</template>

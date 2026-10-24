<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import { fetchF10BaseInfo, fetchF10Publish } from '../../../../common/api/stock-f10.api.ts';
import type { F10KeyValue } from '../../../../common/types/stock-f10.types.ts';

/**
 * F10 键值对页签（基本资料 / 发行相关共用一个渲染组件，按 section 取数）
 *
 * 数据来自东财 emh5 F10 静态页解析（见 common/api/stock-f10.api.ts），
 * 基本资料含公司简介等长文本，按行渲染不截断
 */
const props = defineProps<{
  /** 标的符号（sh600519 / 600519 等形态均可） */
  symbol: string;
  /** 页签段：baseInfo = 基本资料 / publish = 发行相关 */
  section: 'baseInfo' | 'publish';
}>();

const loading = ref(false);
const failed = ref(false);
const items = ref<F10KeyValue[]>([]);

/**
 * 拉取当前页签数据（基本资料 / 发行相关同构，失败进 failed 分支可重试）
 * @param forceRefresh 跳过会话缓存强制回源
 */
const load = async (forceRefresh = false): Promise<void> => {
  loading.value = true;
  failed.value = false;
  try {
    items.value =
      props.section === 'baseInfo'
        ? await fetchF10BaseInfo(props.symbol, forceRefresh)
        : await fetchF10Publish(props.symbol, forceRefresh);
  } catch (error) {
    console.error('[stock-f10] key-values', error);
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

watch(
  () => [props.symbol, props.section] as const,
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="min-h-0">
    <BaseSkeleton v-if="loading" class="h-64" />
    <BaseEmpty v-else-if="failed" text="F10 数据拉取失败，请检查网络后重试">
      <template #extra>
        <button
          type="button"
          class="pressable text-xs text-primary hover:underline"
          @click="void load(true)"
        >
          重试
        </button>
      </template>
    </BaseEmpty>
    <BaseEmpty v-else-if="items.length === 0" text="暂无数据（该标的可能无此披露口径）" />
    <div v-else class="divide-y divide-flat-weak/50">
      <div v-for="(row, index) in items" :key="index" class="flex gap-3 py-2 first:pt-0 last:pb-0">
        <span class="w-24 shrink-0 text-xs leading-6 text-text-tertiary">{{ row.label }}</span>
        <span class="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm leading-6 text-text">
          {{ row.value || '--' }}
        </span>
      </div>
    </div>
  </div>
</template>

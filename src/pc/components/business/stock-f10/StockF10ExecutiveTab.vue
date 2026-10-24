<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import { fetchF10Executives } from '../../../../common/api/stock-f10.api.ts';
import type { F10Executive } from '../../../../common/types/stock-f10.types.ts';

/**
 * F10 高管简介页签（东财 emh5 BaseExecutive 静态页解析）
 *
 * 一位高管一张卡：姓名 + 任职时间 / 职务 / 性别 / 学历 / 年龄 + 履历正文
 */
const props = defineProps<{
  /** 标的符号（sh600519 / 600519 等形态均可） */
  symbol: string;
}>();

const loading = ref(false);
const failed = ref(false);
const items = ref<F10Executive[]>([]);

const load = async (forceRefresh = false): Promise<void> => {
  loading.value = true;
  failed.value = false;
  try {
    items.value = await fetchF10Executives(props.symbol, forceRefresh);
  } catch (error) {
    console.error('[stock-f10] executives', error);
    failed.value = true;
  } finally {
    loading.value = false;
  }
};

watch(
  () => props.symbol,
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
    <BaseEmpty v-else-if="items.length === 0" text="暂无高管信息" />
    <div v-else class="space-y-2.5">
      <div
        v-for="person in items"
        :key="`${person.name}-${person.appointDate}-${person.position}`"
        class="rounded-lg border border-flat-weak px-3 py-2.5"
      >
        <div class="flex items-baseline justify-between gap-2">
          <span class="text-sm font-semibold text-text">{{ person.name || '--' }}</span>
          <span class="shrink-0 text-xs text-text-tertiary">任职 {{ person.appointDate || '--' }}</span>
        </div>
        <div class="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-text-secondary">
          <span>职务：{{ person.position || '--' }}</span>
          <span>性别：{{ person.gender || '--' }}</span>
          <span>学历：{{ person.education || '--' }}</span>
          <span>年龄：{{ person.age || '--' }}</span>
        </div>
        <p
          v-if="person.intro"
          class="mt-2 whitespace-pre-wrap break-words border-t border-flat-weak/60 pt-2 text-xs leading-5 text-text-secondary"
        >
          {{ person.intro }}
        </p>
      </div>
    </div>
  </div>
</template>

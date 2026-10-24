<script setup lang="ts">
import { ref, watch } from 'vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import { fetchF10HoldRows } from '../../../../common/api/stock-f10.api.ts';
import type { F10HoldRow } from '../../../../common/types/stock-f10.types.ts';

/**
 * F10 参股控股页签（东财 emh5 BaseHold 静态页解析）
 *
 * 三列表格：被参股企业名称 / 注册资本 / 集团持股比例(%)
 */
const props = defineProps<{
  /** 标的符号（sh600519 / 600519 等形态均可） */
  symbol: string;
}>();

const loading = ref(false);
const failed = ref(false);
const rows = ref<F10HoldRow[]>([]);

const load = async (forceRefresh = false): Promise<void> => {
  loading.value = true;
  failed.value = false;
  try {
    rows.value = await fetchF10HoldRows(props.symbol, forceRefresh);
  } catch (error) {
    console.error('[stock-f10] hold-rows', error);
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
    <BaseEmpty v-else-if="rows.length === 0" text="暂无参股控股数据" />
    <template v-else>
      <!-- 表头（sticky 随滚动） -->
      <div
        class="sticky top-0 z-[1] flex items-center gap-3 border-b border-flat-weak bg-surface px-2 pb-1.5 text-xs text-text-tertiary"
      >
        <span class="flex-1">被参股企业名称</span>
        <span class="w-28 text-right">注册资本</span>
        <span class="w-20 text-right">持股比例(%)</span>
      </div>
      <div class="min-h-0">
        <div
          v-for="row in rows"
          :key="row.companyName"
          class="flex items-center gap-3 border-b border-flat-weak/50 px-2 py-1.5 text-sm last:border-0 hover:bg-flat-weak/40"
        >
          <span class="min-w-0 flex-1 break-words text-text">{{ row.companyName }}</span>
          <span class="w-28 shrink-0 text-right text-text-secondary tabular-nums">
            {{ row.registeredCapital || '--' }}
          </span>
          <span class="w-20 shrink-0 text-right text-text tabular-nums">
            {{ row.holdingRatio || '--' }}
          </span>
        </div>
      </div>
    </template>
  </div>
</template>

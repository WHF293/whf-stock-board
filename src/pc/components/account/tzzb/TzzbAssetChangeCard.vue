<script setup lang="ts">
import { computed } from 'vue';
import type { TzzbAssetChange } from '../../../../common/types/tzzb.types.ts';

/**
 * 投资账本 · 区间资金变动卡（queryAssetChangeSummary）
 *
 * 股票 / 基金两侧独立展示；无数据侧显示占位说明。
 * 转出金额原文可能为科学计数法（"3E+4"），解析层已转数值。
 */
const props = defineProps<{
  /** 区间资金变动 */
  data: TzzbAssetChange | null;
}>();

/**
 * 千分位金额
 * @param v 数值
 * @returns 千分位两位小数文案
 */
const yuan = (v: number): string =>
  v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** 单侧展示模型 */
interface SideRow {
  label: string;
  value: number;
  /** 是否着涨跌色 */
  colored?: boolean;
}

/**
 * 组装单侧行（无数据返回 null）
 * @param side 单侧原始数据
 * @returns 展示行数组；无数据返回 null
 */
const sideRows = (side: TzzbAssetChange['stock']): SideRow[] | null => {
  if (!side || side.startAsset === 0) return null;
  return [
    { label: '期初资产', value: side.startAsset },
    { label: '转入', value: side.transferIn },
    { label: '转出', value: side.transferOut },
    { label: '分红', value: side.dividend },
    { label: '区间盈亏', value: side.profit, colored: true },
    { label: '期末资产', value: side.endAsset },
  ];
};

/** 股票侧 / 基金侧 */
const stockRows = computed(() => sideRows(props.data?.stock ?? null));
const fundRows = computed(() => sideRows(props.data?.fund ?? null));
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <template v-if="stockRows || fundRows">
      <div v-if="stockRows" class="min-h-0 flex-1 overflow-y-auto">
        <p class="mb-1 text-xs font-medium text-text-secondary">股票侧</p>
        <div
          v-for="row in stockRows"
          :key="row.label"
          class="flex items-center justify-between border-b border-dashed border-flat-weak py-1.5 text-[13px] last:border-b-0"
        >
          <span class="text-text-secondary">{{ row.label }}</span>
          <span
            class="font-mono font-medium tabular-nums"
            :class="
              row.colored ? (row.value > 0 ? 'text-up' : row.value < 0 ? 'text-down' : 'text-flat') : 'text-text'
            "
          >
            {{ yuan(row.value) }}
          </span>
        </div>
      </div>

      <div v-if="fundRows" class="mt-3 min-h-0 border-t border-flat-weak pt-2">
        <p class="mb-1 text-xs font-medium text-text-secondary">基金侧</p>
        <div
          v-for="row in fundRows"
          :key="row.label"
          class="flex items-center justify-between py-1 text-[13px]"
        >
          <span class="text-text-secondary">{{ row.label }}</span>
          <span class="font-mono tabular-nums text-text">{{ yuan(row.value) }}</span>
        </div>
      </div>
    </template>
    <p v-else class="text-sm text-text-tertiary">区间资金变动暂无数据</p>

    <p class="mt-2 shrink-0 text-xs leading-5 text-text-tertiary">
      转出金额原文可能为科学计数法（"3E+4"），解析层已处理；基金侧字段为 null 时视为无数据。
    </p>
  </div>
</template>

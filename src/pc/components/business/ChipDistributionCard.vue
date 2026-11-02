<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import { fetchChipDistribution } from '../../../common/api/chip-distribution.api.ts';
import { isChipApplicable } from '../../../common/constants/chip-distribution.constants.ts';
import { FLAT_COLOR, DOWN_COLOR, UP_COLOR } from '../../../common/constants/stock-colors.constants.ts';
import { NUMBER_PLACEHOLDER } from '../../../common/constants/format.constants.ts';
import { formatPrice } from '../../../common/utils/format-price';
import { handleSdkError } from '../../../common/utils/handle-sdk-error';
import type { ChipDistributionItem } from '../../../common/api/chip-distribution.api.ts';

/**
 * 筹码分布卡内容（2026-11-02 王总指定新增：股票详情整页右栏「五档盘口」下方）
 *
 * 数据源 stock-sdk `chips`（东财 CYQ 算法本地推演，原料东财日 K + 换手率）：
 * 统计行取序列末行（获利比例 / 平均成本 / 90%·70% 成本区间与集中度），
 * 筹码峰直方图为最新一日 150 档占比分布——现价之下的筹码（获利盘）红色、
 * 之上（套牢盘）绿色，与东财 App 口径一致。重接口不轮询，符号变化即重拉。
 */
const props = defineProps<{
  /** 完整符号（sh600519 / hk00700 形态） */
  symbol: string;
  /** 现价（划分获利 / 套牢柱色；缺失时直方图用中性色） */
  currentPrice: number | null;
}>();

/** 序列（末行为当前分布） */
const rows = ref<ChipDistributionItem[]>([]);
/** 加载中 */
const isLoading = ref(false);
/** 是否不适用（指数 / ETF：无换手率概念） */
const notApplicable = ref(false);
/** 拉取失败 */
const isError = ref(false);

/** 最新一日统计行 */
const latest = computed<ChipDistributionItem | null>(() => rows.value.at(-1) ?? null);

/** 直方图（仅末行附带） */
const histogram = computed(() => latest.value?.histogram ?? null);

/** 直方图柱高归一基准（最大占比） */
const maxRatio = computed(() => Math.max(...(histogram.value?.ratios ?? [0])));

/**
 * 单根筹码柱颜色：现价之下 = 获利盘（红），之上 = 套牢盘（绿）；现价缺失用中性色
 * @param price 该档价格
 * @returns hex 色值
 */
const barColor = (price: number): string => {
  if (props.currentPrice === null) return FLAT_COLOR;
  return price < props.currentPrice ? UP_COLOR : DOWN_COLOR;
};

/** 指标网格：标签 + 文案（null 表示该口径当日推演不出，显示 `--`） */
const summaryItems = computed<Array<{ label: string; value: string }>>(() => {
  const row = latest.value;
  const ratioText = (value: number | null | undefined): string =>
    value === null || value === undefined ? NUMBER_PLACEHOLDER : `${(value * 100).toFixed(2)}%`;
  const rangeText = (low: number | null | undefined, high: number | null | undefined): string =>
    low === null || low === undefined || high === null || high === undefined
      ? NUMBER_PLACEHOLDER
      : `${formatPrice(low)} ~ ${formatPrice(high)}`;
  return [
    { label: '获利比例', value: ratioText(row?.profitRatio) },
    { label: '平均成本', value: row?.avgCost === null || row?.avgCost === undefined ? NUMBER_PLACEHOLDER : formatPrice(row.avgCost) },
    { label: '90 成本', value: rangeText(row?.cost90Low, row?.cost90High) },
    { label: '90 集中度', value: ratioText(row?.concentration90) },
    { label: '70 成本', value: rangeText(row?.cost70Low, row?.cost70High) },
    { label: '70 集中度', value: ratioText(row?.concentration70) },
  ];
});

/**
 * 加载筹码分布（指数 / ETF 直接置不适用；失败空态兜底不抛出）
 */
const load = async (): Promise<void> => {
  rows.value = [];
  isError.value = false;
  notApplicable.value = !isChipApplicable(props.symbol);
  if (notApplicable.value) return;
  isLoading.value = true;
  try {
    rows.value = await fetchChipDistribution(props.symbol);
  } catch (error) {
    console.error('[chip-distribution]', handleSdkError(error));
    isError.value = true;
  } finally {
    isLoading.value = false;
  }
};

watch(() => props.symbol, () => void load(), { immediate: true });
</script>

<template>
  <BaseSkeleton v-if="isLoading" class="h-40" />
  <BaseEmpty
    v-else-if="notApplicable"
    text="指数 / 基金无换手率概念，不适用筹码分布"
  />
  <BaseEmpty v-else-if="isError || rows.length === 0" text="筹码分布暂无数据（上游可能限频，稍后重开面板重试）" />
  <div v-else class="flex flex-col gap-3">
    <dl class="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      <div v-for="item in summaryItems" :key="item.label" class="flex items-baseline justify-between gap-2">
        <dt class="shrink-0 text-text-tertiary">{{ item.label }}</dt>
        <dd class="truncate text-right font-medium tabular-nums text-text">{{ item.value }}</dd>
      </div>
    </dl>

    <!-- 筹码峰直方图：150 档占比竖柱（低 → 高），红 = 获利盘 / 绿 = 套牢盘 -->
    <div class="flex flex-col gap-1">
      <div class="flex h-20 items-end gap-px">
        <div
          v-for="(price, index) in histogram?.prices ?? []"
          :key="price"
          class="min-w-0 flex-1"
          :style="{
            height: `${Math.max(((histogram?.ratios[index] ?? 0) / maxRatio) * 100, 2)}%`,
            background: barColor(price),
            opacity: 0.85,
          }"
        />
      </div>
      <div class="flex items-center justify-between text-[10px] text-text-tertiary tabular-nums">
        <span>{{ histogram?.prices[0] ?? '' }}</span>
        <span>现价 {{ formatPrice(currentPrice) }}</span>
        <span>{{ histogram?.prices.at(-1) ?? '' }}</span>
      </div>
      <p class="text-[10px] text-text-tertiary">
        截至{{ latest?.date }} · 红 = 现价下方获利筹码，绿 = 上方套牢筹码 ·
        90/70 成本为筹码占比 90% / 70% 的价格区间，集中度越小越集中
      </p>
    </div>
  </div>
</template>

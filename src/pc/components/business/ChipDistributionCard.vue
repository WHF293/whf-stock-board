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
 * 筹码分布卡内容（2026-11-02 王总指定新增：股票详情整页右栏顶部，
 * 与五档盘口换位并加高）
 *
 * 数据源（2026-11-02 改版）：日 K（新浪 / 腾讯源）+ 实时行情推演流通股本，
 * 经 SDK 纯函数 `calcChipDistribution` 本地推演（东财官网同款 CYQ 算法，
 * 服务端无现成接口；原 SDK `chips` 走东财日 K 源在本机被掐，见 api 层注释）：
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

/** 直方图价格档（高位在前，供竖排渲染：上 = 高价 / 下 = 低价） */
const reversedPrices = computed<number[]>(() =>
  [...(histogram.value?.prices ?? [])].reverse(),
);

/**
 * 竖排柱的占比（reversedPrices 与原 ratios 下标反向对齐）
 * @param displayIndex 竖排行下标（0 = 最高价档）
 * @returns 该档占比
 */
const ratioAt = (displayIndex: number): number => {
  const ratios = histogram.value?.ratios ?? [];
  return ratios[ratios.length - 1 - displayIndex] ?? 0;
};

/** 现价分界行在竖排序列中的下标（= 套牢盘档数，分界线插在获利/套牢之间）；无现价或单侧无筹码时为 null */
const profitBoundaryIndex = computed<number | null>(() => {
  const prices = histogram.value?.prices ?? [];
  const current = props.currentPrice;
  if (current === null || prices.length === 0) return null;
  const trappedCount = prices.filter((price) => price >= current).length;
  return trappedCount > 0 && trappedCount < prices.length ? trappedCount : null;
});

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
  <!-- 根节点 flex-1：配合外层 BaseCard fill 撑满右栏剩余高度（2026-11-02 王总指定加高）；
       overflow-y-auto：窗口高度不足时本卡内部滚动，内容不再溢出压到「五档盘口」卡上 -->
  <div v-else class="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
    <dl class="grid shrink-0 grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
      <div v-for="item in summaryItems" :key="item.label" class="flex items-baseline justify-between gap-2">
        <dt class="shrink-0 text-text-tertiary">{{ item.label }}</dt>
        <dd class="truncate text-right font-medium tabular-nums text-text">{{ item.value }}</dd>
      </div>
    </dl>

    <!-- 筹码峰直方图（2026-11-02 王总指定改竖排，东财官网样式）：
         价格轴竖放（高价在上 / 低价在下），柱沿水平方向伸展，宽度 = 占比；
         红 = 现价下方获利盘 / 绿 = 上方套牢盘，虚线为现价分界。
         min-h-44 + flex-1：卡片有富余高度时直方图随之拉伸 -->
    <div class="flex min-h-0 flex-1 flex-col gap-1">
      <div class="flex min-h-44 flex-1 flex-col">
        <template v-for="(price, index) in reversedPrices" :key="price">
          <div
            v-if="index === profitBoundaryIndex"
            class="relative shrink-0 border-t border-dashed border-text-tertiary"
          >
            <span
              class="absolute right-0 top-0 -translate-y-1/2 bg-surface px-1 text-[10px] leading-none text-text-tertiary tabular-nums"
            >现价 {{ formatPrice(currentPrice) }}</span>
          </div>
          <div class="flex min-h-0 flex-1 items-stretch">
            <div
              class="min-w-0"
              :style="{
                width: `${(ratioAt(index) / maxRatio) * 100}%`,
                background: barColor(price),
                opacity: 0.85,
              }"
            />
          </div>
        </template>
      </div>
      <div class="flex items-center justify-between text-[10px] text-text-tertiary tabular-nums">
        <span>低 {{ histogram?.prices[0] ?? '' }}</span>
        <!-- 统计日期（原底部说明行随 2026-11-02 改版迁标题问号 tooltip，日期留在此处展示） -->
        <span>截至 {{ latest?.date ?? '' }}</span>
        <span>高 {{ histogram?.prices.at(-1) ?? '' }}</span>
      </div>
    </div>
  </div>
</template>

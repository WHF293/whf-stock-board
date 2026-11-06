<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import GoldBrandCompareChart from '../charts/GoldBrandCompareChart.vue';
import GoldTrendChart from '../charts/GoldTrendChart.vue';
import { fetchGoldDashboard, fetchGoldBrandHistory } from '../../../common/api/gold-price.api.ts';
import {
  GOLD_BRAND_CODES,
  GOLD_BRAND_ALL_KEY,
  GOLD_HISTORY_DAYS,
} from '../../../common/constants/gold-price.constants.ts';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import { POLLING_INTERVAL } from '../../../common/constants/polling.constants.ts';
import { usePolling } from '../../../common/composables/use-polling';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import { TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import type { GoldDashboardData, GoldHistoryPoint } from '../../../common/types/gold-price.types.ts';

/**
 * 当日金价卡（PC 市场总览，2026-11-07 王总指定替换「市场宽度 · ARMS」速览卡）
 *
 * 数据源金投网行情中心（品牌金店挂牌价聚合，金店价每日数次调价）：
 * - 摘要行：伦敦金现（美元/盎司 + 折合元/克）与国内基础金价（中国黄金基础金价），
 *   作为品牌价的对照锚点
 * - 「全部」视图：横向分组柱状图，足金饰品（金柱）/ 投资金条（银灰柱）按品牌对比，
 *   基准价 markLine 一眼看出品牌溢价；品牌无金条行情时该柱缺行
 * - 单品牌视图：足金饰品 / 投资金条两个大数字 + 近 30 日足金价走势折线
 *   （历史接口单 code 拉取，会话内按品牌缓存）；品牌切换用卡头下拉
 *
 * 内容区与涨跌分布卡图表等高（王总 2026-11-07 指定高度对齐），图表随剩余高度自适应；
 * 轮询 5 分钟（日更数据低频，不受交易窗口限制——金店盘中亦调价、国际盘夜间走）；
 * 快照播种秒出 UI，失败保留旧数据。
 */
const dataCache = useDataCacheStore();

/** 卡片内容区固定高度（像素）：与涨跌分布卡图表（DistributionChart 308px）等高对齐 */
const CARD_CONTENT_HEIGHT_PX = 308;

/** 金价快照（快照播种：切换回本页先展示上次数据） */
const data = ref<GoldDashboardData | null>(
  dataCache.get<GoldDashboardData>(DATA_CACHE_KEY.GOLD_PRICE_DASHBOARD) ?? null,
);
/** 首载是否完成（骨架期） */
const ready = ref(false);
/** 首载是否失败（且无快照） */
const isError = ref(false);

/** 拉取金价快照（轮询调用；失败保留旧数据） */
const load = async (): Promise<void> => {
  try {
    data.value = await fetchGoldDashboard();
    dataCache.set(DATA_CACHE_KEY.GOLD_PRICE_DASHBOARD, data.value);
    isError.value = false;
  } catch (error) {
    isError.value = data.value === null;
    console.error('[gold-price] 拉取失败', error);
  } finally {
    ready.value = true;
  }
};

usePolling({ task: load, intervalMs: POLLING_INTERVAL.GOLD_PRICE, tradingAware: false });
onMounted(() => {
  void load();
});

// ---------- 品牌切换（内存态，进页默认「全部」） ----------

/** 当前品牌档（GOLD_BRAND_ALL_KEY = 全部，其余 = GOLD_BRAND_CODES.key） */
const activeKey = ref<string>(GOLD_BRAND_ALL_KEY);

/** 品牌 chips 选项（全部 + 声明序品牌） */
const brandTabOptions = [
  { label: '全部', value: GOLD_BRAND_ALL_KEY },
  ...GOLD_BRAND_CODES.map((brand) => ({ label: brand.label, value: brand.key })),
];

// ---------- 单品牌走势（历史接口按品牌缓存，会话内复用） ----------

/** 品牌走势缓存（key = 品牌 key） */
const historyCache = new Map<string, GoldHistoryPoint[]>();
/** 当前品牌的历史点（全部档 / 拉取中为空数组） */
const historyPoints = ref<GoldHistoryPoint[]>([]);
/** 历史点拉取中 */
const isHistoryLoading = ref(false);

/**
 * 拉取当前单品牌的历史点（已缓存直接复用，失败置空展示空态）
 * @param brandKey 品牌 key
 * @returns void
 */
const loadHistory = async (brandKey: string): Promise<void> => {
  const cached = historyCache.get(brandKey);
  if (cached) {
    historyPoints.value = cached;
    return;
  }
  const brand = GOLD_BRAND_CODES.find((item) => item.key === brandKey);
  if (!brand) return;
  isHistoryLoading.value = true;
  try {
    const points = await fetchGoldBrandHistory(brand.ornament, GOLD_HISTORY_DAYS);
    historyCache.set(brandKey, points);
    if (activeKey.value === brandKey) {
      historyPoints.value = points;
    }
  } catch (error) {
    console.error('[gold-price] 历史拉取失败', error);
    historyPoints.value = [];
  } finally {
    isHistoryLoading.value = false;
  }
};

watch(activeKey, (brandKey) => {
  if (brandKey === GOLD_BRAND_ALL_KEY) {
    historyPoints.value = [];
    return;
  }
  void loadHistory(brandKey);
});

// ---------- 展示派生 ----------

/** 摘要行（null 字段展示 `--`） */
const spot = computed(() => data.value?.spot ?? null);

/** 伦敦金涨跌着色 class（涨跌配色主题跟随） */
const xauTrendClass = computed(() =>
  TREND_TEXT_CLASS[getTrendByChangePercent(spot.value?.xauChangePercent ?? 0)],
);

/** 报价更新时间文案（HH:mm；无时间戳为 `--`） */
const quotedAtText = computed(() => {
  const time = spot.value?.quotedAt;
  if (!time) return '--';
  return new Date(time).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
});

/**
 * 数值文案（null/undefined → `--`，两位小数）
 * @param value 数值原值
 * @returns 展示文案（元/克 两位小数或占位符）
 */
const priceText = (value: number | null | undefined): string =>
  value === null || value === undefined ? '--' : value.toFixed(2);
</script>

<template>
  <BaseCard title="当日金价">
    <template #extra>
      <div class="flex shrink-0 items-center gap-2">
        <!-- 品牌切换下拉（2026-11-07 王总指定换 select 并上移卡头，原页内 chips 拥挤难选） -->
        <select
          v-model="activeKey"
          class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
          aria-label="切换金店品牌"
        >
          <option v-for="option in brandTabOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
        <span class="shrink-0 text-xs text-text-tertiary">元/克 · {{ quotedAtText }} 更新</span>
      </div>
    </template>

    <!-- 内容区固定高度：与涨跌分布卡图表等高对齐（王总 2026-11-07 指定），图表吃剩余高度 -->
    <div v-if="!ready" :style="{ height: `${CARD_CONTENT_HEIGHT_PX}px` }">
      <BaseSkeleton />
    </div>
    <div v-else-if="isError || !data" :style="{ height: `${CARD_CONTENT_HEIGHT_PX}px` }" class="py-8">
      <BaseEmpty text="金价加载失败，请稍后重试（上游可能限频）" />
      <div class="mt-3 text-center">
        <button
          type="button"
          class="pressable rounded-lg px-3 py-1.5 text-sm text-primary hover:bg-primary-weak"
          @click="load"
        >
          重试
        </button>
      </div>
    </div>

    <div
      v-else
      class="flex flex-col gap-3"
      :style="{ height: `${CARD_CONTENT_HEIGHT_PX}px` }"
    >
      <!-- 摘要行：伦敦金现（美元/盎司 + 折合）与国内基础金价，品牌价的对照锚点 -->
      <div class="grid shrink-0 grid-cols-3 gap-3">
        <div class="rounded-lg bg-flat-weak px-3 py-1.5">
          <p class="text-xs text-text-tertiary">伦敦金现</p>
          <p class="flex items-baseline gap-1.5">
            <span class="text-base font-semibold tabular-nums text-text">
              ${{ priceText(spot?.xauUsd) }}
            </span>
            <span class="shrink-0 text-xs tabular-nums" :class="xauTrendClass">
              {{ (spot?.xauChangePercent ?? 0) > 0 ? '+' : '' }}{{ (spot?.xauChangePercent ?? 0).toFixed(2) }}%
            </span>
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak px-3 py-1.5">
          <p class="text-xs text-text-tertiary">折合人民币</p>
          <p class="text-base font-semibold tabular-nums text-text">
            {{ spot?.xauCnyPerGram === null || spot?.xauCnyPerGram === undefined ? '--' : `¥${priceText(spot.xauCnyPerGram)}` }}
          </p>
        </div>
        <div class="rounded-lg bg-flat-weak px-3 py-1.5">
          <p class="text-xs text-text-tertiary">基础金价</p>
          <p class="text-base font-semibold tabular-nums text-text">
            {{ spot?.basisPrice === null || spot?.basisPrice === undefined ? '--' : `¥${priceText(spot.basisPrice)}` }}
          </p>
        </div>
      </div>

      <!-- 全部视图：横向分组柱状图（足金饰品 / 投资金条 × 品牌，基准价参考线） -->
      <div v-if="activeKey === GOLD_BRAND_ALL_KEY" class="min-h-0 flex-1">
        <GoldBrandCompareChart
          :brands="data.brands"
          :basis-price="spot?.basisPrice ?? null"
        />
      </div>

      <!-- 单品牌视图：足金饰品 / 投资金条大数字 + 近 30 日足金价走势（吃剩余高度） -->
      <template v-else>
        <div class="grid shrink-0 grid-cols-2 gap-3">
          <div class="rounded-lg bg-flat-weak px-3 py-1.5">
            <p class="text-xs text-text-tertiary">足金饰品</p>
            <p class="text-xl font-bold tabular-nums text-text">
              {{ priceText(data.brands.find((brand) => brand.key === activeKey)?.ornamentPrice ?? null) }}
              <span class="ml-1 text-xs font-normal text-text-tertiary">元/克</span>
            </p>
          </div>
          <div class="rounded-lg bg-flat-weak px-3 py-1.5">
            <p class="text-xs text-text-tertiary">投资金条</p>
            <p class="text-xl font-bold tabular-nums text-text">
              {{ priceText(data.brands.find((brand) => brand.key === activeKey)?.barPrice ?? null) }}
              <span class="ml-1 text-xs font-normal text-text-tertiary">元/克</span>
            </p>
          </div>
        </div>
        <div class="min-h-0 flex-1">
          <div v-if="isHistoryLoading" class="h-full">
            <BaseSkeleton />
          </div>
          <BaseEmpty
            v-else-if="historyPoints.length === 0"
            class="h-full"
            text="暂无该品牌的历史行情"
          />
          <GoldTrendChart v-else :points="historyPoints" />
        </div>
      </template>
    </div>
  </BaseCard>
</template>

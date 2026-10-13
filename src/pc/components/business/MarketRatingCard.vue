<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import { fetchThsIndexFlash } from '../../../common/api/ths-index-flash.api.ts';
import { THS_POLLING_INTERVAL, getThsRatingAdvice } from '../../../common/constants/ths-market.constants.ts';
import { usePolling } from '../../../common/composables/use-polling';
import { getRatingHistory, recordRatingToday } from '../../../common/utils/rating-history';

/**
 * 大盘评级卡（市场总览新增，数据源同花顺 q 域 indexflash 的 dppj_data）
 *
 * - 环形仪表 0-10 分（得分弧用涨跌语义色：评分本质是「红强绿弱」情绪表达）
 * - 投资建议：同花顺前端写死的五档文案映射（constants 单源）
 * - 近 5 日评分柱：接口只有当日值，本地按日落 appStorage 积累（rating-history）
 * - 60s 前台轮询（tradingAware）；失败保留旧值，首载失败显示空态
 */
const score = ref<number | null>(null);
/** 首载是否失败（供空态展示） */
const error = ref(false);

/** 拉取评分：成功后写当日历史（同日覆盖） */
const load = async (): Promise<void> => {
  try {
    const data = await fetchThsIndexFlash();
    if (data.dppj === null) {
      throw new Error('dppj_data 缺失');
    }
    score.value = data.dppj;
    recordRatingToday(data.dppj);
    error.value = false;
  } catch (err) {
    // 首载失败才置错误态；轮询间隙抖动保留旧分数
    if (score.value === null) {
      error.value = true;
      console.error('[market-rating] 拉取失败', err);
    }
  }
};

usePolling({ task: load, intervalMs: THS_POLLING_INTERVAL.RATING, tradingAware: true });
onMounted(() => {
  void load();
});

/** 投资建议文案 */
const adviceText = computed(() => getThsRatingAdvice(score.value));

/** 近 5 日评分历史（升序；含今日覆盖后的最新值） */
const history = computed(() => getRatingHistory());

/* === 环形仪表几何 === */
const DONUT_R = 34;
const DONUT_C = 2 * Math.PI * DONUT_R;
/** 得分弧长度（0-10 → 0-整圆） */
const dashLen = computed(() => ((score.value ?? 0) / 10) * DONUT_C);

/** 近 5 日柱几何（0-10 分 → 高度百分比；今日标红，其余中性） */
const bars = computed(() =>
  history.value.map((entry, index) => ({
    ...entry,
    h: Math.max((entry.score / 10) * 100, 2),
    isToday: index === history.value.length - 1,
  })),
);
</script>

<template>
  <div v-if="score !== null" class="flex h-full flex-col">
    <div class="flex items-center gap-4">
      <!-- 环形仪表 -->
      <svg width="92" height="92" viewBox="0 0 92 92" role="img" aria-label="大盘评分">
        <circle cx="46" cy="46" :r="DONUT_R" fill="none" stroke="var(--color-flat-weak)" stroke-width="8" />
        <circle
          cx="46"
          cy="46"
          :r="DONUT_R"
          fill="none"
          stroke="var(--color-up)"
          stroke-width="8"
          stroke-linecap="round"
          :stroke-dasharray="`${dashLen} ${DONUT_C}`"
          transform="rotate(-90 46 46)"
          class="rating-arc"
        />
        <text
          x="46"
          y="44"
          text-anchor="middle"
          class="fill-[var(--color-text-1)] text-[20px] font-semibold"
          style="font-variant-numeric: tabular-nums"
        >
          {{ score.toFixed(1) }}
        </text>
        <text x="46" y="60" text-anchor="middle" class="fill-[var(--color-text-3)] text-[10px]">大盘评分</text>
      </svg>
      <!-- 投资建议 -->
      <div class="min-w-0 flex-1">
        <p class="text-xs text-text-tertiary">投资建议</p>
        <p class="mt-1 text-sm font-medium leading-relaxed text-text">{{ adviceText ?? '--' }}</p>
      </div>
    </div>

    <!-- 近 5 日评分柱（单柱限宽 36px 居中，避免仅 1 日数据时拉通整行像色块） -->
    <div v-if="bars.length > 0" class="mt-auto pt-4">
      <div class="flex h-[48px] items-end justify-center gap-2">
        <div
          v-for="bar in bars"
          :key="bar.date"
          class="max-w-[36px] flex-1 rounded-t-sm"
          :class="bar.isToday ? 'bg-up' : 'bg-flat-weak'"
          :style="{ height: `${bar.h}%` }"
          :title="`${bar.date} · ${bar.score.toFixed(1)} 分`"
        />
      </div>
      <div class="mt-1.5 flex justify-center gap-3 text-[10px] text-text-tertiary">
        <span>{{ bars[0]?.date.slice(5) }} 起</span>
        <span>近 {{ bars.length }} 日评分</span>
      </div>
    </div>
  </div>
  <!-- 非交易日 / 首载失败：空态（评分下一交易日生成） -->
  <div v-else-if="error" class="flex h-full min-h-[120px] items-center justify-center text-sm text-text-tertiary">
    评分暂未生成，下一交易日 09:30 更新
  </div>
  <BaseSkeleton v-else class="min-h-[120px]" />
</template>

<style scoped>
/* 得分弧过渡：60s 轮询刷新时平滑走针，prefers-reduced-motion 由全局降级 */
.rating-arc {
  transition: stroke-dasharray 0.6s ease;
}
</style>

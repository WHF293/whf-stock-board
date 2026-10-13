<script setup lang="ts">
/**
 * 大盘评级卡（移动端首页，数据源与 PC 同源：同花顺 q 域 indexflash 的 dppj_data）
 *
 * - 环形仪表 + 投资建议（同花顺前端五档文案映射）+ 近 5 日评分迷你柱
 * - 自持轮询：注册 useMobilePolling，但卡内 60s TTL 节流（评分低频，
 *   与首页 30s 脉冲同频注册也不会多打请求）
 * - 独立降级：失败保留旧值，首载失败显示空态
 */
import { computed, onMounted, ref } from 'vue';
import { fetchThsIndexFlash } from '../../common/api/ths-index-flash.api.ts';
import { getThsRatingAdvice } from '../../common/constants/ths-market.constants.ts';
import { getRatingHistory, recordRatingToday } from '../../common/utils/rating-history';

/** 评分刷新 TTL（毫秒；评分低频，30s 轮询脉冲下 60s 实拉一次） */
const RATING_TTL_MS = 60_000;

const score = ref<number | null>(null);
const error = ref(false);
let lastAt = 0;
let pending = false;

/**
 * 拉取评分（TTL 节流；force 跳过缓存）
 * @param force true 强制重拉（下拉刷新）
 */
const load = async (force = false): Promise<void> => {
  if (pending || (!force && Date.now() - lastAt < RATING_TTL_MS)) return;
  pending = true;
  try {
    const data = await fetchThsIndexFlash();
    if (data.dppj === null) throw new Error('dppj_data 缺失');
    score.value = data.dppj;
    recordRatingToday(data.dppj);
    error.value = false;
    lastAt = Date.now();
  } catch {
    if (score.value === null) error.value = true;
  } finally {
    pending = false;
  }
};

defineExpose({ load });

onMounted(() => {
  void load();
});

const adviceText = computed(() => getThsRatingAdvice(score.value));
const history = computed(() => getRatingHistory());

/* === 环形几何（128px 大圈居中，viewBox 96 等比放大） === */
const DONUT_R = 38;
const DONUT_C = 2 * Math.PI * DONUT_R;
const dashLen = computed(() => ((score.value ?? 0) / 10) * DONUT_C);

/** 近 5 日迷你柱（今日标红） */
const bars = computed(() =>
  history.value.map((entry, index) => ({
    ...entry,
    h: Math.max((entry.score / 10) * 100, 2),
    isToday: index === history.value.length - 1,
  })),
);
</script>

<template>
  <div class="m-rate">
    <div v-if="error" class="m-state m-rate__empty">
      <van-icon name="warning-o" size="24" />
      评分暂未生成，下一交易日 09:30 更新
      <span class="retry" @click="load(true)">重试</span>
    </div>
    <template v-else-if="score !== null">
      <div class="m-rate__main">
        <svg width="128" height="128" viewBox="0 0 96 96" role="img" aria-label="大盘评分">
          <circle cx="48" cy="48" :r="DONUT_R" fill="none" stroke="var(--color-flat-weak)" stroke-width="8" />
          <circle
            cx="48"
            cy="48"
            :r="DONUT_R"
            fill="none"
            stroke="var(--color-up)"
            stroke-width="8"
            stroke-linecap="round"
            :stroke-dasharray="`${dashLen} ${DONUT_C}`"
            transform="rotate(-90 48 48)"
            class="m-rate__arc"
          />
          <text x="48" y="47" text-anchor="middle" class="m-rate__score">{{ score.toFixed(1) }}</text>
          <text x="48" y="63" text-anchor="middle" class="m-rate__label">大盘评分</text>
        </svg>
        <div class="m-rate__advice">
          <div class="m-rate__advice-t">投资建议</div>
          <div class="m-rate__advice-v">{{ adviceText }}</div>
        </div>
      </div>
      <!-- 近 5 日评分迷你柱 -->
      <div v-if="bars.length > 0" class="m-rate__hist">
        <div class="m-rate__bars">
          <div
            v-for="bar in bars"
            :key="bar.date"
            class="m-rate__bar"
            :class="{ today: bar.isToday }"
            :style="{ height: `${bar.h}%` }"
          />
        </div>
        <div class="m-rate__hist-meta">近 {{ bars.length }} 日评分</div>
      </div>
    </template>
    <div v-else class="m-rate__skel">
      <van-skeleton title :row="2" :loading="true" />
    </div>
  </div>
</template>

<style scoped>
.m-rate { display: flex; flex-direction: column; gap: 14px; }
/* 纵向居中布局：大圈在上，投资建议在下（王总 2026-10-13） */
.m-rate__main { display: flex; flex-direction: column; align-items: center; gap: 10px; text-align: center; }
.m-rate__arc { transition: stroke-dasharray 0.6s ease; }
.m-rate__score { font-size: 24px; font-weight: 700; fill: var(--color-text-1); font-variant-numeric: tabular-nums; }
.m-rate__label { font-size: 10.5px; fill: var(--color-text-3); }
.m-rate__advice { max-width: 240px; }
.m-rate__advice-t { font-size: 11px; color: var(--color-text-3); }
.m-rate__advice-v { margin-top: 4px; font-size: 14px; font-weight: 600; line-height: 1.5; color: var(--color-text-1); }
.m-rate__hist { border-top: 1px solid var(--color-border); padding-top: 10px; }
.m-rate__bars { display: flex; align-items: flex-end; justify-content: center; gap: 10px; height: 40px; max-width: 220px; margin: 0 auto; }
.m-rate__bar { flex: 1; max-width: 24px; border-radius: 3px 3px 0 0; background: var(--color-flat-weak); }
.m-rate__bar.today { background: var(--color-up); }
.m-rate__hist-meta { margin-top: 6px; font-size: 10px; color: var(--color-text-3); text-align: right; }
.m-rate__empty { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 18px 0; color: var(--color-text-3); font-size: 12.5px; }
.m-rate__skel { padding: 8px 0; }
</style>

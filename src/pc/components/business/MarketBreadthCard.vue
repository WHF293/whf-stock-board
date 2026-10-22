<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import { ROUTE_PATH } from '../../../common/constants/router-meta.constants.ts';
import ArmsTrendChart from '../charts/ArmsTrendChart.vue';
import type {
  BreadthPoint,
  MarketBreadth,
} from '../../../common/types/market-breadth.types.ts';
import type { MarketSentiment } from '../../../common/types/market-sentiment.types.ts';
import { readBreadthBars, readBreadthDay } from '../../../common/api/market-breadth-db.api';
import { classifyArms, type ArmsStateResult } from '../../../common/utils/classify-arms';
import { toDayKey } from '../../../common/utils/to-day-key';

/**
 * 市场宽度 · ARMS 卡（PC 市场总览）
 *
 * 左列实时指标面板（涨跌家数 / 涨停跌停 / A/D / ARMS 现值 + 五档状态），
 * 右列为当日分时曲线（固定全天 09:30~15:00 时间轴）。
 * 更长历史（近 30/60 日与五大广度副图）在「市场广度指标」页查看（右上角入口按钮）。
 * 全部数据来自既有 30s 全市场快照轮询（DashboardView fetchMarketBreadth 内 ingest），
 * 零新增上游请求；分时为本地积累，卡片自身只读 appStorage。
 */
const { breadth = null, sentiment = null } = defineProps<{
  /** 当日市场宽度统计（快照轮询写入；null 时左列显示占位） */
  breadth?: MarketBreadth | null;
  /** 市场情绪统计（涨停 / 跌停家数复用其轮询结果） */
  sentiment?: MarketSentiment | null;
}>();

const router = useRouter();

/** 跳转市场广度指标页（五大广度副图：ADL/ADR/OBOS/ARMS/MCO） */
const gotoBreadthPage = (): void => {
  void router.push(ROUTE_PATH.MARKET_BREADTH);
};

/** 当日分钟点序列（appStorage 读取） */
const todaySeries = ref<BreadthPoint[]>([]);

/** 日 bar 序列（appStorage 读取，仅用于「已积累 N 个交易日」徽标） */
const accumDays = ref(0);

/** 从本地库刷新序列（每轮快照后快照轻量重读） */
const refreshSeries = (): void => {
  todaySeries.value = readBreadthDay(toDayKey(Date.now()));
  accumDays.value = readBreadthBars().length;
};

onMounted(refreshSeries);
watch(
  () => breadth,
  () => refreshSeries(),
);

/** ARMS 五档状态（null 时左列显示「--」） */
const armsState = computed<ArmsStateResult | null>(() => classifyArms(breadth?.arms ?? null));

/** 状态 pill 的语义色（红强 / 绿弱 / 灰平衡，跟随涨跌配色主题） */
const stateStyle = computed<Record<string, string>>(() => {
  const tone = armsState.value?.tone;
  if (tone === 'up') return { color: 'var(--color-up-strong)', background: 'var(--color-up-weak)' };
  if (tone === 'down') return { color: 'var(--color-down-strong)', background: 'var(--color-down-weak)' };
  return { color: 'var(--color-flat)', background: 'var(--color-flat-weak)' };
});

/** ARMS 现值文案（null 显「--」） */
const armsText = computed(() => (breadth?.arms === null || breadth === null ? '--' : breadth.arms!.toFixed(2)));

/** A/D 文案（null 显「--」） */
const adText = computed(() => (breadth?.ad === null || breadth === null ? '--' : breadth.ad!.toFixed(2)));
</script>

<template>
  <BaseCard title="市场宽度 · ARMS" clickable-title @title-click="gotoBreadthPage">
    <template #extra>
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="rounded-full px-2.5 py-1 text-xs font-bold transition-colors"
          style="color: var(--color-primary); background: var(--color-primary-weak)"
          @click="gotoBreadthPage"
        >
          市场宽度详情
        </button>
        <span
          class="rounded-full px-2.5 py-1 text-xs font-bold"
          style="color: var(--color-primary); background: var(--color-primary-weak)"
        >
          已积累 {{ accumDays }} 个交易日
        </span>
      </div>
    </template>

    <div class="flex flex-wrap items-stretch gap-5">
      <!-- 左：实时指标面板 -->
      <div class="flex w-[236px] shrink-0 flex-col gap-2">
        <div
          class="rounded-xl p-3"
          :style="{ background: 'linear-gradient(135deg, var(--color-up-weak), transparent 70%)' }"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-text-secondary">ARMS 现值</span>
            <span
              v-if="armsState"
              class="rounded-full px-2.5 py-0.5 text-xs font-bold"
              :style="stateStyle"
            >
              {{ armsState.label }}
            </span>
          </div>
          <div class="mt-0.5 text-3xl font-extrabold tabular-nums" style="letter-spacing: -0.5px">
            {{ armsText }}
          </div>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>上涨</span>
          <b class="tabular-nums text-up">{{ (breadth?.upCount ?? 0).toLocaleString() }}</b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>下跌</span>
          <b class="tabular-nums text-down">{{ (breadth?.downCount ?? 0).toLocaleString() }}</b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>平盘</span>
          <b class="tabular-nums text-text">{{ (breadth?.flatCount ?? 0).toLocaleString() }}</b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>涨停 / 跌停</span>
          <b class="tabular-nums text-text">
            <span class="text-up">{{ sentiment?.limitUpCount ?? '--' }}</span>
            /
            <span class="text-down">{{ sentiment?.limitDownCount ?? '--' }}</span>
          </b>
        </div>
        <div class="flex items-center justify-between rounded-lg bg-flat-weak px-3 py-2 text-xs text-text-secondary">
          <span>涨跌比 A/D</span>
          <b class="tabular-nums text-text">{{ adText }}</b>
        </div>
      </div>

      <!-- 右：当日分时曲线（固定全天 09:30~15:00 时间轴；更长历史走「市场广度指标」页）。
           高度随左列指标面板拉伸对齐（items-stretch + h-full），极窄换行时回落 min-h -->
      <div class="min-w-0 flex-1">
        <BaseEmpty v-if="todaySeries.length === 0" text="今日暂无采样（交易日盘中随行情快照自动积累）" />
        <div v-else class="relative h-full min-h-[236px]">
          <div class="absolute inset-0">
            <ArmsTrendChart :points="todaySeries" />
          </div>
        </div>
      </div>
    </div>
  </BaseCard>
</template>

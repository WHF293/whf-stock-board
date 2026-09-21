<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import dayjs from 'dayjs';
import BaseButton from '../../../components/ui/BaseButton.vue';
import BaseCard from '../../../components/ui/BaseCard.vue';
import BaseTabs from '../../../components/ui/BaseTabs.vue';
import RoundArchiveCard from './components/RoundArchiveCard.vue';
import RoundEventTimeline from './components/RoundEventTimeline.vue';
import RoundTimelineChart from './components/RoundTimelineChart.vue';
import CollapseReviewCard from './components/CollapseReviewCard.vue';
import StageDetailGrid from './components/StageDetailGrid.vue';
import ModeLibraryView from './components/ModeLibraryView.vue';
import { buildBearStats, buildRoundStats } from './judge';
import { fetchAllIndexMonthlies } from './history-data';
import { BULL_ROUNDS } from './rounds';
import { BEAR_ROUNDS } from './bears';
import { BULL_VIEW_TABS, BULL_VIEW_TAB_DEFAULT, BULL_VIEW_TAB_LIBRARY } from './constants';
import type { ReviewStageTone } from './types';
import { createReviewRepo } from './storage';

/**
 * 行情全景 · 历史复盘面板（历史牛市 / 历史熊市 / 模式库）
 *
 * - 首次进入（存储为空）自动低频拉取各指数月 K（串行 + 500ms 错峰）写 appStorage，
 *   此后读快照渲染零联网；「更新到最新」手动增量刷新；
 * - 全部数字由 `judge.ts` 从月 K 回算，文案为定性复盘观点。
 * - 页签显隐 / 顺序由行情全景右上角「配置页签」统一控制（useTabConfig）。
 */
const repo = createReviewRepo();

/** 牛市默认展示的轮次（核心资产·白酒抱团：C 类样本最完整） */
const BULL_DEFAULT_ROUND_ID = 'core-asset';

/** 熊市默认展示的轮次（国有股减持大熊市：第一轮制度熊） */
const BEAR_DEFAULT_ROUND_ID = 'state-share-bear';

/** 阶段色调 → 图例色点（按行情方向取用；完整类名静态写死，Tailwind 可扫描） */
const TONE_DOT_CLASS: Record<'bull' | 'bear', Record<ReviewStageTone, string>> = {
  bull: {
    s1: 'bg-primary-weak',
    s2: 'bg-up-weak',
    s3: 'bg-up-pale',
    s4: 'bg-down-weak',
  },
  bear: {
    s1: 'bg-down-weak',
    s2: 'bg-flat-weak',
    s3: 'bg-down-pale',
    s4: 'bg-primary-weak',
  },
};

/** 顶层页签：牛市 / 熊市 / 模式库 */
const marketTab = ref<string>(BULL_VIEW_TAB_DEFAULT);

/** 牛市轮次页签 */
const activeBullRoundId = ref<string>(BULL_DEFAULT_ROUND_ID);

/** 熊市轮次页签 */
const activeBearRoundId = ref<string>(BEAR_DEFAULT_ROUND_ID);

/** 正在同步 */
const syncing = ref(false);

/** 同步失败信息（空串 = 无错误） */
const syncError = ref('');

/** 同步进度文案（空串 = 不展示） */
const progressText = ref('');

/** 当前行情方向（模式库页签沿用上次方向，仅用于图例与口径） */
const mode = computed<'bull' | 'bear'>(() => (marketTab.value === 'bear' ? 'bear' : 'bull'));

/** 当前行情的轮次清单 */
const activeRounds = computed(() => (mode.value === 'bear' ? BEAR_ROUNDS : BULL_ROUNDS));

/** 轮次页签选项（牛市 / 熊市各自的轮次列表） */
const roundTabOptions = computed(() =>
  activeRounds.value.map((round) => ({ label: round.name, value: round.id })),
);

/** 当前轮次档案 */
const activeRound = computed(() => {
  const id = mode.value === 'bear' ? activeBearRoundId.value : activeBullRoundId.value;
  return activeRounds.value.find((round) => round.id === id);
});

/** 轮次页签的双向绑定（按行情方向写入各自的轮次 id，互不串扰） */
const activeRoundId = computed<string>({
  get: () => (mode.value === 'bear' ? activeBearRoundId.value : activeBullRoundId.value),
  set: (value) => {
    if (mode.value === 'bear') activeBearRoundId.value = value;
    else activeBullRoundId.value = value;
  },
});

/** 当前快照（响应式：同步落库后自动更新） */
const snapshot = computed(() => repo.snapshot());

/** 最近同步时间的展示文案 */
const syncedAtText = computed(() =>
  snapshot.value.syncedAt === null ? '未同步' : dayjs(snapshot.value.syncedAt).format('YYYY-MM-DD HH:mm'),
);

/** 当前轮次的指数月 K */
const activeBars = computed(() =>
  activeRound.value ? (snapshot.value.series[activeRound.value.indexSymbol] ?? []) : [],
);

/** 当前轮次的回算统计（牛 / 熊各自口径） */
const activeStats = computed(() => {
  if (!activeRound.value) return null;
  return mode.value === 'bear'
    ? buildBearStats(activeBars.value, activeRound.value)
    : buildRoundStats(activeBars.value, activeRound.value);
});

/** 当前阶段图例（取自轮次的阶段拆解，色点按方向映射） */
const stageLegend = computed(() =>
  (activeRound.value?.stages ?? []).map((stage) => ({
    name: stage.name,
    dot: TONE_DOT_CLASS[mode.value][stage.tone],
  })),
);

/**
 * 执行一次全量同步（拉取全部指数月 K 并落库；串行错峰，失败不中断已完成的指数）
 */
const runSync = async (): Promise<void> => {
  if (syncing.value) return;
  syncing.value = true;
  syncError.value = '';
  try {
    const series = await fetchAllIndexMonthlies((done, total, name) => {
      progressText.value = `拉取 ${name}（${done + 1}/${total}）`;
    });
    const bars: Record<string, number> = {};
    for (const [symbol, list] of Object.entries(series)) bars[symbol] = list.length;
    await repo.saveSync(series, { syncedAt: Date.now(), bars });
  } catch (error) {
    syncError.value = error instanceof Error ? error.message : String(error);
  } finally {
    syncing.value = false;
    progressText.value = '';
  }
};

onMounted(() => {
  // 库空才自动首拉；此后重进页面读库零联网
  if (repo.snapshot().syncedAt === null) void runSync();
});
</script>

<template>
  <div class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <BaseTabs v-model="marketTab" :options="BULL_VIEW_TABS" />
      <BaseTabs
        v-if="marketTab !== BULL_VIEW_TAB_LIBRARY"
        v-model="activeRoundId"
        :options="roundTabOptions"
      />
      <div class="ml-auto flex items-center gap-2">
        <span v-if="syncing" class="text-xs text-text-secondary">{{ progressText || '同步中…' }}</span>
        <span v-else class="text-xs text-text-subtle">月K更新于 {{ syncedAtText }}</span>
        <BaseButton variant="ghost" :disabled="syncing" @click="runSync">更新到最新</BaseButton>
      </div>
    </div>

    <p
      v-if="syncError"
      class="rounded-lg bg-up-weak px-3 py-2 text-xs text-up"
    >
      同步失败：{{ syncError }}（网络恢复后可再次点击「更新到最新」）
    </p>

    <ModeLibraryView
      v-if="marketTab === BULL_VIEW_TAB_LIBRARY"
      :bull-rounds="BULL_ROUNDS"
      :bear-rounds="BEAR_ROUNDS"
      :series="snapshot.series"
    />

    <template v-else-if="activeRound">
      <BaseCard>
        <RoundArchiveCard :round="activeRound" :stats="activeStats" :mode="mode" />
      </BaseCard>

      <BaseCard :title="`行情阶段 · ${activeRound.indexName}月K`">
        <template #extra>
          <div class="flex items-center gap-3 text-xs text-text-secondary">
            <span v-for="legend in stageLegend" :key="legend.name" class="flex items-center gap-1">
              <i class="inline-block h-2.5 w-2.5 rounded-sm" :class="legend.dot" aria-hidden="true" />
              {{ legend.name }}
            </span>
          </div>
        </template>
        <RoundTimelineChart :round="activeRound" :bars="activeBars" :mode="mode" />
        <p v-if="activeBars.length < 2" class="text-xs text-text-secondary">
          首次同步完成后渲染（正在拉取 {{ activeRound.indexName }} 月K…）
        </p>
        <p class="mt-2 text-xs text-text-subtle">
          色带为复盘档案声明的阶段区间；顶 / 底与涨跌幅度由 judge.ts 从月K回算，关键位月份以数据为准。
        </p>
      </BaseCard>

      <BaseCard title="阶段明细">
        <template #extra>
          <span class="text-xs text-text-subtle">重点看各阶段的「演变」，而非单日读数</span>
        </template>
        <StageDetailGrid :stages="activeRound.stages" :mode="mode" />
      </BaseCard>

      <div class="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
        <BaseCard title="消息面 · 事件时间线">
          <template #extra>
            <span class="text-xs text-text-subtle">五类标注 · 区分「预期 / 落地」</span>
          </template>
          <RoundEventTimeline :events="activeRound.events" />
        </BaseCard>
        <BaseCard :title="mode === 'bear' ? '见底 & 出清复盘' : '见顶 & 瓦解复盘'">
          <template #extra>
            <span class="text-xs text-text-subtle">{{ mode === 'bear' ? '出清信号画像' : '多因子错配画像' }}</span>
          </template>
          <CollapseReviewCard
            :mismatch="activeRound.mismatch"
            :review="activeRound.review"
            :collapse-label="activeRound.collapseLabel"
          />
        </BaseCard>
      </div>
    </template>

    <p class="rounded-lg bg-flat-weak px-3 py-2 text-xs leading-relaxed text-text-secondary">
      复盘观点仅供参考，不构成投资建议。本面板定位是沉淀历史模式用于对标：能识别「已确认的退潮 / 见底」，
      不能预测崩盘或见底的具体时点；月K来自新浪源，落本地库（Tauri 端 SQLite / 浏览器端本地存储），
      重进页面不联网。
    </p>
  </div>
</template>

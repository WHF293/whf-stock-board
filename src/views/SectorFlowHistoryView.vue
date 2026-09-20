<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BoardFlowDailyCard from '../components/business/BoardFlowDailyCard.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import {
  ensureSectorFlowHistories,
  readSectorFlowHistory,
} from '../api/sector-flow-history.api';
import type { SectorFlowHistoryEntry } from '../api/sector-flow-history.api';
import { ROUTE_PATH } from '../constants/router-meta.constants';
import { useMarketStatusStore } from '../stores/market-status';

/**
 * 板块历史净流入（市场榜单-板块净流入 → 「查看历史净流入」详情页）
 *
 * 数据来源本地库（`whf:sector-flow-history`）：市场榜单-板块净流入页签内已选行业的
 * 逐日主力净流入随使用渐进累积——盘中进入页签 / 本页时拉新合并，盘后与非交易日只读本地。
 * 打开本页按 URL query 的 codes（BK 编号逗号分隔）确保数据就绪；无 codes 时直接读库展示。
 */
const route = useRoute();
const router = useRouter();
const marketStatus = useMarketStatusStore();

/** 板块历史（BK 编号索引，读自本地库） */
const historyMap = ref<Record<string, SectorFlowHistoryEntry>>({});
/** 确保数据就绪中（拉新合并） */
const isEnsuring = ref(false);
/** 展示顺序基准（URL query codes；空 = 库内自然顺序） */
const orderedCodes = ref<string[]>([]);

/**
 * 从 URL query 解析板块代码列表
 * @returns BK 编号列表（非法值过滤）
 */
const readCodesFromQuery = (): string[] => {
  const raw = route.query.codes;
  if (typeof raw !== 'string' || raw.length === 0) {
    return [];
  }
  return raw
    .split(',')
    .map((code) => code.trim())
    .filter((code) => /^BK\d{4,6}$/.test(code));
};

/** 库内全部板块（按最近数据日期降序，新的在前） */
const storeCodes = computed(() =>
  Object.entries(historyMap.value)
    .sort((a, b) => {
      const lastOf = (entry: SectorFlowHistoryEntry): string =>
        entry.points[entry.points.length - 1]?.date ?? '';
      return lastOf(b[1]).localeCompare(lastOf(a[1]));
    })
    .map(([code]) => code),
);

/** 展示列表：query 顺序优先，库内其余板块（最近有数据的在前）附后 */
const displayBoards = computed(() => {
  const seen = new Set<string>();
  const codes: string[] = [];
  for (const code of [...orderedCodes.value, ...storeCodes.value]) {
    if (historyMap.value[code] && !seen.has(code)) {
      seen.add(code);
      codes.push(code);
    }
  }
  return codes.map((code) => ({ code, ...historyMap.value[code] }));
});

/** 库内最早数据日期（YYYY-MM-DD，无数据为空串） */
const earliestDate = computed(() => {
  let earliest = '';
  for (const entry of Object.values(historyMap.value)) {
    const first = entry.points[0]?.date;
    if (first && (earliest === '' || first < earliest)) {
      earliest = first;
    }
  }
  return earliest;
});

/**
 * 确保数据就绪：按交易状态拉新合并 / 直接读库，随后刷新展示
 * @param force true 时无视节流强制拉新（「刷新」按钮）
 */
const ensureAndRender = async (force = false): Promise<void> => {
  isEnsuring.value = true;
  try {
    const codes = orderedCodes.value.length > 0 ? orderedCodes.value : storeCodes.value;
    historyMap.value = await ensureSectorFlowHistories(codes, {
      isTradingDay: marketStatus.isTradingDay === true,
      inPollingWindow: marketStatus.isASharePollingWindow,
      force,
    });
  } catch (error) {
    console.error('[sector-flow-history]', error);
  } finally {
    isEnsuring.value = false;
  }
};

onMounted(() => {
  orderedCodes.value = readCodesFromQuery();
  historyMap.value = readSectorFlowHistory();
  void ensureAndRender();
});

// 交易日历异步就绪后补一次判定（冷启动直接进本页时 isTradingDay 初始为 null）
watch(
  () => marketStatus.isTradingDay,
  (value, previous) => {
    if (value !== null && previous === null) {
      void ensureAndRender();
    }
  },
);

/** 返回市场榜单（用 push 而非 back：直接打开本页 / 刷新后 back 会退出应用） */
const goBack = (): void => {
  void router.push(ROUTE_PATH.MARKET_RANK);
};
</script>

<template>
  <div class="flex h-[calc(100dvh-6.5rem)] min-h-0 flex-col gap-4">
    <!-- 控制条：返回 / 标题与图例 / 统计 / 刷新 -->
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <div class="flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="pressable flex items-center gap-1 rounded-lg border border-flat-weak px-2.5 py-1 text-xs text-text-secondary hover:bg-flat-weak hover:text-text active:scale-95"
          title="返回市场榜单"
          @click="goBack"
        >
          <MenuIcon name="arrowLeft" :size="12" />
          市场榜单
        </button>
        <span class="text-sm font-semibold text-text">板块历史净流入</span>
        <span class="flex items-center gap-3 text-xs text-text-tertiary">
          <span class="flex items-center gap-1">
            <span class="inline-block size-2 rounded-sm bg-up"></span>左侧净流入
          </span>
          <span class="flex items-center gap-1">
            <span class="inline-block size-2 rounded-sm bg-down"></span>右侧净流出
          </span>
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-xs text-text-tertiary">
          {{ displayBoards.length }} 个板块<template v-if="earliestDate">
            · 数据自 {{ earliestDate }}</template><template v-if="isEnsuring"> · 更新中…</template>
        </span>
        <BaseButton variant="ghost" :disabled="isEnsuring" @click="ensureAndRender(true)">
          刷新
        </BaseButton>
      </div>
    </div>

    <!-- 卡片网格：逐日双向条形（盘中拉新合并，盘后读本地，随使用渐进累积） -->
    <BaseCard fill class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="isEnsuring && displayBoards.length === 0"><BaseSkeleton /></div>
      <div v-else-if="displayBoards.length > 0" class="grid grid-cols-1 gap-3 @2xl:grid-cols-2 @4xl:grid-cols-4">
        <BoardFlowDailyCard
          v-for="board in displayBoards"
          :key="board.code"
          :code="board.code"
          :name="board.name"
          :points="board.points"
        />
      </div>
      <div v-else class="py-10">
        <BaseEmpty text="暂无历史数据：在「市场榜单-板块净流入」选择行业后，历史净流入会随使用自动积累" />
      </div>
    </BaseCard>
  </div>
</template>

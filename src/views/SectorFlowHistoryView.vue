<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import BaseButton from '../components/ui/BaseButton.vue';
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
 * 数据来源本地库（`whf:sector-flow-history`）：逐日主力净流入随使用渐进累积——
 * 盘中进入页签 / 本页时拉新合并，盘后与非交易日只读本地。
 * 展示板块严格跟随曲线视图「选择行业」的当前勾选（URL query codes，BK 编号逗号分隔，
 * 勾几个展示几个）；进页即为这些板块确保历史就绪（未入库的一次补全量）。
 * 布局为两行横向卡片流（同热点新闻页），每板块一张卡，卡内最新交易日排最上。
 */
const route = useRoute();
const router = useRouter();
const marketStatus = useMarketStatusStore();

/** 板块历史（BK 编号索引，读自本地库） */
const historyMap = ref<Record<string, SectorFlowHistoryEntry>>({});
/** 确保数据就绪中（拉新合并） */
const isEnsuring = ref(false);
/** 展示板块 = 曲线视图「选择行业」当前勾选（URL query codes） */
const orderedCodes = ref<string[]>([]);
/** 勾选板块的名称映射（URL query names；失败占位卡的标题来源） */
const queryNames = ref<Record<string, string>>({});

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

/**
 * 从 URL query 解析板块名称映射（「BK 编号:名称」用 | 连接；MarketRankView 跳转时带上）
 * @returns BK 编号 → 名称（非法条目忽略）
 */
const readNamesFromQuery = (): Record<string, string> => {
  const raw = route.query.names;
  if (typeof raw !== 'string' || raw.length === 0) {
    return {};
  }
  const names: Record<string, string> = {};
  for (const pair of raw.split('|')) {
    const sep = pair.indexOf(':');
    const code = sep > 0 ? pair.slice(0, sep) : '';
    const name = sep > 0 ? pair.slice(sep + 1).trim() : '';
    if (/^BK\d{4,6}$/.test(code) && name) {
      names[code] = name;
    }
  }
  return names;
};

/** 库内全部板块（按最近数据日期降序，新的在前；直接打开本页无 query codes 时兜底展示） */
const storeCodes = computed(() =>
  Object.entries(historyMap.value)
    .sort((a, b) => {
      const lastOf = (entry: SectorFlowHistoryEntry): string =>
        entry.points[entry.points.length - 1]?.date ?? '';
      return lastOf(b[1]).localeCompare(lastOf(a[1]));
    })
    .map(([code]) => code),
);

/** 展示代码：URL query 的勾选清单优先（勾几个展示几个），无 query 时回退库内全部 */
const displayCodes = computed(() =>
  orderedCodes.value.length > 0 ? orderedCodes.value : storeCodes.value,
);

/** 展示列表：勾选清单逐个出卡；未入库（拉取失败 / 尚未就绪）的板块以占位卡展示 */
const displayBoards = computed(() =>
  displayCodes.value.map((code) => {
    const entry = historyMap.value[code];
    return {
      code,
      name: entry?.name ?? queryNames.value[code] ?? code,
      points: entry?.points ?? [],
      missing: !entry,
    };
  }),
);

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

/** 应展示而未入库的行业数（上游限流 / 板块无历史；非拉取中才统计，避免首屏误报） */
const missingCount = computed(() => {
  if (isEnsuring.value) {
    return 0;
  }
  return displayCodes.value.filter((code) => !historyMap.value[code]).length;
});

/**
 * 确保数据就绪：按交易状态拉新合并 / 直接读库，随后刷新展示
 * @param force true 时无视节流强制拉新（「刷新」按钮）
 */
const ensureAndRender = async (force = false): Promise<void> => {
  isEnsuring.value = true;
  try {
    const codes =
      orderedCodes.value.length > 0 ? orderedCodes.value : storeCodes.value;
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
  queryNames.value = readNamesFromQuery();
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
        <BaseButton variant="ghost" title="返回市场榜单" @click="goBack">
          <MenuIcon name="arrowLeft" :size="14" />
          市场榜单
        </BaseButton>
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
        <span
          v-if="missingCount > 0"
          class="text-xs text-down"
          title="这些行业的历史拉取失败（多为数据源限流封禁，约几十分钟解除）；请稍等后再点「刷新」补齐，勿频繁重试以免加重风控"
        >
          · {{ missingCount }} 个行业拉取失败，稍后请点「刷新」重试
        </span>
        <BaseButton variant="ghost" :disabled="isEnsuring" @click="ensureAndRender(true)">
          刷新
        </BaseButton>
      </div>
    </div>

    <!-- 卡片流：两行布满、横向滑动（同热点新闻页）；每板块一张卡，卡内逐日纵向滚动 -->
    <div class="min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
      <div v-if="isEnsuring && displayBoards.length === 0" class="h-full">
        <BaseSkeleton />
      </div>
      <div
        v-else-if="displayBoards.length > 0"
        class="grid h-full auto-cols-[375px] grid-flow-col grid-rows-2 gap-3"
      >
        <BoardFlowDailyCard
          v-for="board in displayBoards"
          :key="board.code"
          :code="board.code"
          :name="board.name"
          :points="board.points"
          :missing="board.missing"
        />
      </div>
      <div v-else class="py-10">
        <BaseEmpty text="暂无历史数据：在「市场榜单-板块净流入」的「选择行业」勾选行业后，这里展示它们的逐日净流入历史" />
      </div>
    </div>
  </div>
</template>

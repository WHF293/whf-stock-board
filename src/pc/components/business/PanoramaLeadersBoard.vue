<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { VueDraggable } from 'vue-draggable-plus';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import {
  LEADER_KIND,
  LEADER_KIND_OPTIONS,
  getLeaderGroups,
  type LeaderGroup,
  type LeaderKind,
} from '../../../common/constants/industry-leaders.constants.ts';
import { fetchLeaderQuotes, type LeaderQuote } from '../../../common/api/industry-leaders.api.ts';
import { usePolling } from '../../../common/composables/use-polling';
import { POLLING_INTERVAL } from '../../../common/constants/polling.constants.ts';
import { useStockOpen } from '../../../common/composables/use-stock-open';
import { getTrendByChangePercent } from '../../../common/constants/trend.constants.ts';
import { TREND_PILL_CLASS, TREND_TEXT_CLASS } from '../../../common/constants/stock-colors.constants.ts';
import { formatPercent } from '../../../common/utils/format-percent';
import { formatPrice } from '../../../common/utils/format-price';
import { appStorage } from '../../../common/utils/app-local-storage';
import { STORAGE_NS_PANORAMA_LEADERS_ORDER } from '../../../common/constants/storage-key.constants.ts';
import { ROUTE_PATH } from '../../../common/constants/router-meta.constants.ts';

/**
 * 行业龙头（2026-10-29 王总指定新增 tab）：
 * 「板块 / 细分赛道」双维度静态分组（清单单源 constants/industry-leaders.constants.ts，
 * 内容出自 .ai/项目资源/板块龙头.md），分组与成员不可增删，但分组顺序支持拖拽自定义
 * （2026-10-29 追加：把感兴趣的板块 / 赛道拖到前面；按维度分别持久化，跨会话保留）。
 *
 * 布局对齐自选股平铺看板：一个分组一张竖向卡片，卡片流「按容器高度自适应 2~5 行布满、
 * 左右横向滑动」（ResizeObserver 测高 → 行数 = clamp(高度 ÷ 卡片高, 2, 5)）。
 * 交互：单击卡片行开右侧个股详情侧栏，双击进个股详情整页（单击延迟派发合并双击，
 * 与 BaseTable enableDblclickNav 同款窗口）；点卡片标题进「行业龙头详情」整页
 * （该板块 / 赛道全部龙头的分时 / 日K 网格，排版参考宽基ETF页）；报价随行情轮询刷新。
 */

const { openSidebar, openPage } = useStockOpen();
const router = useRouter();

/**
 * 点分组卡片标题 → 行业龙头详情整页（query 携带维度与分组名）
 * @param group 被点击的分组
 */
const openLeaderDetail = (group: LeaderGroup): void => {
  void router.push({
    path: ROUTE_PATH.INDUSTRY_LEADER_DETAIL,
    query: { kind: kind.value, group: group.name },
  });
};

/** 当前维度（板块 / 细分赛道；会话内状态） */
const kind = ref<LeaderKind>(LEADER_KIND.BOARD);

// ---------- 分组自定义排序（拖拽卡片；按维度持久化到 appStorage） ----------

/** 排序持久化结构（分组名顺序；缺名的分组按清单原序追加在末尾） */
type LeadersOrderStorage = Partial<Record<LeaderKind, string[]>>;

/**
 * 读取持久化的分组顺序（坏数据一律回退空 = 全部按清单原序）
 * @returns 两个维度各自的分组名顺序
 */
const readOrderStorage = (): LeadersOrderStorage => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_PANORAMA_LEADERS_ORDER);
    const parsed = raw ? (JSON.parse(raw) as LeadersOrderStorage) : null;
    return {
      board: Array.isArray(parsed?.board) ? parsed.board : [],
      segment: Array.isArray(parsed?.segment) ? parsed.segment : [],
    };
  } catch {
    return { board: [], segment: [] };
  }
};

/** 两个维度的分组名顺序（跨会话持久化） */
const groupOrder = ref<LeadersOrderStorage>(readOrderStorage());

/** 排序持久化写回（仅内容变化时落盘） */
const persistOrder = (): void => {
  const serialized = JSON.stringify(groupOrder.value);
  if (appStorage.getItem(STORAGE_NS_PANORAMA_LEADERS_ORDER) !== serialized) {
    appStorage.setItem(STORAGE_NS_PANORAMA_LEADERS_ORDER, serialized);
  }
};

/**
 * 当前维度的分组列表：清单原序 + 自定义顺序重排（未出现在自定义序中的分组按原序追加末尾）
 */
const groups = computed<LeaderGroup[]>(() => {
  const list = [...getLeaderGroups(kind.value)];
  const order = groupOrder.value[kind.value] ?? [];
  const index = new Map(order.map((name, i) => [name, i]));
  return list.sort(
    (a, b) =>
      (index.get(a.name) ?? list.length) - (index.get(b.name) ?? list.length),
  );
});

/**
 * 拖拽落定：把新顺序（分组名数组）写回当前维度并持久化
 * @param ordered 拖拽后的分组列表
 */
const onGroupsReorder = (ordered: LeaderGroup[]): void => {
  groupOrder.value = { ...groupOrder.value, [kind.value]: ordered.map((group) => group.name) };
  persistOrder();
};

/** 全部标的符号（当前维度，供批量取数） */
const symbols = computed(() => groups.value.flatMap((group) => group.stocks.map((s) => s.symbol)));

/** 报价映射（完整符号 → 轻报价） */
const quotesMap = ref<Map<string, LeaderQuote>>(new Map());
const isLoading = ref(false);
const isError = ref(false);

/** 拉取报价（进行中调用共享同一任务防重入） */
let quotesTask: Promise<void> | null = null;
const fetchQuotes = async (): Promise<void> => {
  if (!quotesTask) {
    quotesTask = (async () => {
      isError.value = false;
      try {
        quotesMap.value = await fetchLeaderQuotes(symbols.value);
      } catch (error) {
        isError.value = quotesMap.value.size === 0;
        console.error('[industry-leaders]', error);
      } finally {
        isLoading.value = false;
      }
    })().finally(() => {
      quotesTask = null;
    });
  }
  return quotesTask;
};

usePolling({
  task: fetchQuotes,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
});

// 挂载即拉一次
void fetchQuotes();

// ---------- 行数自适应：容器高度 → 卡片流行数（2~5 行） ----------

/** 横向滚动容器引用 */
const boardRef = ref<HTMLDivElement | null>(null);

/** 当前行数（默认 2 行兜底） */
const rowCount = ref(2);

/** 行数上下限（最低 2 行保横向滑动形态，最高 5 行防矮屏挤压） */
const ROW_COUNT_MIN = 2;
const ROW_COUNT_MAX = 5;

/** 单张卡片的目标高度（像素；含卡头与 5 行标的的舒适高度） */
const CARD_TARGET_HEIGHT_PX = 264;

/** 容器内边距留量（像素；上下 gap 与滚动条余量） */
const BOARD_HEIGHT_PADDING_PX = 24;

/**
 * 按容器高度重算行数：rows = clamp(⌊高度 ÷ 卡片高⌋, 2, 5)
 * @param entry ResizeObserver 条目
 */
const updateRowCount = (entry: ResizeObserverEntry): void => {
  const fit = Math.floor(
    (entry.contentRect.height - BOARD_HEIGHT_PADDING_PX) / CARD_TARGET_HEIGHT_PX,
  );
  rowCount.value = Math.min(ROW_COUNT_MAX, Math.max(ROW_COUNT_MIN, fit));
};

/** ResizeObserver 句柄（卸载时断开） */
let boardObserver: ResizeObserver | null = null;

onMounted(() => {
  if (!boardRef.value || typeof ResizeObserver === 'undefined') return;
  boardObserver = new ResizeObserver((entries) => {
    const entry = entries[0];
    if (entry) updateRowCount(entry);
  });
  boardObserver.observe(boardRef.value);
});

onBeforeUnmount(() => {
  boardObserver?.disconnect();
  boardObserver = null;
});

// ---------- 单击 / 双击合并派发（与 BaseTable enableDblclickNav 同窗口） ----------

/** 单击延迟派发定时器（null = 无待派发单击） */
const pendingClick = ref<{ timer: number; symbol: string } | null>(null);

/** 单击/双击合并窗口（毫秒） */
const DBLCLICK_MERGE_MS = 250;

/**
 * 行单击：延迟派发开侧栏，窗口内收到双击则取消
 * @param symbol 完整符号
 */
const onRowClick = (symbol: string): void => {
  if (pendingClick.value) {
    window.clearTimeout(pendingClick.value.timer);
  }
  const timer = window.setTimeout(() => {
    pendingClick.value = null;
    openSidebar(symbol);
  }, DBLCLICK_MERGE_MS);
  pendingClick.value = { timer, symbol };
};

/**
 * 行双击：取消未派发的单击，直接进详情整页
 * @param symbol 完整符号
 */
const onRowDblclick = (symbol: string): void => {
  if (pendingClick.value) {
    window.clearTimeout(pendingClick.value.timer);
    pendingClick.value = null;
  }
  openPage(symbol);
};
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2">
    <!-- 维度切换：板块 / 细分赛道 -->
    <div class="flex shrink-0 items-center gap-2">
      <BaseTabs v-model="kind" :options="LEADER_KIND_OPTIONS" />
      <span class="text-xs text-text-tertiary">
        单击开侧栏 · 双击进详情页 · 点卡片标题看龙头K线 · 拖拽卡片把感兴趣的板块 / 赛道移到前面（自动记住）
      </span>
    </div>

    <!-- 首载骨架 -->
    <div v-if="isLoading && quotesMap.size === 0" class="flex-1">
      <BaseSkeleton />
    </div>

    <!-- 失败空态 -->
    <BaseCard v-else-if="isError">
      <BaseEmpty text="龙头报价加载失败，请稍后重试" />
    </BaseCard>

    <!-- 卡片流：按容器高度自适应 2~5 行布满、左右横向滑动（grid-flow-col 纵向先填满一列再横向）；
           拖拽卡片 = 调整分组顺序（Sortable 指针事件模拟，Tauri 下可用，见 WatchlistTiledBoard 同款） -->
    <div
      ref="boardRef"
      class="min-h-0 flex-1 overflow-x-auto overflow-y-hidden pb-1"
    >
      <VueDraggable
        tag="div"
        :model-value="groups"
        :animation="150"
        ghost-class="opacity-40"
        :force-fallback="true"
        class="grid h-full auto-cols-[264px] grid-flow-col gap-3"
        :style="{ gridTemplateRows: `repeat(${rowCount}, minmax(0, 1fr))` }"
        @update:model-value="onGroupsReorder"
      >
        <BaseCard
          v-for="group in groups"
          :key="group.name"
          class="!flex !min-h-0 !flex-col !overflow-hidden !p-0"
        >
          <!-- 卡头：分组名（标的数；点击进龙头详情整页，pressable 按压动效） -->
          <header
            class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-4 py-2.5"
          >
            <button
              type="button"
              data-track="LEADERS_OPEN_DETAIL"
              class="pressable flex min-w-0 items-center gap-1 rounded text-sm font-semibold text-text hover:text-primary"
              :title="`查看「${group.name}」龙头详情（分时 / 日K）`"
              @click="openLeaderDetail(group)"
            >
              <span class="min-w-0 truncate">{{ group.name }}</span>
              <span class="shrink-0">（{{ group.stocks.length }}）</span>
              <MenuIcon name="chevronRight" :size="13" class="shrink-0 text-text-tertiary" />
            </button>
          </header>

          <!-- 卡体：标的行（名称（代码）/ 现价 / 涨跌幅；组内超行滚动） -->
          <div class="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
            <div
              v-for="stock in group.stocks"
              :key="stock.symbol"
              class="flex cursor-pointer items-center gap-2 rounded-lg border border-flat-weak bg-flat-weak/40 px-2 py-1.5 transition-colors hover:bg-flat-weak"
              :title="`${stock.name}（${stock.symbol.slice(2)}）`"
              @click="onRowClick(stock.symbol)"
              @dblclick="onRowDblclick(stock.symbol)"
            >
              <span class="min-w-0 flex-1 truncate text-sm font-medium text-text">
                {{ quotesMap.get(stock.symbol)?.name ?? stock.name }}
                <span class="ml-1 font-mono text-xs text-text-tertiary">
                  {{ stock.symbol.slice(2) }}
                </span>
              </span>
              <span
                class="shrink-0 text-sm font-medium"
                :class="
                  TREND_TEXT_CLASS[getTrendByChangePercent(quotesMap.get(stock.symbol)?.changePercent ?? 0)]
                "
              >
                {{ formatPrice(quotesMap.get(stock.symbol)?.price ?? null) }}
              </span>
              <span
                class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold"
                :class="
                  TREND_PILL_CLASS[getTrendByChangePercent(quotesMap.get(stock.symbol)?.changePercent ?? 0)]
                "
              >
                {{ formatPercent(quotesMap.get(stock.symbol)?.changePercent ?? null) }}
              </span>
            </div>
          </div>
        </BaseCard>
      </VueDraggable>
    </div>
  </div>
</template>

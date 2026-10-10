<script setup lang="ts">
import { computed, onActivated, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseModal from '../components/ui/BaseModal.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import HotBoardCard from '../components/hot-board/HotBoardCard.vue';
import HotBoardList from '../components/hot-board/HotBoardList.vue';
import HotBoardSourceModal from '../components/hot-board/HotBoardSourceModal.vue';
import HotNewsChannelBar from '../components/news/HotNewsChannelBar.vue';
import { fetchHotBoard } from '../../common/api/hot-board.api.ts';
import type { HotBoardItem } from '../../common/types/hot-board.types.ts';
import { useDataCacheStore } from '../../common/stores/data-cache';
import { useDockPanelStore } from '../../common/stores/dock-panel';
import { useStockContextStore, type ContextStock } from '../../common/stores/stock-context';
import { useNotificationsStore } from '../../common/stores/notifications';
import { DATA_CACHE_KEY } from '../../common/constants/data-cache.constants.ts';
import { HOST_HEADER_ITEM } from '../../common/constants/header.constants.ts';
import { NOTIFY_TONE } from '../../common/constants/notify.constants.ts';
import { STORAGE_NS_HOT_BOARD_FILTER } from '../../common/constants/storage-key.constants.ts';
import { ROUTE_PATH } from '../../common/constants/router-meta.constants.ts';
import {
  BOARD_CACHE_TTL_MS,
  BOARD_GROUPS,
  BOARD_SOURCE_LABELS,
  BOARD_SOURCE_LOGOS,
  BOARD_SOURCE_ORDER,
  type BoardSource,
} from '../../common/constants/hot-board.constants.ts';
import { appStorage } from '../../common/utils/app-local-storage';
import { buildHotBoardPrompt, type BoardPromptSection } from '../../common/utils/build-hot-board-prompt';
import { requestAgentAnalysis } from '../agent/agent-bridge';
import { useSettingsStore } from '../../common/stores/settings';

/**
 * 今天炒什么：五平台热股榜单聚合页
 *
 * 每平台一张 375px 横向卡片（同花顺 / 东财 / 财联社 / 通达信 / 雪球），
 * 卡片内保留该平台自己的榜单分组（chips 切换，A 股口径）；
 * 各分组均为单页快照（无翻页），数据经 30 分钟 TTL 缓存跨页复用；
 * 点击榜单行打开个股详情停靠面板；顶部「AI 分析」把当前启用平台的
 * 榜单清单投递 Agent 窗口；「平台设置」弹窗勾选显隐 + 拖拽排序（草稿模式）
 */

/** 单平台单分组的加载状态（通道键 = `source#group`） */
interface BoardState {
  items: HotBoardItem[];
  /** 是否加载中 */
  loading: boolean;
  /** 是否出错 */
  error: boolean;
  /** 是否已完成首次加载（30 分钟内复用快照不再请求） */
  initialized: boolean;
  /** 快照抓取时间（毫秒），判定缓存是否过期 */
  fetchedAt: number;
}

/** 持久化的单平台设置条目（label 不落盘，渲染时经 BOARD_SOURCE_LABELS 查询） */
interface SourceItem {
  value: BoardSource;
  enabled: boolean;
}

/**
 * 从 appStorage 加载平台设置（顺序 + 勾选）
 * @returns 平台设置列表（顺序即卡片渲染顺序；缺源追加末尾默认开启）
 */
const loadSourceItems = (): SourceItem[] => {
  const raw = appStorage.getItem(STORAGE_NS_HOT_BOARD_FILTER);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (item): item is { value: string; enabled: boolean } =>
            !!item &&
            typeof item === 'object' &&
            'value' in item &&
            typeof item.value === 'string' &&
            BOARD_SOURCE_ORDER.includes(item.value as BoardSource) &&
            typeof item.enabled === 'boolean',
        );
        const known = new Set(valid.map((item) => item.value as BoardSource));
        const restored = valid.map((item) => ({
          value: item.value as BoardSource,
          enabled: item.enabled,
        }));
        const appended = BOARD_SOURCE_ORDER.filter((value) => !known.has(value)).map(
          (value) => ({ value, enabled: true }),
        );
        return [...restored, ...appended];
      }
    } catch (error) {
      console.error('[hot-board] 平台设置解析失败', error);
    }
  }
  return BOARD_SOURCE_ORDER.map((value) => ({ value, enabled: true }));
};

/** 平台设置列表（数组顺序 = 卡片渲染顺序；持久化到 appStorage） */
const sourceItems = ref<SourceItem[]>(loadSourceItems());

// 读取结果与存储原文不一致时立即回写一次（缺源补齐后保持存储与页面一致）
if (appStorage.getItem(STORAGE_NS_HOT_BOARD_FILTER) !== JSON.stringify(sourceItems.value)) {
  appStorage.setItem(STORAGE_NS_HOT_BOARD_FILTER, JSON.stringify(sourceItems.value));
}

/** 顺序或勾选变化时整包同步到 appStorage（深监听覆盖拖拽重排与勾选切换） */
watch(
  sourceItems,
  (val) => {
    appStorage.setItem(STORAGE_NS_HOT_BOARD_FILTER, JSON.stringify(val));
  },
  { deep: true },
);

/** 「平台设置」弹窗开关（默认收起） */
const sourceModalOpen = ref(false);

/** 已启用的平台（卡片流渲染口径） */
const visibleSources = computed(() => sourceItems.value.filter((item) => item.enabled));

/** 设置弹窗选项（含展示名；顺序 = 卡片顺序） */
const sourceOptions = computed(() =>
  sourceItems.value.map((item) => ({
    value: item.value,
    label: BOARD_SOURCE_LABELS[item.value],
    enabled: item.enabled,
  })),
);

/**
 * 平台设置确认：整包替换（新增启用的平台在 watch 里补拉首屏）
 * @param items 弹窗回传的勾选与顺序
 */
const onSourceConfirm = (items: { value: string; enabled: boolean }[]): void => {
  sourceItems.value = items
    .map(({ value, enabled }) => ({ value: value as BoardSource, enabled }));
};

/** 各平台当前选中分组（默认各源第一个分组；会话级不持久化） */
const selectedGroups = ref<Record<BoardSource, string>>(
  Object.fromEntries(
    BOARD_SOURCE_ORDER.map((source) => [source, BOARD_GROUPS[source][0].value]),
  ) as Record<BoardSource, string>,
);

const dataCache = useDataCacheStore();
const dockPanel = useDockPanelStore();
const stockContext = useStockContextStore();
const notifications = useNotificationsStore();
const router = useRouter();

/**
 * 缓存是否在有效期内
 * @param fetchedAt 抓取时间戳（毫秒）
 * @returns 是否未过期
 */
const isFresh = (fetchedAt: number): boolean =>
  fetchedAt > 0 && Date.now() - fetchedAt < BOARD_CACHE_TTL_MS;

/**
 * 空白通道状态（未加载 / 被强制刷新重置）
 * @returns 初始通道状态
 */
const createEmptyState = (): BoardState => ({
  items: [],
  loading: false,
  error: false,
  initialized: false,
  fetchedAt: 0,
});

/** 各通道状态（键 = `source#group`，按需创建） */
const states = ref<Record<string, BoardState>>({});

/**
 * 从快照恢复或创建通道状态：
 * - 快照在 30 分钟有效期内：整包恢复且不发请求；
 * - 快照缺失或已过期：回空白态等待拉取
 * @param source 平台
 * @param group 分组值
 * @returns 通道状态
 */
const getOrCreateState = (source: BoardSource, group: string): BoardState => {
  const key = `${source}#${group}`;
  const existing = states.value[key];
  if (existing) return existing;
  const entry = dataCache.get<{ items: BoardState['items']; fetchedAt: number }>(
    DATA_CACHE_KEY.HOT_BOARD_ITEMS + key,
  );
  const restored: BoardState =
    entry && isFresh(entry.fetchedAt)
      ? {
          items: entry.items,
          loading: false,
          error: false,
          initialized: true,
          fetchedAt: entry.fetchedAt,
        }
      : createEmptyState();
  states.value[key] = restored;
  return restored;
};

/** 卡片渲染视图（平台元信息 + 当前选中分组状态） */
const cardViews = computed(() =>
  visibleSources.value.map(({ value }) => {
    const group = selectedGroups.value[value];
    return {
      source: value,
      label: BOARD_SOURCE_LABELS[value],
      logo: BOARD_SOURCE_LOGOS[value],
      groups: BOARD_GROUPS[value],
      activeGroup: group,
      state: getOrCreateState(value, group),
    };
  }),
);

/**
 * 拉取指定通道（幂等：已初始化或加载中不重复请求）并写缓存
 * @param source 平台
 * @param group 分组值
 */
const loadBoard = async (source: BoardSource, group: string): Promise<void> => {
  const state = getOrCreateState(source, group);
  if (state.loading || state.initialized) return;
  state.loading = true;
  state.error = false;
  try {
    const items = await fetchHotBoard(source, group);
    // 加载期间用户可能已切走分组，只有仍是当前通道才落状态
    if (selectedGroups.value[source] !== group) return;
    state.items = items;
    state.initialized = true;
    state.fetchedAt = Date.now();
    dataCache.set(DATA_CACHE_KEY.HOT_BOARD_ITEMS + `${source}#${group}`, {
      items,
      fetchedAt: state.fetchedAt,
    });
  } catch (error) {
    if (selectedGroups.value[source] === group) {
      state.error = true;
    }
    console.error('[hot-board]', source, group, error);
  } finally {
    if (selectedGroups.value[source] === group) {
      state.loading = false;
    }
  }
};

/**
 * 就绪某平台当前分组的首屏（幂等）
 * @param source 平台
 */
const ensureSourceLoaded = (source: BoardSource): void => {
  const group = selectedGroups.value[source];
  const state = getOrCreateState(source, group);
  if (!state.initialized && !state.loading) void loadBoard(source, group);
};

/**
 * 切换平台分组（切过去时按需补拉该分组首屏）
 * @param source 平台
 * @param group 目标分组值
 */
const selectGroup = (source: BoardSource, group: string): void => {
  if (selectedGroups.value[source] === group) return;
  selectedGroups.value[source] = group;
  ensureSourceLoaded(source);
};

/**
 * 强制清空指定平台当前分组缓存并重拉（无视 30 分钟 TTL）
 * @param source 平台
 */
const forceRefresh = (source: BoardSource): void => {
  const group = selectedGroups.value[source];
  const key = `${source}#${group}`;
  dataCache.set(DATA_CACHE_KEY.HOT_BOARD_ITEMS + key, null);
  states.value[key] = createEmptyState();
  void loadBoard(source, group);
};

// 首屏：并发就绪已启用平台的默认分组（未启用的不请求）
onMounted(() => {
  for (const { value, enabled } of sourceItems.value) {
    if (enabled) ensureSourceLoaded(value);
  }
});

// KeepAlive 缓存页面：切走再切回不重新挂载，这里兜底「缓存超 30 分钟自动刷新」——
// 已初始化且快照过期的平台当前分组强制重拉（未初始化的交给 onMounted 首屏，避免重复请求）
onActivated(() => {
  for (const { value, enabled } of sourceItems.value) {
    if (!enabled) continue;
    const state = getOrCreateState(value, selectedGroups.value[value]);
    if (state.initialized && !isFresh(state.fetchedAt)) {
      forceRefresh(value);
    }
  }
});

// 勾选新启用的平台时补拉首屏（首屏只拉已勾选的，避免为隐藏卡片白打上游）
watch(
  sourceItems,
  (items) => {
    for (const { value, enabled } of items) {
      if (enabled) ensureSourceLoaded(value);
    }
  },
  { deep: true },
);

// ---------- 个股详情面板 ----------

/**
 * 打开榜单行对应的个股详情（右侧停靠面板，全站统一交互）
 * @param item 榜单条目
 */
const openStockDetail = (item: HotBoardItem): void => {
  dockPanel.openStock(item.symbol);
};

// ---------- 放大弹窗（宽版两列，复用当前通道数据） ----------

/** 放大弹窗开关 */
const expandedOpen = ref(false);

/** 放大弹窗展示的平台（关闭后保留旧值，避免淡出动画期间正文先消失） */
const expandedSource = ref<BoardSource>('ths');

/** 放大弹窗的通道状态 */
const expandedState = computed<BoardState>(() =>
  getOrCreateState(expandedSource.value, selectedGroups.value[expandedSource.value]),
);

/** 放大弹窗标题（平台名 · 当前分组名） */
const expandedTitle = computed(() => {
  const source = expandedSource.value;
  const group = selectedGroups.value[source];
  const groupLabel =
    BOARD_GROUPS[source].find((option) => option.value === group)?.label ?? group;
  return `${BOARD_SOURCE_LABELS[source]} · ${groupLabel}`;
});

/**
 * 打开放大弹窗（顺带补齐首屏，避免放大后是空列表）
 * @param source 平台
 */
const openExpanded = (source: BoardSource): void => {
  expandedSource.value = source;
  expandedOpen.value = true;
  ensureSourceLoaded(source);
};

/**
 * 行双击：打开个股详情整页
 *
 * 先把当前榜单全部条目写入 stockContext（详情页左侧「来源列表」即本榜，
 * 可在榜内一键切换 + Ctrl+↑↓ 顺序切换），再路由跳转。
 * 放大弹窗内双击取弹窗平台；卡片内按条目反查所属卡片
 * @param item 双击的条目
 */
const openStockPage = (item: HotBoardItem): void => {
  const card = expandedOpen.value
    ? cardViews.value.find((view) => view.source === expandedSource.value)
    : cardViews.value.find((view) => view.state.items.some((row) => row.symbol === item.symbol));
  const items = card && card.state.items.length > 0 ? card.state.items : [item];
  const stocks: ContextStock[] = items.map((board) => ({
    symbol: board.symbol,
    name: board.name,
    price: board.price,
    changePercent: board.changePct,
  }));
  stockContext.setContext(stocks);
  void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${item.symbol}`);
};

// ---------- AI 分析 ----------

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关 */
const settingsStore = useSettingsStore();
const agentEntryVisible = computed(() =>
  !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/** 「AI 分析」运行态：防重入 */
const aiRunning = ref(false);

/**
 * 收集当前启用平台的榜单数据段（AI 分析口径：各平台当前选中分组）
 * @returns 榜单数据段列表（顺序 = 卡片顺序）
 */
const collectBoardSections = (): BoardPromptSection[] =>
  visibleSources.value.map(({ value }) => {
    const group = selectedGroups.value[value];
    return {
      boardLabel: BOARD_SOURCE_LABELS[value],
      groupLabel:
        BOARD_GROUPS[value].find((option) => option.value === group)?.label ?? group,
      items: getOrCreateState(value, group).items,
    };
  });

/**
 * 发起「AI 分析」：把当前启用平台的榜单清单投递 Agent 窗口
 * @param scope 指定平台时只分析该平台当前分组；省略分析全部启用平台
 */
const runBoardAnalysis = async (scope?: BoardSource): Promise<void> => {
  if (aiRunning.value) return;
  const sections =
    scope === undefined
      ? collectBoardSections()
      : collectBoardSections().filter((section) => section.boardLabel === BOARD_SOURCE_LABELS[scope]);
  const prompt = buildHotBoardPrompt(sections);
  if (prompt === '') {
    notifications.push({
      title: '暂无可分析的榜单',
      body: '请等待榜单加载完成后再发起 AI 分析',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  aiRunning.value = true;
  try {
    await requestAgentAnalysis(prompt);
  } finally {
    aiRunning.value = false;
  }
};
</script>

<template>
  <!-- 单根容器：MainLayout 通过 :class="pageAnim" 下发页面进入动画类名，
         而多根组件无法继承 attrs（会丢动画并刷 Vue warn），故统一包一层 -->
  <div>
    <!-- 顶部工具条：启用计数 + AI 分析 + 平台设置 -->
    <div class="flex shrink-0 items-center justify-between border-b border-flat-weak px-4 py-2">
      <span class="text-xs text-text-tertiary">
        已启用 {{ visibleSources.length }} / {{ sourceItems.length }} 个平台
      </span>
      <div class="flex items-center gap-2">
        <BaseButton v-if="agentEntryVisible" variant="ghost" :disabled="aiRunning" @click="runBoardAnalysis()">
          <MenuIcon name="agent" :size="14" />
          {{ aiRunning ? '分析中...' : 'AI 分析' }}
        </BaseButton>
        <BaseButton variant="ghost" @click="sourceModalOpen = true">
          <MenuIcon name="settings" :size="14" />
          平台设置
        </BaseButton>
      </div>
    </div>

    <!-- 平台设置弹窗（草稿模式：确认才生效） -->
    <HotBoardSourceModal v-model:open="sourceModalOpen" :items="sourceOptions" @confirm="onSourceConfirm" />

    <!-- 放大弹窗：宽版两列布局，复用该平台当前分组的数据（不另开请求） -->
    <BaseModal
      v-model:open="expandedOpen"
      :title="expandedTitle"
      max-width-class="max-w-5xl"
      height-class="h-[70dvh]"
    >
      <template #filters>
        <HotNewsChannelBar
          v-if="BOARD_GROUPS[expandedSource].length > 1"
          :views="BOARD_GROUPS[expandedSource]"
          :active="selectedGroups[expandedSource]"
          roomy
          @select-view="(group: string) => selectGroup(expandedSource, group)"
        />
      </template>

      <HotBoardList
        :items="expandedState.items"
        :loading="expandedState.loading"
        :error="expandedState.error"
        :initialized="expandedState.initialized"
        :columns="2"
        @open="openStockDetail"
        @open-page="openStockPage"
      />

      <template #footer>
        <span class="mr-auto text-xs text-text-tertiary">共 {{ expandedState.items.length }} 只</span>
        <BaseButton variant="ghost" :disabled="expandedState.loading" @click="forceRefresh(expandedSource)">
          强制刷新
        </BaseButton>
      </template>
    </BaseModal>

    <!-- 横向卡片流：每平台一张 375px 卡片，超出页面横向滚动 -->
    <!-- 高度用 100dvh - 9rem：扣除 MainLayout 头部与工具条的既有口径（与热点新闻页一致） -->
    <div class="flex h-[calc(100dvh-9rem)] min-h-0 gap-4 overflow-x-auto p-4">
      <HotBoardCard
        v-for="card in cardViews"
        :key="card.source"
        v-bind="card"
        :ai-running="aiRunning"
        @select-group="selectGroup"
        @refresh="forceRefresh"
        @expand="openExpanded"
        @ai="runBoardAnalysis"
        @open-stock="openStockDetail"
        @open-stock-page="openStockPage"
      />
    </div>
  </div>
</template>

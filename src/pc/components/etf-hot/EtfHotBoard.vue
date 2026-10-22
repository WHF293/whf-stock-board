<script setup lang="ts">
import { computed, onActivated, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import HotBoardList from '../hot-board/HotBoardList.vue';
import EtfHotCard from './EtfHotCard.vue';
import { fetchEtfBoard } from '../../../common/api/etf-hot.api.ts';
import type { HotBoardItem } from '../../../common/types/hot-board.types.ts';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { useDockPanelStore } from '../../../common/stores/dock-panel';
import { useStockContextStore, type ContextStock } from '../../../common/stores/stock-context';
import { useNotificationsStore } from '../../../common/stores/notifications';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import { usePageHeaderSlot, PAGE_HEADER_ACTIONS_TARGET } from '../../../common/composables/use-page-header-slot';
import { ROUTE_PATH } from '../../../common/constants/router-meta.constants.ts';
import {
  ETF_BOARD_CACHE_TTL_MS,
  ETF_HOT_BOARDS,
  type EtfBoardKey,
} from '../../../common/constants/etf-hot.constants.ts';
import { buildHotBoardPrompt, type BoardPromptSection } from '../../../common/utils/build-hot-board-prompt';
import { requestAgentAnalysis } from '../../agent/agent-bridge';
import { NOTIFY_TONE } from '../../../common/constants/notify.constants.ts';

/**
 * ETF 热榜视图（今天炒什么页的「ETF 热榜」模式）
 *
 * 同花顺四榜单聚合：热度榜 / 自选榜 / 补涨榜 / T+0 榜，一个榜单单独一列
 * （无分组切换，每个榜单即一个固定通道）；数据经 30 分钟 TTL 缓存跨页复用；
 * 点击榜单行打开详情停靠面板（ETF 符号 sh51/sz15 段为合法报价标的）；
 * 页头「AI 分析」把四榜单清单投递 Agent 窗口（模式切换条由宿主页负责）
 */

/** 单榜单的加载状态（通道键 = 榜单 key） */
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
  fetchedAt > 0 && Date.now() - fetchedAt < ETF_BOARD_CACHE_TTL_MS;

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

/** 各通道状态（键 = 榜单 key，按需创建） */
const states = ref<Record<string, BoardState>>({});

/**
 * 从快照恢复或创建通道状态：
 * - 快照在 30 分钟有效期内：整包恢复且不发请求；
 * - 快照缺失或已过期：回空白态等待拉取
 * @param key 榜单 key
 * @returns 通道状态
 */
const getOrCreateState = (key: EtfBoardKey): BoardState => {
  const existing = states.value[key];
  if (existing) return existing;
  const entry = dataCache.get<{ items: HotBoardItem[]; fetchedAt: number }>(
    DATA_CACHE_KEY.ETF_BOARD_ITEMS + key,
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

/** 卡片渲染视图（榜单元信息 + 数据状态） */
const cardViews = computed(() =>
  ETF_HOT_BOARDS.map((board) => ({ board, state: getOrCreateState(board.key) })),
);

/**
 * 拉取指定通道（幂等：已初始化或加载中不重复请求）并写缓存
 * @param key 榜单 key
 */
const loadBoard = async (key: EtfBoardKey): Promise<void> => {
  const state = getOrCreateState(key);
  if (state.loading || state.initialized) return;
  state.loading = true;
  state.error = false;
  try {
    const items = await fetchEtfBoard(key);
    state.items = items;
    state.initialized = true;
    state.fetchedAt = Date.now();
    dataCache.set(DATA_CACHE_KEY.ETF_BOARD_ITEMS + key, {
      items,
      fetchedAt: state.fetchedAt,
    });
  } catch (error) {
    state.error = true;
    console.error('[etf-hot]', key, error);
  } finally {
    state.loading = false;
  }
};

/**
 * 强制清空指定榜单缓存并重拉（无视 30 分钟 TTL）
 * @param key 榜单 key
 */
const forceRefresh = (key: EtfBoardKey): void => {
  dataCache.set(DATA_CACHE_KEY.ETF_BOARD_ITEMS + key, null);
  states.value[key] = createEmptyState();
  void loadBoard(key);
};

// 首屏：并发就绪四个榜单（模式切进来时挂载即触发）
onMounted(() => {
  for (const { key } of ETF_HOT_BOARDS) void loadBoard(key);
});

// KeepAlive 缓存页面：切走再切回不重新挂载，这里兜底「缓存超 30 分钟自动刷新」
// （activated 沿组件树传播，页面级 KeepAlive 的切回对子组件同样生效）
onActivated(() => {
  for (const { key } of ETF_HOT_BOARDS) {
    const state = getOrCreateState(key);
    if (state.initialized && !isFresh(state.fetchedAt)) {
      forceRefresh(key);
    }
  }
});

// ---------- 详情面板 / 详情整页 ----------

/**
 * 打开榜单行对应的详情（右侧停靠面板，全站统一交互）
 * @param item 榜单条目
 */
const openStockDetail = (item: HotBoardItem): void => {
  dockPanel.openStock(item.symbol);
};

/**
 * 行双击：打开详情整页
 *
 * 先把所属榜单全部条目写入 stockContext（详情页左侧「来源列表」即本榜），
 * 再路由跳转
 * @param item 双击的条目
 */
const openStockPage = (item: HotBoardItem): void => {
  const card = cardViews.value.find((view) =>
    view.state.items.some((row) => row.symbol === item.symbol),
  );
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

// ---------- 放大弹窗（宽版两列，复用当前通道数据） ----------

/** 放大弹窗开关 */
const expandedOpen = ref(false);

/** 放大弹窗展示的榜单（关闭后保留旧值，避免淡出动画期间正文先消失） */
const expandedKey = ref<EtfBoardKey>('hot');

/** 放大弹窗的通道状态 */
const expandedState = computed<BoardState>(() => getOrCreateState(expandedKey.value));

/** 放大弹窗标题（榜单名 · 口径说明；未匹配到榜单（理论不可达）回落空串） */
const expandedTitle = computed(() => {
  const board = ETF_HOT_BOARDS.find((option) => option.key === expandedKey.value);
  return board === undefined ? '' : `${board.label} · ${board.desc}`;
});

/**
 * 打开放大弹窗
 * @param key 榜单 key
 */
const openExpanded = (key: EtfBoardKey): void => {
  expandedKey.value = key;
  expandedOpen.value = true;
};

// ---------- AI 分析 ----------

/** 页头动作挂载守卫：只有页面激活时按钮才出现在页头（KeepAlive 缓存页切走不残留） */
const { active: headerSlotActive } = usePageHeaderSlot();

/** 「AI 分析」运行态：防重入 */
const aiRunning = ref(false);

/**
 * 收集四榜单数据段（AI 分析口径）
 * @returns 榜单数据段列表
 */
const collectBoardSections = (): BoardPromptSection[] =>
  ETF_HOT_BOARDS.map(({ key, label }) => ({
    boardLabel: 'ETF 热榜',
    groupLabel: label,
    items: getOrCreateState(key).items,
  }));

/**
 * 发起「AI 分析」：把四榜单清单投递 Agent 窗口
 */
const runBoardAnalysis = async (): Promise<void> => {
  if (aiRunning.value) return;
  const prompt = buildHotBoardPrompt(collectBoardSections());
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
  <!-- 根容器撑满宿主页 tab 行以下的剩余高度（外部传入 min-h-0 flex-1） -->
  <div class="flex h-full min-h-0 flex-col">
    <!-- 页头动作上移 MainLayout 页头：数据源标注 + AI 分析
         （模式切换条由宿主页负责，本组件只补 ETF 专属动作） -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-tertiary">数据源：同花顺 ETF 热榜</span>
        <BaseButton variant="ghost" :disabled="aiRunning" @click="runBoardAnalysis">
          <MenuIcon name="agent" :size="14" />
          {{ aiRunning ? '分析中...' : 'AI 分析' }}
        </BaseButton>
      </div>
    </Teleport>

    <!-- 放大弹窗：宽版两列布局，复用该榜单的数据（不另开请求） -->
    <BaseModal
      v-model:open="expandedOpen"
      :title="expandedTitle"
      max-width-class="max-w-5xl"
      height-class="h-[70dvh]"
    >
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
        <BaseButton variant="ghost" :disabled="expandedState.loading" @click="forceRefresh(expandedKey)">
          强制刷新
        </BaseButton>
      </template>
    </BaseModal>

    <!-- 横向卡片流：每榜单一张 375px 卡片，超出页面横向滚动（撑满剩余高度） -->
    <div class="flex min-h-0 flex-1 gap-4 overflow-x-auto">
      <EtfHotCard
        v-for="card in cardViews"
        :key="card.board.key"
        :board="card.board"
        :state="card.state"
        @refresh="forceRefresh"
        @expand="openExpanded"
        @open-stock="openStockDetail"
        @open-stock-page="openStockPage"
      />
    </div>
  </div>
</template>

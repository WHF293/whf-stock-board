<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { VueDraggable } from "vue-draggable-plus";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseEmpty from "../components/ui/BaseEmpty.vue";
import BaseSkeleton from "../components/ui/BaseSkeleton.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import {
  fetchEastmoneyHotNews,
  fetchSinaHotNews,
  fetchThsHotNews,
  type HotNewsItem,
} from "../api/news.api";
import { useDataCacheStore } from "../stores/data-cache";
import { DATA_CACHE_KEY } from "../constants/data-cache.constants";
import { STORAGE_NS_HOT_NEWS_FILTER } from "../constants/storage-key.constants";
import { appStorage } from "../utils/app-local-storage";

/**
 * 热点新闻：横向卡片流（每源一张卡片，固定 375px 宽，超出页面横向滚动）
 *
 * 翻页模型：新浪 / 财联社 / 央视 / 同花顺为页码递增（cursor=number），
 * 东财为 sortEnd 游标（cursor=string）；
 * 每源独立维护状态与快照（oid 去重），卡片内点击条目在新窗口打开原文页面
 * （避开 X-Frame-Options / CSP）
 * 顶部「新闻源设置」面板：勾选控制显示/隐藏，拖拽手柄调整卡片顺序，
 * 顺序与勾选整包持久化到 appStorage
 */

/** 新闻源 */
type NewsSource = "sina" | "eastmoney" | "ths";

/** 源展示名（面板与卡片标题共用） */
const SOURCE_LABELS: Record<NewsSource, string> = {
  sina: "新浪财经",
  eastmoney: "东方财富",
  ths: "同花顺",
};

/** 默认源顺序（首次进入 / 持久化数据缺源时按此补齐） */
const DEFAULT_SOURCE_ORDER: readonly NewsSource[] = [
  "sina",
  "eastmoney",
  "ths",
];

/** 持久化的单源设置条目（label 不落盘，渲染时经 SOURCE_LABELS 查询） */
interface SourceItem {
  value: NewsSource;
  enabled: boolean;
}

/** 走 number 页码游标的源（其他源如东财走 sortEnd 字符串游标） */
const NUMBER_CURSOR_SOURCES: readonly NewsSource[] = ["sina", "ths"];

/** 每页条数 */
const PAGE_SIZE = 20;

/** 新闻缓存有效期（毫秒）：期内直接复用快照不请求，过期后清空分页数据重拉 */
const CACHE_TTL_MS = 30 * 60 * 1000;

const dataCache = useDataCacheStore();

/**
 * 从 appStorage 加载源设置（顺序 + 勾选）
 *
 * 兼容三种形态：
 * - 新格式（有序数组）：按存储顺序恢复，缺失的源（版本升级新增）追加末尾默认开启；
 * - 旧格式（Record 对象，上一版勾选数据）：按默认顺序迁移各自勾选态；
 * - 无数据 / 解析失败：全部按默认顺序开启
 * @returns 源设置列表（顺序即卡片渲染顺序）
 */
const loadSourceItems = (): SourceItem[] => {
  const raw = appStorage.getItem(STORAGE_NS_HOT_NEWS_FILTER);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        const valid = parsed.filter(
          (item): item is SourceItem =>
            !!item &&
            typeof item === "object" &&
            "value" in item &&
            item.value in SOURCE_LABELS &&
            typeof item.enabled === "boolean",
        );
        // 去重后补齐缺失源（持久化里没有的新源追加末尾，默认开启）
        const seen = new Set(valid.map((item) => item.value));
        const appended = DEFAULT_SOURCE_ORDER.filter(
          (value) => !seen.has(value),
        ).map((value) => ({ value, enabled: true }));
        return [...valid, ...appended];
      }
      if (typeof parsed === "object" && parsed !== null) {
        const record = parsed as Partial<Record<NewsSource, boolean>>;
        return DEFAULT_SOURCE_ORDER.map((value) => ({
          value,
          enabled: record[value] ?? true,
        }));
      }
    } catch (error) {
      console.error("[hot-news] 新闻源设置解析失败", error);
    }
  }
  return DEFAULT_SOURCE_ORDER.map((value) => ({ value, enabled: true }));
};

/** 源设置列表（数组顺序 = 面板行序 = 卡片渲染顺序；持久化到 appStorage） */
const sourceItems = ref<SourceItem[]>(loadSourceItems());

/** 顺序或勾选变化时整包同步到 appStorage（深监听覆盖 splice 重排与勾选切换） */
watch(
  sourceItems,
  (val) => {
    appStorage.setItem(STORAGE_NS_HOT_NEWS_FILTER, JSON.stringify(val));
  },
  { deep: true },
);

/** 设置面板展开态（默认收起） */
const panelOpen = ref(false);

/** 实际渲染的卡片（按勾选过滤；顺序沿用 sourceItems，与面板行序一致） */
const visibleCards = computed(() =>
  sourceItems.value
    .filter((item) => item.enabled)
    .map((item) => ({ value: item.value, label: SOURCE_LABELS[item.value] })),
);

// ---------- 面板拖拽排序（vue-draggable-plus / SortableJS） ----------
// 模板里用 <VueDraggable v-model="sourceItems"> 直接重排数组；
// 顺序变更由上方 deep watch 落盘，无需手工维护拖拽态与插入下标。

/** 缓存的快照条目（含抓取时间，用于 TTL 判定） */
interface NewsCacheEntry {
  items: HotNewsItem[];
  /** 新浪 / 财联社 / 央视 / 同花顺：下一页页码；东财：sortEnd 游标（'' = 首页） */
  cursor: number | string;
  hasMore: boolean;
  fetchedAt: number;
}

/** 单个源的加载状态 */
interface SourceState {
  items: HotNewsItem[];
  /** 新浪 / 财联社 / 央视 / 同花顺：下一页页码；东财：sortEnd 游标（'' = 首页） */
  cursor: number | string;
  /** 是否还有更多（页码源按满页判定 / 东财按游标判定） */
  hasMore: boolean;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否出错 */
  error: boolean;
  /** 已完成首次加载（挂载首屏后已拉过；30 分钟内复用） */
  initialized: boolean;
  /** 快照抓取时间（毫秒），判定缓存是否过期 */
  fetchedAt: number;
}

/**
 * 缓存是否在有效期内
 * @param fetchedAt 抓取时间戳（毫秒）
 * @returns 是否未过期
 */
const isFresh = (fetchedAt: number): boolean =>
  fetchedAt > 0 && Date.now() - fetchedAt < CACHE_TTL_MS;

/**
 * 从快照恢复单源状态：
 * - 快照在 30 分钟有效期内：整包恢复（期内不再发任何请求）；
 * - 快照缺失或已过期：清空之前的分页数据，回到首页重新拉取
 * @param source 数据源
 * @returns 单源初始状态
 */
const createSourceState = (source: NewsSource): SourceState => {
  const entry = dataCache.get<NewsCacheEntry>(
    DATA_CACHE_KEY.HOT_NEWS_ITEMS + source,
  );
  if (entry && isFresh(entry.fetchedAt)) {
    return {
      items: entry.items,
      cursor: entry.cursor,
      hasMore: entry.hasMore,
      loading: false,
      error: false,
      initialized: true,
      fetchedAt: entry.fetchedAt,
    };
  }
  return {
    items: [],
    cursor: NUMBER_CURSOR_SOURCES.includes(source) ? 1 : "",
    hasMore: true,
    // 注意：这里不预置 loading=true，否则 loadMore 的进行中判定会自我阻塞；
    // loading 由 loadMore 进入时置位，模板的骨架屏由「loading 且无数据」兜住
    loading: false,
    error: false,
    initialized: false,
    fetchedAt: 0,
  };
};

/** 各源状态 */
const states = ref<Record<NewsSource, SourceState>>({
  sina: createSourceState("sina"),
  eastmoney: createSourceState("eastmoney"),
  ths: createSourceState("ths"),
});

/**
 * 拉取并追加指定源下一页（oid 去重）
 * 分页随滚动 / 点击持续追加；30 分钟缓存仅用于挂载时整包恢复，不阻断翻页
 * @param source 数据源
 */
const loadMore = async (source: NewsSource): Promise<void> => {
  const state = states.value[source];
  if (state.loading || !state.hasMore) return;
  state.loading = true;
  state.error = false;
  try {
    let fresh: HotNewsItem[] = [];
    if (source === "sina") {
      const items = await fetchSinaHotNews(state.cursor as number, PAGE_SIZE);
      fresh = items;
      state.hasMore = items.length >= PAGE_SIZE;
      state.cursor = (state.cursor as number) + 1;
    } else if (source === "eastmoney") {
      const { items, nextCursor } = await fetchEastmoneyHotNews(
        state.cursor as string,
        PAGE_SIZE,
      );
      fresh = items;
      state.hasMore = nextCursor !== null;
      state.cursor = nextCursor ?? "";
    } else {
      const items = await fetchThsHotNews(state.cursor as number, PAGE_SIZE);
      fresh = items;
      state.hasMore = items.length >= PAGE_SIZE;
      state.cursor = (state.cursor as number) + 1;
    }
    const seen = new Set(state.items.map((item) => item.oid));
    state.items = [
      ...state.items,
      ...fresh.filter((item) => !seen.has(item.oid)),
    ];
    state.initialized = true;
    state.fetchedAt = Date.now();
    const entry: NewsCacheEntry = {
      items: state.items,
      cursor: state.cursor,
      hasMore: state.hasMore,
      fetchedAt: state.fetchedAt,
    };
    dataCache.set(DATA_CACHE_KEY.HOT_NEWS_ITEMS + source, entry);
  } catch (error) {
    state.error = true;
    console.error("[hot-news]", source, error);
  } finally {
    state.loading = false;
  }
};

/**
 * 强制清空指定源缓存并重新拉取（无视 30 分钟 TTL）
 * @param source 数据源
 */
const forceRefresh = async (source: NewsSource): Promise<void> => {
  // 强制重置为首页（清空既有分页数据与游标），无视 30 分钟 TTL 重拉
  states.value[source] = {
    items: [],
    cursor: NUMBER_CURSOR_SOURCES.includes(source) ? 1 : "",
    hasMore: true,
    loading: false,
    error: false,
    initialized: false,
    fetchedAt: 0,
  };
  dataCache.set(DATA_CACHE_KEY.HOT_NEWS_ITEMS + source, null);
  await loadMore(source);
};

// 首屏：未初始化的源全部并发拉取（每源独立维护 loading / error）
onMounted(() => {
  for (const { value } of sourceItems.value) {
    if (!states.value[value].initialized) {
      void loadMore(value);
    }
  }
});

/**
 * 卡片内列表触底（距底 < 60px）时自动加载下一页
 * @param source 数据源
 * @param event 滚动事件
 */
const onListScroll = (source: NewsSource, event: Event): void => {
  const state = states.value[source];
  const el = event.target as HTMLElement;
  if (
    !state.loading &&
    state.hasMore &&
    el.scrollTop + el.clientHeight >= el.scrollHeight - 60
  ) {
    void loadMore(source);
  }
};

/** 阅读窗口尺寸：宽高比固定 3:1（900 x 300），居中弹出 */
const READ_WINDOW_WIDTH = 900;
const READ_WINDOW_HEIGHT = Math.round(READ_WINDOW_WIDTH / 3);

/**
 * 打开新闻原文：
 * - 浏览器：新开 3:1 小窗（900 x 300，居中）直接导航到原文页——不使用 iframe，
 *   规避新闻站点的 X-Frame-Options / CSP 反框架限制（iframe 方案会白屏）；
 * - Tauri：经 opener 插件用系统默认浏览器打开（window.open 在 Tauri 内默认被禁）
 * @param url 新闻原文链接
 */
const openInNewWindow = async (url: string): Promise<void> => {
  if (isTauri()) {
    try {
      await openUrl(url);
      return;
    } catch (error) {
      console.error("[hot-news] opener", error);
    }
  }
  const left = Math.max(
    0,
    Math.round((window.screen.availWidth - READ_WINDOW_WIDTH) / 2),
  );
  const top = Math.max(
    0,
    Math.round((window.screen.availHeight - READ_WINDOW_HEIGHT) / 2),
  );
  const features =
    `width=${READ_WINDOW_WIDTH},height=${READ_WINDOW_HEIGHT},left=${left},top=${top},` +
    "menubar=no,toolbar=no,location=no,status=no";
  if (!window.open(url, "_blank", features)) {
    window.open(url, "_blank", "noopener");
  }
};

/**
 * 时间展示
 * @param ctime 秒级时间戳字符串
 * @returns 本地 "MM-DD HH:mm" 文本
 */
const formatTime = (ctime: string): string => {
  if (!ctime) return "";
  const d = new Date(Number(ctime) * 1000);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * 加载更多按钮文案（按状态切换）
 * @param state 单源状态
 * @returns 按钮文字
 */
const loadMoreLabel = (state: SourceState): string => {
  if (state.loading) return "加载中...";
  if (!state.hasMore) return "没有更多了";
  return "加载更多";
};
</script>

<template>
  <!-- 「新闻源设置」折叠面板：点击标题展开/收起；展开后竖向列表，拖拽手柄排序 -->
  <div class="relative shrink-0 border-b border-flat-weak">
    <button
      type="button"
      class="pressable flex w-full items-center justify-between px-4 py-2 text-sm font-semibold text-text-secondary hover:text-text"
      :aria-expanded="panelOpen"
      @click="panelOpen = !panelOpen"
    >
      新闻源设置
      <MenuIcon
        name="chevronDown"
        :size="14"
        class="transition-transform"
        :class="panelOpen ? 'rotate-180' : ''"
      />
    </button>

    <!-- 竖向源列表（浮层，不挤压下方卡片流） -->
    <div
      v-if="panelOpen"
      class="absolute inset-x-0 top-full z-20 border-b border-flat-weak bg-surface py-1 shadow-card"
    >
      <!-- vue-draggable-plus：v-model 直接重排 sourceItems，排序结果由 deep watch 落盘 -->
      <!-- force-fallback：改用鼠标模拟拖拽，绕开原生 HTML5 DnD（在 Tauri WebView
           下原生拖拽会显示禁拖光标且 drop 不触发，导致松手顺序不变） -->
      <VueDraggable
        v-model="sourceItems"
        tag="ul"
        :animation="150"
        handle=".drag-handle"
        :force-fallback="true"
        fallback-class="sortable-fallback bg-surface shadow-lg ring-1 ring-flat-weak"
        ghost-class="opacity-40"
        chosen-class="bg-flat-weak"
      >
        <li
          v-for="item in sourceItems"
          :key="item.value"
          class="flex select-none items-center gap-3 px-4 py-2.5 text-sm text-text-secondary"
        >
          <!-- 拖拽手柄：仅手柄可拖（SortableJS handle），勾选框点击不受影响 -->
          <MenuIcon
            name="grip"
            :size="16"
            class="drag-handle cursor-grab text-text-tertiary active:cursor-grabbing"
          />
          <input
            type="checkbox"
            :checked="item.enabled"
            class="h-4 w-4 cursor-pointer rounded border-flat-weak accent-primary"
            @change="item.enabled = ($event.target as HTMLInputElement).checked"
          />
          <span class="text-text">{{ SOURCE_LABELS[item.value] }}</span>
        </li>
      </VueDraggable>
    </div>
  </div>

  <!-- 横向卡片流：每源一张 375px 卡片，超出页面横向滚动 -->
  <!-- 高度用 100dvh - 7rem：扣除 MainLayout 头部 h-14(56px) + main 内部 div 的 lg:p-6 上下(48px) + buffer -->
  <div class="flex h-[calc(100dvh-9rem)] min-h-0 gap-4 overflow-x-auto p-4">
    <BaseCard
      v-for="card in visibleCards"
      :key="card.value"
      class="!flex !h-full !w-[375px] !shrink-0 !flex-col !overflow-hidden !p-0"
    >
      <!-- 卡片 header：源名称 + 当前条数 -->
      <header
        class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-4 py-3"
      >
        <h2 class="text-sm font-semibold text-text">{{ card.label }}</h2>
        <span class="text-xs text-text-tertiary">
          {{ states[card.value].items.length }} 条
        </span>
      </header>

      <!-- 卡片 body：列表（占满剩余高度，内部滚动） -->
      <div
        class="flex-1 overflow-y-auto"
        @scroll.passive="onListScroll(card.value, $event)"
      >
        <div
          v-if="
            states[card.value].loading && states[card.value].items.length === 0
          "
          class="p-4"
        >
          <BaseSkeleton />
        </div>
        <div
          v-else-if="
            states[card.value].error && states[card.value].items.length === 0
          "
          class="py-10"
        >
          <BaseEmpty text="热点新闻加载失败，请稍后重试" />
        </div>
        <ul
          v-else-if="states[card.value].items.length > 0"
          class="divide-y divide-flat-weak"
        >
          <li
            v-for="item in states[card.value].items"
            :key="item.oid"
            class="odd:bg-flat-weak/30"
          >
            <button
              type="button"
              class="pressable block w-full px-4 py-3 text-left active:scale-[0.99]"
              @click="openInNewWindow(item.url)"
            >
              <p class="text-sm font-medium text-text">{{ item.title }}</p>
              <p class="mt-1 line-clamp-2 text-xs text-text-tertiary">
                {{ item.summary }}
              </p>
              <p
                class="mt-1.5 flex items-center gap-2 text-xs text-text-tertiary"
              >
                <span>{{ item.media }}</span>
                <span>{{ formatTime(item.ctime) }}</span>
              </p>
            </button>
          </li>
        </ul>
        <BaseEmpty v-else text="暂无热点新闻" />
      </div>

      <!-- 卡片 footer：加载更多 / 强制刷新 / 缓存提示 -->
      <div
        v-if="states[card.value].items.length > 0"
        class="flex shrink-0 flex-col items-center gap-1 border-t border-flat-weak px-4 py-3"
      >
        <div class="flex items-center gap-2">
          <BaseButton
            variant="ghost"
            :disabled="
              states[card.value].loading || !states[card.value].hasMore
            "
            @click="loadMore(card.value)"
          >
            {{ loadMoreLabel(states[card.value]) }}
          </BaseButton>
          <BaseButton
            variant="ghost"
            :disabled="states[card.value].loading"
            @click="forceRefresh(card.value)"
          >
            强制刷新
          </BaseButton>
        </div>
        <!-- 加载中状态：旋转圈 + 文案 -->
        <div
          v-if="
            states[card.value].loading && states[card.value].items.length > 0
          "
          class="flex items-center justify-center gap-2 py-1"
        >
          <span
            class="h-3 w-3 animate-spin rounded-full border-2 border-flat-weak border-t-primary"
            aria-hidden="true"
          />
          <span class="text-xs text-text-tertiary">正在加载更多...</span>
        </div>
      </div>
    </BaseCard>
  </div>
</template>

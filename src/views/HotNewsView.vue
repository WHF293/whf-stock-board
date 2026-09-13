<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseEmpty from "../components/ui/BaseEmpty.vue";
import BaseSkeleton from "../components/ui/BaseSkeleton.vue";
import BaseTabs from "../components/ui/BaseTabs.vue";
import {
  fetchEastmoneyHotNews,
  fetchSinaHotNews,
  fetchThsHotNews,
  type HotNewsItem,
} from "../api/news.api";
import { useDataCacheStore } from "../stores/data-cache";
import { DATA_CACHE_KEY } from "../constants/data-cache.constants";

/**
 * 热点新闻：tab 区分数据源（新浪财经 / 东财已接入；同花顺 / 雪球预留占位）。
 *
 * 两个源的翻页模型不同：新浪为页码递增、东财为 sortEnd 游标；
 * 视图层统一为「追加 + 加载更多」，每源独立维护状态与快照（oid 去重）；
 * 点击条目在新窗口中用 iframe 展示原文页面
 */

/** 新闻源 tab 选项 */
const SOURCE_TAB_OPTIONS = [
  { label: "新浪财经", value: "sina" },
  { label: "东方财富", value: "eastmoney" },
  { label: "同花顺", value: "ths" },
] as const;

/** 新闻源 */
type NewsSource = (typeof SOURCE_TAB_OPTIONS)[number]["value"];

/** 当前新闻源 */
const activeSource = ref<NewsSource>("sina");

/** 已接入的源 */
const ENABLED_SOURCES: readonly NewsSource[] = ["sina", "eastmoney", "ths"];
const isEnabled = (source: NewsSource): boolean =>
  ENABLED_SOURCES.includes(source);

/** 每页条数 */
const PAGE_SIZE = 20;

/** 列表最大高度（像素）：约 10 条新闻，超出内部滚动 */
const LIST_MAX_HEIGHT_PX = 600;

/** 新闻缓存有效期（毫秒）：期内直接复用快照不请求，过期后清空分页数据重拉 */
const CACHE_TTL_MS = 30 * 60 * 1000;

const dataCache = useDataCacheStore();

/** 缓存的快照条目（含抓取时间，用于 TTL 判定） */
interface NewsCacheEntry {
  items: HotNewsItem[];
  /** 新浪：下一页页码；东财：sortEnd 游标（'' = 首页） */
  cursor: number | string;
  hasMore: boolean;
  fetchedAt: number;
}

/** 单个源的加载状态 */
interface SourceState {
  items: HotNewsItem[];
  /** 新浪：下一页页码；东财：sortEnd 游标（'' = 首页） */
  cursor: number | string;
  /** 是否还有更多（新浪按满页判定 / 东财按游标判定） */
  hasMore: boolean;
  /** 是否正在加载 */
  loading: boolean;
  /** 是否出错 */
  error: boolean;
  /** 已完成首次加载（切回该源时复用快照不重复拉取） */
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
 * @param source
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
    cursor: source === "sina" ? 1 : "",
    hasMore: true,
    // 注意：这里不预置 loading=true，否则 loadMore 的进行中判定会自我阻塞；
    // loading 由 loadMore 进入时置位，模板的骨架屏由「loading 且无数据」兜住
    loading: false,
    error: false,
    initialized: false,
    fetchedAt: 0,
  };
};

/** 各源状态（含未接入源占位，避免模板索引 undefined） */
const states = ref<Record<NewsSource, SourceState>>({
  sina: createSourceState("sina"),
  eastmoney: createSourceState("eastmoney"),
  ths: createSourceState("ths"),
});

/** 当前源状态 */
const current = computed<SourceState>(() => states.value[activeSource.value]);

/**
 * 列表内部滚动：触底（距底 < 60px）且缓存过期时自动加载下一页；
 * 缓存有效期内触底不请求（按钮区有提示与强制刷新入口）
 * @param event 滚动事件
 */
const onListScroll = (event: Event): void => {
  const el = event.target as HTMLElement;
  if (
    !current.value.loading &&
    current.value.hasMore &&
    !isFresh(current.value.fetchedAt) &&
    el.scrollTop + el.clientHeight >= el.scrollHeight - 60
  ) {
    void loadMore();
  }
};

/**
 * 强制清空当前源缓存并重新拉取（无视 30 分钟 TTL）
 */
const forceRefresh = async (): Promise<void> => {
  const source = activeSource.value;
  states.value[source] = createSourceState(source);
  states.value[source].initialized = false;
  dataCache.set(DATA_CACHE_KEY.HOT_NEWS_ITEMS + source, null);
  await loadMore();
};

/**
 * 拉取并追加当前源下一页（oid 去重）。
 * 缓存有效期内不发请求（按钮置灰提示）；过期后先清空既有分页数据再重拉首页
 */
const loadMore = async (): Promise<void> => {
  const source = activeSource.value;
  const state = states.value[source];
  if (!isEnabled(source) || state.loading) return;
  // 缓存有效期内：不触发请求
  if (isFresh(state.fetchedAt)) return;
  // 过期重拉：清空之前缓存的分页数据，回到首页
  if (state.initialized) {
    state.items = [];
    state.cursor = source === "sina" ? 1 : "";
    state.hasMore = true;
  }
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

// 首屏与切换源时：未初始化的已接入源自动拉取
void loadMore();
watch(activeSource, (source) => {
  if (isEnabled(source) && !states.value[source].initialized) {
    void loadMore();
  }
});

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
</script>

<template>
  <div class="space-y-4">
    <!-- 数据源切换（与行情全景一致的 underline 风格） -->
    <div class="flex items-center justify-between gap-2">
      <BaseTabs
        v-model="activeSource"
        :options="SOURCE_TAB_OPTIONS"
        variant="underline"
      />
      <span v-if="isEnabled(activeSource)" class="text-xs text-text-tertiary">
        共 {{ current.items.length }} 条 · 点击条目在新窗口查看原文
      </span>
    </div>
    <BaseCard>
      <!-- 已接入源 -->
      <template v-if="isEnabled(activeSource)">
        <div v-if="current.loading && current.items.length === 0">
          <BaseSkeleton />
        </div>
        <div
          v-else-if="current.error && current.items.length === 0"
          class="py-10"
        >
          <BaseEmpty text="热点新闻加载失败，请稍后重试" />
        </div>
        <template v-else-if="current.items.length > 0">
          <!-- 固定约 10 条高度，超出列表内滚动；触底自动加载（缓存过期时） -->
          <ul
            class="divide-y divide-flat-weak overflow-y-auto"
            :style="{ maxHeight: `${LIST_MAX_HEIGHT_PX}px` }"
            @scroll.passive="onListScroll"
          >
            <li v-for="item in current.items" :key="item.oid" class="odd:bg-flat-weak/30">
              <button
                type="button"
                class="pressable block w-full py-3 text-left active:scale-[0.99]"
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
          <!-- 加载更多 loading：旋转圈 + 文案 -->
          <div
            v-if="current.loading && current.items.length > 0"
            class="flex items-center justify-center gap-2 py-3"
          >
            <span
              class="h-4 w-4 animate-spin rounded-full border-2 border-flat-weak border-t-primary"
              aria-hidden="true"
            />
            <span class="text-xs text-text-tertiary">正在加载更多...</span>
          </div>
          <div v-if="current.error" class="py-2 text-center text-xs text-down">
            加载失败，请重试
          </div>
          <div class="flex flex-col items-center gap-1 pt-3">
            <div class="flex items-center gap-2">
              <BaseButton
                variant="ghost"
                :disabled="
                  current.loading ||
                    !current.hasMore ||
                    isFresh(current.fetchedAt)
                "
                @click="loadMore"
              >
                {{
                  current.loading
                    ? "加载中..."
                    : !current.hasMore
                      ? "没有更多了"
                      : isFresh(current.fetchedAt)
                        ? "已缓存（30 分钟后更新）"
                        : "加载更多"
                }}
              </BaseButton>
              <BaseButton
                variant="ghost"
                :disabled="current.loading"
                @click="forceRefresh"
              >
                强制刷新
              </BaseButton>
            </div>
            <span
              v-if="isFresh(current.fetchedAt)"
              class="text-xs text-text-tertiary"
            >
              缓存于
              {{
                new Date(current.fetchedAt).toLocaleTimeString("zh-CN", {
                  hour12: false,
                })
              }}
              · 触底不重复拉取，可点「强制刷新」立即更新
            </span>
          </div>
        </template>
        <BaseEmpty v-else text="暂无热点新闻" />
      </template>

      <!-- 占位源：同花顺 / 雪球 -->
      <template v-else>
        <BaseEmpty text="该数据源暂未接入" />
      </template>
    </BaseCard>
  </div>
</template>

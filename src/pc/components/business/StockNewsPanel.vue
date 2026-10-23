<script setup lang="ts">
import { ref, watch } from 'vue';
import MenuIcon from '../ui/MenuIcon.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import { fetchStockAnnouncements, fetchStockNews } from '../../../common/api/stock-news.api.ts';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import { openInNewWindow } from '../../../common/utils/open-in-new-window';
import { formatDateTime } from '../../../common/utils/format-datetime';
import type { StockAnnouncement } from '../../../common/types/stock-news.types.ts';
import type { HotNewsItem } from '../../../common/api/news.api.ts';

/**
 * 个股关联资讯面板（详情页底部「资讯」页签）：公司公告 + 个股新闻两段
 *
 * - 取数：进面板（或切票）拉一次 + 手动刷新，**不做轮询**（资讯不是行情）；
 * - 缓存：会话级 data-cache（key = symbol），切票来回不重复拉；
 * - 打开原文复用 openInNewWindow（Tauri 独立小窗 / 浏览器 window.open）；
 * - 公告与新闻任一失败互不影响（分开 try/catch，分别展示失败提示）。
 */
const props = defineProps<{
  /** 个股符号（sh600519 形态） */
  symbol: string;
}>();

const dataCache = useDataCacheStore();

/** 公告列表 */
const announcements = ref<StockAnnouncement[]>([]);

/** 个股新闻列表 */
const news = ref<HotNewsItem[]>([]);

/** 任一段取数中（两段并发，任一未完成即 loading） */
const loading = ref(false);

/** 公告失败标记 */
const announcementsError = ref(false);

/** 新闻失败标记 */
const newsError = ref(false);

/** 会话缓存快照形态（两段结果 + 各自失败标记一起存） */
interface NewsPanelSnapshot {
  /** 公告列表 */
  announcements: StockAnnouncement[];
  /** 新闻列表 */
  news: HotNewsItem[];
  /** 公告是否拉取失败 */
  annErr: boolean;
  /** 新闻是否拉取失败 */
  newsErr: boolean;
}

/**
 * 拉取两段资讯（并发；任一段失败只标记各自状态）
 */
const load = async (): Promise<void> => {
  const cachedNews = dataCache.get<NewsPanelSnapshot>(
    `${DATA_CACHE_KEY.DETAIL_NEWS_PREFIX}${props.symbol}`,
  );
  if (cachedNews) {
    applyResult(cachedNews.announcements, cachedNews.news, cachedNews.annErr, cachedNews.newsErr);
    return;
  }
  loading.value = true;
  announcementsError.value = false;
  newsError.value = false;
  const [announcementsResult, newsResult] = await Promise.allSettled([
    fetchStockAnnouncements(props.symbol),
    fetchStockNews(props.symbol),
  ]);
  const annOk = announcementsResult.status === 'fulfilled';
  const newsOk = newsResult.status === 'fulfilled';
  const annValue = annOk ? announcementsResult.value : [];
  const newsValue = newsOk ? newsResult.value : [];
  announcements.value = annValue;
  news.value = newsValue;
  announcementsError.value = !annOk;
  newsError.value = !newsOk;
  loading.value = false;
  dataCache.set(`${DATA_CACHE_KEY.DETAIL_NEWS_PREFIX}${props.symbol}`, {
    announcements: annValue,
    news: newsValue,
    annErr: !annOk,
    newsErr: !newsOk,
  });
};

/**
 * 应用一次结果（缓存命中与网络成功共用）
 * @param annValue 公告列表
 * @param newsValue 新闻列表
 * @param annErr 公告是否失败
 * @param newsErr 新闻是否失败
 */
const applyResult = (
  annValue: StockAnnouncement[],
  newsValue: HotNewsItem[],
  annErr: boolean,
  newsErr: boolean,
): void => {
  announcements.value = annValue;
  news.value = newsValue;
  announcementsError.value = annErr;
  newsError.value = newsErr;
  loading.value = false;
};

/**
 * 手动刷新（绕过会话缓存强制重拉）
 */
const refresh = (): void => {
  dataCache.set(`${DATA_CACHE_KEY.DETAIL_NEWS_PREFIX}${props.symbol}`, null);
  void load();
};

// 切票即重拉（data-cache 命中时秒出）
watch(
  () => props.symbol,
  () => {
    void load();
  },
  { immediate: true },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col px-2">
    <!-- 工具行：说明 + 刷新 -->
    <div class="flex shrink-0 items-center justify-between pb-1.5">
      <span class="text-xs text-text-tertiary">公告与新闻来自东方财富，进页面拉取一次</span>
      <button
        type="button"
        class="pressable flex items-center gap-1 rounded-md p-1 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text"
        :disabled="loading"
        aria-label="刷新资讯"
        @click="refresh"
      >
        <MenuIcon name="globe" :size="13" />
        刷新
      </button>
    </div>

    <BaseSkeleton v-if="loading" />
    <div v-else class="min-h-0 flex-1 overflow-y-auto">
      <!-- 公司公告 -->
      <p class="pb-1 text-xs font-semibold text-text-secondary">公司公告</p>
      <BaseEmpty v-if="announcementsError" text="公告加载失败，点右上「刷新」重试" />
      <BaseEmpty v-else-if="announcements.length === 0" text="暂无公告" />
      <ul v-else class="mb-3">
        <li
          v-for="item in announcements"
          :key="item.url"
          class="flex cursor-pointer items-baseline gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-flat-weak/40"
          @click="openInNewWindow(item.url)"
        >
          <span class="min-w-0 flex-1 truncate text-text" :title="item.title">{{ item.title }}</span>
          <span class="shrink-0 text-xs tabular-nums text-text-tertiary">{{ item.date }}</span>
        </li>
      </ul>

      <!-- 个股新闻 -->
      <p class="pb-1 text-xs font-semibold text-text-secondary">相关新闻</p>
      <BaseEmpty v-if="newsError" text="新闻加载失败，点右上「刷新」重试" />
      <BaseEmpty v-else-if="news.length === 0" text="暂无相关新闻" />
      <ul v-else>
        <li
          v-for="item in news"
          :key="item.oid"
          class="cursor-pointer rounded-lg px-2 py-1.5 hover:bg-flat-weak/40"
          @click="openInNewWindow(item.url)"
        >
          <p class="truncate text-sm text-text" :title="item.title">{{ item.title }}</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            {{ item.media }}<span v-if="item.ctime"> · {{ formatDateTime(Number(item.ctime) * 1000) }}</span>
          </p>
        </li>
      </ul>
    </div>
  </div>
</template>

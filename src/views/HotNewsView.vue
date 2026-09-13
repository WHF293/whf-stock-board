<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import { fetchSinaHotNews, type HotNewsItem } from '../api/news.api';
import { useDataCacheStore } from '../stores/data-cache';
import { DATA_CACHE_KEY } from '../constants/data-cache.constants';

/**
 * 热点新闻：tab 区分数据源（新浪财经已接入；同花顺 / 东财 / 雪球预留占位）。
 *
 * 新浪源为追加式分页列表（每页 20 条，oid 去重，快照播种）；
 * 点击条目在新窗口中用 iframe 展示原文页面
 */

/** 新闻源 tab 选项 */
const SOURCE_TAB_OPTIONS = [
  { label: '新浪财经', value: 'sina' },
  { label: '同花顺', value: 'ths' },
  { label: '东方财富', value: 'eastmoney' },
  { label: '雪球', value: 'xueqiu' },
] as const;

/** 当前新闻源 */
const activeSource = ref<string>('sina');

/** 是否为已接入的源（新浪） */
const isSinaSource = computed(() => activeSource.value === 'sina');

/** 每页条数（上游建议 5~30，最大不建议 >50） */
const PAGE_SIZE = 20;

const dataCache = useDataCacheStore();

// ---------- 新浪新闻（追加式分页；快照播种 + 成功写回） ----------
const newsItems = ref<HotNewsItem[]>(
  dataCache.get<HotNewsItem[]>(DATA_CACHE_KEY.HOT_NEWS_ITEMS) ?? [],
);
const isLoading = ref(newsItems.value.length === 0);
const isLoadingMore = ref(false);
const isError = ref(false);
/** 已拉取页码（快照恢复时按现有条数推算，续拉下一页） */
const page = ref(Math.max(1, Math.ceil(newsItems.value.length / PAGE_SIZE)));
/** 是否还有下一页（上游 total 不准，按返回条数判断：满页则认为可能还有） */
const hasMore = ref(true);

/** 已加载 oid 集合（去重） */
const seenOids = computed(() => new Set(newsItems.value.map((item) => item.oid)));

/** 拉取并追加一页（oid 去重） */
const loadMore = async (): Promise<void> => {
  if (isLoadingMore.value) return;
  isError.value = false;
  const isFirstPage = page.value === 1 && newsItems.value.length === 0;
  if (isFirstPage) {
    isLoading.value = true;
  } else {
    isLoadingMore.value = true;
  }
  try {
    const items = await fetchSinaHotNews(page.value, PAGE_SIZE);
    const fresh = items.filter((item) => !seenOids.value.has(item.oid));
    newsItems.value = [...newsItems.value, ...fresh];
    dataCache.set(DATA_CACHE_KEY.HOT_NEWS_ITEMS, newsItems.value);
    hasMore.value = items.length >= PAGE_SIZE;
    page.value += 1;
  } catch (error) {
    isError.value = true;
    console.error('[hot-news]', error);
  } finally {
    isLoading.value = false;
    isLoadingMore.value = false;
  }
};

void loadMore();

// 切回新浪 tab 时若无数据（首次进入其它 tab 再切回）重拉
watch(activeSource, (source) => {
  if (source === 'sina' && newsItems.value.length === 0) {
    void loadMore();
  }
});

/**
 * 新窗口展示新闻原文：先开空白窗口再写入 iframe（保留站内跳转体验，
 * 不受应用路由影响）；窗口被拦截时降级为直接打开原文链接
 * @param url 新闻原文链接
 */
const openInNewWindow = (url: string): void => {
  const win = window.open('', '_blank');
  if (!win) {
    window.open(url, '_blank', 'noopener');
    return;
  }
  win.document.write(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">` +
      `<title>新闻原文</title>` +
      `<style>html,body{margin:0;height:100%;overflow:hidden}` +
      `iframe{border:0;width:100%;height:100%}</style></head>` +
      `<body><iframe src="${url}" referrerpolicy="no-referrer"></iframe></body></html>`,
  );
  win.document.close();
};
</script>

<template>
  <div class="space-y-4">
    <BaseCard>
      <template #extra>
        <BaseTabs v-model="activeSource" :options="SOURCE_TAB_OPTIONS" />
      </template>

      <!-- 新浪财经（已接入） -->
      <template v-if="isSinaSource">
        <div v-if="isLoading"><BaseSkeleton /></div>
        <div v-else-if="isError && newsItems.length === 0" class="py-10">
          <BaseEmpty text="热点新闻加载失败，请稍后重试" />
        </div>
        <template v-else-if="newsItems.length > 0">
          <ul class="divide-y divide-flat-weak">
            <li v-for="item in newsItems" :key="item.oid">
              <button
                type="button"
                class="pressable block w-full py-3 text-left active:scale-[0.99]"
                @click="openInNewWindow(item.url)"
              >
                <p class="text-sm font-medium text-text">{{ item.title }}</p>
                <p class="mt-1 line-clamp-2 text-xs text-text-tertiary">{{ item.summary }}</p>
                <p class="mt-1.5 flex items-center gap-2 text-xs text-text-tertiary">
                  <span>{{ item.media }}</span>
                  <span v-if="item.ctime">
                    {{ new Date(Number(item.ctime) * 1000).toLocaleString('zh-CN', { hour12: false }) }}
                  </span>
                </p>
              </button>
            </li>
          </ul>
          <div v-if="isError" class="py-2 text-center text-xs text-down">
            加载失败，请重试
          </div>
          <div class="flex justify-center pt-3">
            <BaseButton variant="ghost" :disabled="isLoadingMore || !hasMore" @click="loadMore">
              {{ isLoadingMore ? '加载中...' : hasMore ? '加载更多' : '没有更多了' }}
            </BaseButton>
          </div>
        </template>
        <BaseEmpty v-else text="暂无热点新闻" />
      </template>

      <!-- 占位源：同花顺 / 东财 / 雪球 -->
      <template v-else>
        <BaseEmpty text="该数据源接入中，敬请期待" />
      </template>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { useRouter } from 'vue-router';
import { showFailToast } from 'vant';
import {
  fetchClsDepth,
  fetchEastmoneyHotNews,
  fetchEmRecommendNews,
  fetchSinaHotNews,
  fetchThsHeadlineHotNews,
  fetchThsHotNews,
  fetchThepaperHotNews,
  fetchTdxHotNews,
} from '../../api/news.api';
import type { HotNewsItem, TdxNewsChannel } from '../../api/news.api';
import {
  MOBILE_CACHE_TTL_MS,
  MOBILE_NEWS_PAGE_SIZE,
  MOBILE_NEWS_SOURCES,
  SINA_LID_FINANCE,
  SINA_LID_STOCK,
} from '../constants';
import type { MobileNewsChannel, MobileNewsSource } from '../constants';
import {
  mobileCacheGet,
  mobileCacheGetStale,
  mobileCacheRemove,
  mobileCacheSet,
} from '../cache';
import { useMobilePolling } from '../composables/use-mobile-polling';
import { formatSnapshotTime } from '../utils/format';
import NewsRow from '../components/NewsRow.vue';

/**
 * 热点新闻（移动端）
 *
 * 六源 Vant Tabs 切换（点 tab 切源）；与一级源 chips 双向联动；
 * 每源保留子栏目 chips；频道页状态（items/翻页游标）按「源:栏目」独立持久化缓存
 * （30 分钟 TTL），下拉 / 前台轮询为强制刷新，navbar 不设刷新按钮
 */

/** 频道加载上下文（翻页参数） */
interface ChannelLoadContext {
  page: number;
  cursor: string;
}

/** 频道加载结果 */
interface ChannelLoadResult {
  items: HotNewsItem[];
  nextCursor: string | null;
  finished: boolean;
}

/** 持久化的频道页快照（落 mobile.cache） */
interface CachedChannelPage {
  items: HotNewsItem[];
  cursor: string;
  page: number;
  finished: boolean;
}

/** 单频道运行期状态（持久化字段 + 运行期标记） */
interface ChannelPageState extends CachedChannelPage {
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  fetchedAt: number | null;
  initialized: boolean;
}

const PAGE_STATE_DEFAULT = (): ChannelPageState => ({
  items: [],
  cursor: '',
  page: 1,
  finished: false,
  loading: false,
  refreshing: false,
  error: false,
  fetchedAt: null,
  initialized: false,
});

const buildCacheKey = (channelKey: string): string => `news:${channelKey}`;

/** 触底哨兵的提前触发距离（IntersectionObserver rootMargin，距底 400px 内即开始追加） */
const LOAD_MORE_ROOT_MARGIN = '400px';

/**
 * 按频道 key 分发取数（page 型返回后页码 +1，cursor 型透传游标，single 型恒 finished）
 * @param channelKey 频道 key（`<sourceKey>:<channelKey>`）
 * @param ctx 翻页上下文
 * @returns 加载结果
 */
const loadChannelPage = async (
  channelKey: string,
  ctx: ChannelLoadContext,
): Promise<ChannelLoadResult> => {
  const toResult = (items: HotNewsItem[]): ChannelLoadResult => ({
    items,
    nextCursor: null,
    finished: items.length === 0,
  });
  switch (channelKey) {
    case 'sina:caijing':
      return fetchSinaHotNews(ctx.page, MOBILE_NEWS_PAGE_SIZE, SINA_LID_FINANCE).then(toResult);
    case 'sina:kuaixun':
      return fetchSinaHotNews(ctx.page, MOBILE_NEWS_PAGE_SIZE, SINA_LID_STOCK).then(toResult);
    case 'em:flash': {
      const res = await fetchEastmoneyHotNews(ctx.cursor);
      return { items: res.items, nextCursor: res.nextCursor, finished: res.nextCursor === null };
    }
    case 'em:rec':
      return fetchEmRecommendNews(MOBILE_NEWS_PAGE_SIZE).then((items) => ({
        items,
        nextCursor: null,
        finished: true,
      }));
    case 'ths:flash':
      return fetchThsHotNews(ctx.page, MOBILE_NEWS_PAGE_SIZE).then(toResult);
    case 'ths:headline':
      return fetchThsHeadlineHotNews().then((items) => ({
        items,
        nextCursor: null,
        finished: true,
      }));
    case 'tp:flash': {
      const res = await fetchThepaperHotNews(ctx.cursor, MOBILE_NEWS_PAGE_SIZE);
      return { items: res.items, nextCursor: res.nextCursor, finished: res.nextCursor === null };
    }
    case 'cls:depth': {
      const snapshot = await fetchClsDepth();
      return {
        items: [...snapshot.topArticles, ...snapshot.items],
        nextCursor: null,
        finished: true,
      };
    }
    case 'tdx:yw':
      return fetchTdxHotNews('yw' satisfies TdxNewsChannel, MOBILE_NEWS_PAGE_SIZE).then(toResult);
    case 'tdx:ag':
      return fetchTdxHotNews('ag' satisfies TdxNewsChannel, MOBILE_NEWS_PAGE_SIZE).then(toResult);
    case 'tdx:cj':
      return fetchTdxHotNews('cj' satisfies TdxNewsChannel, MOBILE_NEWS_PAGE_SIZE).then(toResult);
    default:
      throw new Error(`未知新闻频道：${channelKey}`);
  }
};

const router = useRouter();

/** 每源当前子栏目（默认取该源第一个；记忆到会话内，不做持久化） */
const channelBySource = reactive<Record<string, string>>(
  Object.fromEntries(MOBILE_NEWS_SOURCES.map((source) => [source.key, source.channels[0]!.key])),
);

/** 全部已触达频道的分页状态 */
const pages = reactive<Record<string, ChannelPageState>>({});

const activeIndex = ref(0);

const activeSource = computed<MobileNewsSource>(() => MOBILE_NEWS_SOURCES[activeIndex.value]!);

/** 当前源当前栏目的缓存键 */
const activeChannelKey = computed(
  () => `${activeSource.value.key}:${channelBySource[activeSource.value.key]}`,
);

/** 当前频道的快照时刻（摘要条展示；null = 尚未抓取） */
const activeFetchedAt = computed<number | null>(
  () => pages[activeChannelKey.value]?.fetchedAt ?? null,
);

/**
 * 模板取状态（reactive 记录自动补默认值）
 * @param source 新闻源
 * @returns 该源当前栏目的状态
 */
const pageOf = (source: MobileNewsSource): ChannelPageState => {
  const key = `${source.key}:${channelBySource[source.key]}`;
  return (pages[key] ??= PAGE_STATE_DEFAULT());
};

/**
 * 当前源当前栏目的缓存键
 * @param source 新闻源
 * @returns 缓存键（`<sourceKey>:<channelKey>`）
 */
const channelKeyOf = (source: MobileNewsSource): string =>
  `${source.key}:${channelBySource[source.key]}`;

/**
 * 查找频道定义（type 判定 footer 文案用）
 * @param channelKey 频道 key
 * @returns 频道定义，未知频道返回 null
 */
const channelDefOf = (channelKey: string): MobileNewsChannel | null => {
  for (const source of MOBILE_NEWS_SOURCES) {
    const hit = source.channels.find((channel) => `${source.key}:${channel.key}` === channelKey);
    if (hit) return hit;
  }
  return null;
};

/**
 * 加载一个频道页（重置 / 追加二态；静默轮询失败不动现有内容）
 * @param channelKey 频道 key（`<sourceKey>:<channelKey>`）
 * @param opts 加载选项
 * @param opts.force 清空重拉（下拉 / 轮询）
 * @param opts.silent 失败不翻错误态、不打 toast
 */
const ensureChannel = async (
  channelKey: string,
  opts: { force?: boolean; silent?: boolean } = {},
): Promise<void> => {
  const st = (pages[channelKey] ??= PAGE_STATE_DEFAULT());
  if (st.loading) return;

  const cacheKey = buildCacheKey(channelKey);
  if (!st.initialized) {
    st.initialized = true;
    const fresh = mobileCacheGet<CachedChannelPage>(cacheKey);
    if (fresh) {
      st.items = fresh.value.items;
      st.cursor = fresh.value.cursor;
      st.page = fresh.value.page;
      st.finished = fresh.value.finished;
      st.fetchedAt = fresh.at;
      // TTL 内的新鲜快照免请求；过期快照（mobileCacheGet 已滤掉）走网络
      if (Date.now() - fresh.at <= MOBILE_CACHE_TTL_MS) return;
    }
  }

  if (opts.force) {
    mobileCacheRemove(cacheKey);
    st.items = [];
    st.page = 1;
    st.cursor = '';
    st.finished = false;
  }
  if (st.finished) return;

  st.loading = true;
  if (!opts.silent) st.error = false;
  const requestPage = st.page;
  try {
    const result = await loadChannelPage(channelKey, { page: requestPage, cursor: st.cursor });
    if (opts.force || requestPage === 1) {
      st.items = result.items;
    } else {
      st.items.push(...result.items);
    }
    st.page = requestPage + 1;
    st.cursor = result.nextCursor ?? st.cursor;
    st.finished = result.finished;
    st.fetchedAt = Date.now();
    mobileCacheSet(cacheKey, {
      items: st.items,
      cursor: st.cursor,
      page: st.page,
      finished: st.finished,
    });
  } catch {
    if (!opts.silent) {
      if (st.items.length === 0) {
        const stale = mobileCacheGetStale<CachedChannelPage>(cacheKey);
        if (stale) {
          st.items = stale.value.items;
          st.fetchedAt = stale.at;
        } else {
          st.error = true;
        }
      } else {
        showFailToast('刷新失败，已保留上次内容');
      }
    }
  } finally {
    st.loading = false;
  }
};

/**
 * Tabs 激活源变化（点击 tab 或横滑手势回流）：确保当前源当前栏目已加载
 */
watch(activeIndex, () => {
  void ensureChannel(activeChannelKey.value);
});

/**
 * 切换子栏目
 * @param sourceKey 源 key
 * @param channelKey 栏目 key
 */
const switchChannel = (sourceKey: string, channelKey: string): void => {
  if (channelBySource[sourceKey] === channelKey) return;
  channelBySource[sourceKey] = channelKey;
  void ensureChannel(`${sourceKey}:${channelKey}`);
};

/**
 * 下拉刷新：清当前「源 × 栏目」缓存（内存 + 持久层）→ 强制重拉
 * @param source 新闻源
 */
const onPullRefresh = async (source: MobileNewsSource): Promise<void> => {
  const channelKey = channelKeyOf(source);
  const st = pageOf(source);
  st.refreshing = true;
  await ensureChannel(channelKey, { force: true, silent: false });
  st.refreshing = false;
};

/**
 * 错误态重试（无缓存数据时的整块重试）
 * @param channelKey 频道 key
 */
const retry = (channelKey: string): void => {
  void ensureChannel(channelKey, { force: true });
};

/**
 * 打开原文（应用内 webview 容器；东财快讯的 url 为其站内搜索页）
 * @param item 新闻条目
 */
const openArticle = (item: HotNewsItem): void => {
  router.push({
    path: '/article',
    query: { url: item.url, title: item.title, media: item.media },
  });
};

/**
 * footer 文案：单页快照与翻页耗尽均显示「已经到底了~」；翻页中显示加载中
 * @param channelKey 频道 key
 * @returns footer 文案
 */
const footerText = (channelKey: string): string => {
  const st = pages[channelKey];
  if (!st) return '上拉加载更多';
  const def = channelDefOf(channelKey);
  if (st.loading) return '加载中…';
  if (st.finished || def?.type === 'single') return '已经到底了~';
  return '上拉加载更多';
};

/** 前台轮询：按设置间隔静默刷新当前「源 × 栏目」 */
useMobilePolling(() => ensureChannel(activeChannelKey.value, { force: true, silent: true }));

/** 触底哨兵元素登记表（key = 源 key，元素由各面板的函数 ref 提供） */
const sentinelEls = reactive<Record<string, Element | null>>({});
let sentinelObserver: IntersectionObserver | null = null;

/**
 * 触底哨兵进入视口（距底 400px 内）→ 为当前激活源追加下一页；
 * 非激活源的哨兵虽然在横滑轨道上被平移出视口、不会相交，天然只加载当前源
 * @param entries 观察条目
 */
const onSentinelIntersect = (entries: IntersectionObserverEntry[]): void => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const sourceKey = Object.keys(sentinelEls).find((key) => sentinelEls[key] === entry.target);
    if (sourceKey === undefined) continue;
    if (`${sourceKey}:${channelBySource[sourceKey]}` !== activeChannelKey.value) continue;
    void ensureChannel(activeChannelKey.value);
  }
};

/**
 * 哨兵元素函数 ref：登记元素并交给 IntersectionObserver 观察
 * @param source 新闻源
 * @param el 哨兵元素（Vue 函数 ref 回调形态，组件实例位置传 null 处理）
 */
const observeSentinel = (
  source: MobileNewsSource,
  el: Element | ComponentPublicInstance | null,
): void => {
  const element = el instanceof Element ? el : null;
  sentinelEls[source.key] = element;
  if (element === null) return;
  sentinelObserver ??= new IntersectionObserver(onSentinelIntersect, {
    rootMargin: LOAD_MORE_ROOT_MARGIN,
  });
  sentinelObserver.observe(element);
};

onMounted(() => {
  void ensureChannel(activeChannelKey.value);
});

onUnmounted(() => {
  sentinelObserver?.disconnect();
  sentinelObserver = null;
});
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar title="热点新闻" class="m-nav" safe-area-inset-top>
      <template #right>
        <van-icon name="setting-o" size="18" @click="router.push('/settings')" />
      </template>
    </van-nav-bar>

    <!-- 快照时刻（当前源当前栏目）：Vant NoticeBar -->
    <van-notice-bar
      v-if="activeFetchedAt !== null"
      class="m-notice"
      :scrollable="false"
      left-icon="clock-o"
    >
      快照生成于 {{ formatSnapshotTime(activeFetchedAt) }} · 缓存 30 分钟
    </van-notice-bar>

    <!-- 一级源：Vant Tabs（仅点击切换；不加任何触摸拦截，垂直滚动完全原生） -->
    <van-tabs
      v-model:active="activeIndex"
      class="m-tabs"
      :lazy-render="false"
      :ellipsis="false"
    >
      <van-tab v-for="source in MOBILE_NEWS_SOURCES" :key="source.key" :title="source.label">
        <!-- 二级子栏目 chips -->
        <div class="m-chips">
          <button
            v-for="channel in source.channels"
            :key="channel.key"
            class="m-chip m-chip--sub"
            :class="{ 'm-chip--active': channelBySource[source.key] === channel.key }"
            @click="switchChannel(source.key, channel.key)"
          >
            {{ channel.label }}
          </button>
        </div>

        <van-pull-refresh
          :model-value="pageOf(source).refreshing"
          @refresh="onPullRefresh(source)"
        >
          <div v-if="pageOf(source).error" class="m-error">
            <div>内容加载失败，请检查网络后重试</div>
            <button class="m-error__retry" @click="retry(channelKeyOf(source))">↻ 重新加载</button>
          </div>
          <template v-else>
            <div class="m-news-list">
              <NewsRow
                v-for="item in pageOf(source).items"
                :key="item.oid"
                :item="item"
                @open="openArticle"
              />
              <div v-if="pageOf(source).items.length === 0 && !pageOf(source).loading" class="m-empty">
                该栏目暂无内容，左右滑动切换其他源
              </div>
            </div>
            <!-- 触底哨兵：进入视口自动追加下一页 -->
            <div :ref="(el) => observeSentinel(source, el)" class="m-load-sentinel"></div>
            <div class="m-footer">{{ footerText(channelKeyOf(source)) }}</div>
          </template>
        </van-pull-refresh>
      </van-tab>
    </van-tabs>
  </div>
</template>

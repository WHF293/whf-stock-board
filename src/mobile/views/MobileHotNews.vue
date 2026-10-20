<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
import { useRouter } from 'vue-router';
import { showFailToast, showSuccessToast } from 'vant';
import { VueDraggable } from 'vue-draggable-plus';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  fetchClsDepth,
  fetchClsHotList,
  fetchEastmoneyHotNews,
  fetchEmHotKeywords,
  fetchEmLeadingConcepts,
  fetchEmRecommendNews,
  fetchSinaHotNews,
  fetchThsHeadlineHotNews,
  fetchThsHotNews,
  fetchThsHotThemes,
  fetchThsThemeFeed,
  fetchThepaperHotList,
  fetchThepaperHotNews,
  fetchTdxHotNews,
  TDX_NEWS_DETAIL_BASE,
} from '../../common/api/news.api.ts';
import type {
  ClsHotItem,
  EmConceptLeader,
  EmHotKeyword,
  HotNewsItem,
  TdxNewsChannel,
  ThsHotTheme,
  ThepaperHotItem,
} from '../../common/api/news.api.ts';
import {
  MOBILE_CACHE_TTL_MS,
  MOBILE_NEWS_PAGE_SIZE,
  MOBILE_NEWS_SOURCES,
  MOBILE_NEWS_SOURCE_LOGOS,
  SINA_LID_FINANCE,
  SINA_LID_STOCK,
} from '../constants';
import type { MobileNewsChannel, MobileNewsSource } from '../constants';import { STORAGE_NS_MOBILE_NEWS_SETTINGS } from '../../common/constants/storage-key.constants.ts';
import { appStorage } from '../../common/utils/app-local-storage';
import {
  mobileCacheGet,
  mobileCacheGetStale,
  mobileCacheRemove,
  mobileCacheSet,
} from '../cache';
import { useMobilePolling } from '../composables/use-mobile-polling';
import { formatNewsTime, formatPct, formatSnapshotTime, isTopRank, pctClass } from '../utils/format';
import NewsRow from '../components/NewsRow.vue';

/**
 * 热点新闻（移动端）
 *
 * 新闻源切换在 navbar 标题两侧的箭头 icon（◀ logo 当前源名 ▶，点击循环切换可见源）；
 * 各源子栏目（如同花顺的快讯/头条）升为 Vant Tabs（原源 tabs 的位置），一次只渲染当前源；
 * 频道页状态（items/翻页游标）按「源:栏目」独立持久化缓存
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
  /** 特殊渲染频道的载荷（通用新闻频道为 null） */
  special?: SpecialChannelData | null;
}

/**
 * 特殊渲染频道的载荷（可 JSON 序列化，随频道快照一起落 mobile.cache）
 *
 * kind 与 constants.ts 的 MobileNewsSpecialKind 一一对应
 */
type SpecialChannelData =
  | { kind: 'clsHot'; ranks: ClsHotItem[] }
  | { kind: 'tpHot'; ranks: ThepaperHotItem[] }
  | { kind: 'emHot'; keywords: EmHotKeyword[] }
  | { kind: 'emConcept'; concepts: EmConceptLeader[] };

/** 持久化的频道页快照（落 mobile.cache） */
interface CachedChannelPage {
  items: HotNewsItem[];
  cursor: string;
  page: number;
  finished: boolean;
  /** 特殊渲染载荷（通用新闻频道为 null） */
  special?: SpecialChannelData | null;
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
  special: null,
  loading: false,
  refreshing: false,
  error: false,
  fetchedAt: null,
  initialized: false,
});

const buildCacheKey = (channelKey: string): string => `news:${channelKey}`;

/** 触底哨兵的提前触发距离（IntersectionObserver rootMargin，距底 400px 内即开始追加） */
const LOAD_MORE_ROOT_MARGIN = '400px';

/* ---- 同花顺热点主题：主题列表（频道级独立小状态）+ 选中主题 ---- */

/** 热点主题频道缓存键（主题列表独立于资讯流快照） */
const THS_THEME_LIST_CACHE_KEY = 'news:ths:theme:themes';

/** 主题列表运行期状态（资讯流走通用频道管线，此处只管主题选择条） */
const thsThemes = reactive<{ loading: boolean; error: boolean; items: ThsHotTheme[] }>({
  loading: false,
  error: false,
  items: [],
});

/** 当前选中的热点主题 id（空串 = 尚未选择，资讯流取数前会自动补首个） */
const selectedThemeId = ref('');

/**
 * 拉取热点主题列表（30 分钟 TTL 缓存；列表到达且未选中时自动选首个）
 * @returns 最终选中的主题 id（列表不可用返回空串）
 */
const ensureThsThemes = async (): Promise<string> => {
  if (selectedThemeId.value) return selectedThemeId.value;
  if (thsThemes.items.length > 0) return thsThemes.items[0]!.themeId;
  if (thsThemes.loading) return '';
  thsThemes.loading = true;
  thsThemes.error = false;
  try {
    const cached = mobileCacheGet<{ themes: ThsHotTheme[] }>(THS_THEME_LIST_CACHE_KEY);
    if (cached) {
      thsThemes.items = cached.value.themes;
    } else {
      const themes = await fetchThsHotThemes();
      thsThemes.items = themes;
      mobileCacheSet(THS_THEME_LIST_CACHE_KEY, { themes });
    }
  } catch {
    thsThemes.error = true;
    return '';
  } finally {
    thsThemes.loading = false;
  }
  const first = thsThemes.items[0]?.themeId ?? '';
  selectedThemeId.value = first;
  return first;
};

/**
 * 切换热点主题：重置资讯流频道状态后重拉（缓存一并清除）
 * @param themeId 目标主题 id
 */
const selectTheme = (themeId: string): void => {
  if (selectedThemeId.value === themeId) return;
  selectedThemeId.value = themeId;
  pages['ths:theme'] = PAGE_STATE_DEFAULT();
  void ensureChannel('ths:theme', { force: true });
};

/**
 * 按频道 key 分发取数（page 型返回后页码 +1，cursor 型透传游标，single 型恒 finished）
 * @param channelKey 频道 key（`<sourceKey>:<channelKey>`）
 * @param ctx 翻页上下文
 * @returns 加载结果
 */const loadChannelPage = async (
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
    case 'cls:hot': {
      const ranks = await fetchClsHotList();
      return { items: [], nextCursor: null, finished: true, special: { kind: 'clsHot', ranks } };
    }
    case 'tp:hot': {
      const ranks = await fetchThepaperHotList();
      return { items: [], nextCursor: null, finished: true, special: { kind: 'tpHot', ranks } };
    }
    case 'em:hot': {
      const keywords = await fetchEmHotKeywords();
      return {
        items: [],
        nextCursor: null,
        finished: true,
        special: { kind: 'emHot', keywords },
      };
    }
    case 'em:concept': {
      const concepts = await fetchEmLeadingConcepts();
      return {
        items: [],
        nextCursor: null,
        finished: true,
        special: { kind: 'emConcept', concepts },
      };
    }
    case 'ths:theme': {
      // 热点主题资讯流（页码翻页）：主题未选中时先拉主题列表并选首个
      const themeId = selectedThemeId.value || (await ensureThsThemes());
      if (!themeId) throw new Error('热点主题列表不可用');
      const feed = await fetchThsThemeFeed(themeId, ctx.page, MOBILE_NEWS_PAGE_SIZE);
      return {
        items: feed.items,
        nextCursor: null,
        finished: !feed.hasMore,
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

/** 新闻源设置持久化形态（order 全量序 / hidden 隐藏集合），与今天炒什么平台设置同构 */
interface MobileNewsSettings {
  order: string[];
  hidden: string[];
}

const readNewsSettings = (): MobileNewsSettings => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_NEWS_SETTINGS);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<MobileNewsSettings>;
      if (Array.isArray(parsed.order) && Array.isArray(parsed.hidden)) {
        return { order: parsed.order, hidden: parsed.hidden };
      }
    } catch {
      // 坏包回落默认
    }
  }
  return { order: MOBILE_NEWS_SOURCES.map((source) => source.key), hidden: [] };
};

const newsSettings = reactive<MobileNewsSettings>(readNewsSettings());

const persistNewsSettings = (): void => {
  appStorage.setItem(
    STORAGE_NS_MOBILE_NEWS_SETTINGS,
    JSON.stringify({ order: newsSettings.order, hidden: newsSettings.hidden }),
  );
};

/** 源 key → 源定义（popup 展示 label + 过滤持久化里的未知 key） */
const sourceByKey = new Map(MOBILE_NEWS_SOURCES.map((source) => [source.key, source]));

/**
 * 新闻源展示名（popup 行渲染用）
 * @param sourceKey 源 key
 * @returns 展示名（未知 key 原样返回）
 */
const sourceLabel = (sourceKey: string): string => sourceByKey.get(sourceKey)?.label ?? sourceKey;

/** 可见源（隐藏源不参与 navbar 箭头切换；顺序 = 源设置调整后的持久化序） */
const visibleSources = computed<MobileNewsSource[]>(() =>
  newsSettings.order
    .filter((key) => !newsSettings.hidden.includes(key))
    .map((key) => sourceByKey.get(key))
    .filter((source): source is MobileNewsSource => source !== undefined),
);

const activeIndex = ref(0);
/** 当前源的子栏目 tab 序（子栏目升为 tabs 后的 v-model） */
const activeChannelIndex = ref(0);
const settingsOpen = ref(false);

/** 安全取当前源（隐藏源后 activeIndex 越界时回落第一个可见源） */
const activeSource = computed<MobileNewsSource>(() => {
  const list = visibleSources.value;
  return list[Math.min(activeIndex.value, list.length - 1)] ?? MOBILE_NEWS_SOURCES[0]!;
});

/** 隐藏源后校正 activeIndex（tabs 高亮与面板对齐，避免停在已消失的 tab 上） */
const clampActiveIndex = (): void => {
  const max = visibleSources.value.length - 1;
  if (activeIndex.value > max) activeIndex.value = Math.max(max, 0);
};

/** 每源当前子栏目（默认取该源第一个；记忆到会话内，不做持久化） */
const channelBySource = reactive<Record<string, string>>(
  Object.fromEntries(MOBILE_NEWS_SOURCES.map((source) => [source.key, source.channels[0]!.key])),
);

/** 全部已触达频道的分页状态 */
const pages = reactive<Record<string, ChannelPageState>>({});

/** 当前源当前栏目的缓存键 */
const activeChannelKey = computed(
  () => `${activeSource.value.key}:${channelBySource[activeSource.value.key]}`,
);

/** 当前频道的快照时刻（摘要条展示；null = 尚未抓取） */
const activeFetchedAt = computed<number | null>(
  () => pages[activeChannelKey.value]?.fetchedAt ?? null,
);

/**
 * 模板取状态（reactive 记录自动补默认值）；栏目 tab 面板各取各的频道数据，
 * 避免横滑过渡期间面板串用当前记忆栏目的数据
 * @param source 新闻源
 * @param channel 栏目定义
 * @returns 该「源 × 栏目」的状态
 */
const pageOfChannel = (source: MobileNewsSource, channel: MobileNewsChannel): ChannelPageState => {
  const key = `${source.key}:${channel.key}`;
  return (pages[key] ??= PAGE_STATE_DEFAULT());
};

/**
 * 「源 × 栏目」的缓存键
 * @param source 新闻源
 * @param channel 栏目定义
 * @returns 缓存键（`<sourceKey>:<channelKey>`）
 */
const channelKeyOf = (source: MobileNewsSource, channel: MobileNewsChannel): string =>
  `${source.key}:${channel.key}`;

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
      st.special = fresh.value.special ?? null;
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
    st.special = null;
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
    st.special = result.special ?? null;
    st.fetchedAt = Date.now();
    mobileCacheSet(cacheKey, {
      items: st.items,
      cursor: st.cursor,
      page: st.page,
      finished: st.finished,
      special: st.special,
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
 * navbar 标题箭头切换新闻源（循环：首个左切到末位，末位右切回首位）
 * @param offset 切换偏移（-1 上一个 / 1 下一个）
 */
const switchSource = (offset: number): void => {
  const list = visibleSources.value;
  const len = list.length;
  if (len === 0) return;
  const idx = list.findIndex((source) => source.key === activeSource.value.key);
  const base = idx >= 0 ? idx : 0;
  activeIndex.value = (base + offset + len) % len;
};

/**
 * 激活源变化（navbar 箭头 / 显隐校正 / 排序跟随）：
 * 栏目 tab 高亮对齐该源记忆的栏目，并确保当前「源 × 栏目」已加载
 */
watch(activeIndex, () => {
  const source = activeSource.value;
  const ci = source.channels.findIndex((channel) => channel.key === channelBySource[source.key]);
  activeChannelIndex.value = Math.max(ci, 0);
  void ensureChannel(activeChannelKey.value);
});

/**
 * 源显隐开关（至少保留一个源；隐藏只隐藏 tab，缓存保留）
 * @param sourceKey 源 key
 * @param visible true 显示，false 隐藏
 */
const toggleSource = (sourceKey: string, visible: boolean): void => {
  const nextHidden = new Set(newsSettings.hidden);
  if (visible) {
    nextHidden.delete(sourceKey);
  } else {
    if (newsSettings.order.length - nextHidden.size <= 1) {
      showFailToast('至少保留一个新闻源');
      return;
    }
    nextHidden.add(sourceKey);
  }
  newsSettings.hidden = [...nextHidden];
  persistNewsSettings();
  clampActiveIndex();
};

/* === 源拖拽排序（vue-draggable-plus） ===
 * 拖拽开始时记下当前激活源，排序结束后激活 tab 跟随该源的新位置
 * （沿用原上下移排序的「tab 跟随」语义；v-model 已即时更新 order） */
const dragActiveKey = ref<string | null>(null);

/** 拖拽结束：持久化 + 激活 tab 跟随 */
const onOrderChanged = (): void => {
  persistNewsSettings();
  const key = dragActiveKey.value;
  if (key === null) return;
  const newIndex = visibleSources.value.findIndex((source) => source.key === key);
  if (newIndex >= 0 && newIndex !== activeIndex.value) activeIndex.value = newIndex;
};

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
 * 栏目 tab 切换（点 tab / 横滑经 v-model 回流）：记忆到该源并加载
 */
watch(activeChannelIndex, () => {
  const source = activeSource.value;
  const channel = source.channels[activeChannelIndex.value];
  if (channel) switchChannel(source.key, channel.key);
});

/**
 * 下拉刷新：清当前「源 × 栏目」缓存（内存 + 持久层）→ 强制重拉
 * @param channelKey 频道 key（`<sourceKey>:<channelKey>`）
 */
const onPullRefresh = async (channelKey: string): Promise<void> => {
  const st = (pages[channelKey] ??= PAGE_STATE_DEFAULT());
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
 * 打开原文（应用内 webview 容器；东财快讯的 url 为其正文页）
 *
 * ⚠️ 通达信详情页数据靠其 WebSocket 网关 + 会话 Cookie，应用内 iframe 是跨域
 * 第三方上下文、WebView 拦 Cookie → 白屏，故直接走系统浏览器（与 PC 新开标签页同为第一方上下文）
 * @param item 新闻条目
 */
const openArticle = (item: HotNewsItem): void => {
  if (item.url.startsWith(TDX_NEWS_DETAIL_BASE)) {
    showSuccessToast('已在系统浏览器打开');
    void openUrl(item.url).catch(() => window.open(item.url, '_blank'));
    return;
  }
  router.push({
    path: '/article',
    query: { url: item.url, title: item.title, media: item.media },
  });
};

/**
 * 特殊榜单行（热榜 / 热词 / 领涨概念）的打开链路：
 * 拼装最小 HotNewsItem 复用 openArticle（webview 容器 / TDX 系统浏览器判定）
 * @param url 跳转地址
 * @param title 标题（webview navbar 展示）
 * @param media 来源媒体
 */
const openSpecialLink = (url: string, title: string, media: string): void => {
  openArticle({ oid: `sp-${url}`, title, summary: '', url, ctime: '', media, img: '' });
};

/**
 * 财联社热榜阅读数展示（≥1 万显示「x.x万」，与 PC formatReadNum 同口径）
 * @param readNum 阅读数
 * @returns 展示文案
 */
const formatReadNum = (readNum: number): string => {
  if (readNum >= 10000) return `${(readNum / 10000).toFixed(1)}万`;
  return String(readNum);
};

/**
 * 东财领涨概念点击的站内搜索地址（与 PC 打开目标一致）
 * @param name 概念板块名
 * @returns 搜索页地址
 */
const emConceptSearchUrl = (name: string): string =>
  `https://so.eastmoney.com/web/s?keyword=${encodeURIComponent(name)}`;

/**
 * 特殊频道的载荷取值（模板用；kind 不符时返回空数组兜底）
 * @param st 频道状态
 * @returns 对应载荷数组
 */
const clsRanksOf = (st: ChannelPageState): ClsHotItem[] =>
  st.special?.kind === 'clsHot' ? st.special.ranks : [];

const tpRanksOf = (st: ChannelPageState): ThepaperHotItem[] =>
  st.special?.kind === 'tpHot' ? st.special.ranks : [];

const emKeywordsOf = (st: ChannelPageState): EmHotKeyword[] =>
  st.special?.kind === 'emHot' ? st.special.keywords : [];

const emConceptsOf = (st: ChannelPageState): EmConceptLeader[] =>
  st.special?.kind === 'emConcept' ? st.special.concepts : [];

/**
 * 切到热点主题栏目时预拉主题列表
 * （资讯流快照缓存新鲜时 loadChannelPage 不会执行，主题 chips 需单独保障）
 */
watch(activeChannelKey, (key) => {
  if (key === 'ths:theme') void ensureThsThemes();
});

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

/** 触底哨兵元素登记表（key = 频道 key `<sourceKey>:<channelKey>`，元素由各面板的函数 ref 提供） */
const sentinelEls = reactive<Record<string, Element | null>>({});
let sentinelObserver: IntersectionObserver | null = null;

/**
 * 触底哨兵进入视口（距底 400px 内）→ 为当前激活频道追加下一页；
 * 非激活面板的哨兵虽然在横滑轨道上被平移出视口、不会相交，天然只加载当前面板
 * @param entries 观察条目
 */
const onSentinelIntersect = (entries: IntersectionObserverEntry[]): void => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const channelKey = Object.keys(sentinelEls).find((key) => sentinelEls[key] === entry.target);
    if (channelKey === undefined || channelKey !== activeChannelKey.value) continue;
    void ensureChannel(activeChannelKey.value);
  }
};

/**
 * 哨兵元素函数 ref：登记元素并交给 IntersectionObserver 观察
 * @param channelKey 频道 key（`<sourceKey>:<channelKey>`）
 * @param el 哨兵元素（Vue 函数 ref 回调形态，组件实例位置传 null 处理）
 */
const observeSentinel = (
  channelKey: string,
  el: Element | ComponentPublicInstance | null,
): void => {
  const element = el instanceof Element ? el : null;
  const prev = sentinelEls[channelKey];
  if (prev && prev !== element) sentinelObserver?.unobserve(prev);
  sentinelEls[channelKey] = element;
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
    <!-- navbar 标题两侧箭头循环切新闻源，标题前带当前源 logo（王总 2026-10-11 / 2026-10-12） -->
    <van-nav-bar class="m-nav" safe-area-inset-top>
      <template #title>
        <div class="m-nav-switch">
          <van-icon name="play" class="m-nav-switch__flip" size="15" @click="switchSource(-1)" />
          <img class="m-nav-src-logo" :src="MOBILE_NEWS_SOURCE_LOGOS[activeSource.key]" alt="" />
          <span>{{ activeSource.label }}</span>
          <van-icon name="play" size="15" @click="switchSource(1)" />
        </div>
      </template>
      <template #right>
        <van-icon name="setting-o" size="18" @click="settingsOpen = true" />
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

    <!-- 子栏目 Tabs（原源 tabs 的位置，源切换改由 navbar 标题两侧箭头承担；
         animated 点击切换横滑过渡；不开 swipeable，触摸拦截为零，垂直滚动完全原生）。
         :key 按 source 强制换源整体重挂载：换源当轮 Vant 的 setLine 会跑在新 TabTitle
         ref 登记之前而静默跳过（浏览器实测 2026-10-12，nextTick resize 也救不了），
         指示条停留在旧源偏移；重挂载走 Tabs init 的测量路径，实测是准的 -->
    <van-tabs
      :key="activeSource.key"
      v-model:active="activeChannelIndex"
      class="m-tabs"
      animated
      :lazy-render="false"
      :ellipsis="false"
    >
      <van-tab v-for="channel in activeSource.channels" :key="channel.key" :title="channel.label">
        <van-pull-refresh
          :model-value="pageOfChannel(activeSource, channel).refreshing"
          @refresh="onPullRefresh(channelKeyOf(activeSource, channel))"
        >
          <div v-if="pageOfChannel(activeSource, channel).error" class="m-error">
            <van-icon name="warning-o" />
            <div>内容加载失败，请检查网络后重试</div>
            <button
              class="m-error__retry"
              @click="retry(channelKeyOf(activeSource, channel))"
            >
              ↻ 重新加载
            </button>
          </div>
          <template v-else>
            <!-- 财联社热榜：名次榜（标题 + 时间 + 阅读数） -->
            <div v-if="channel.special === 'clsHot'" class="m-rank-list">
              <button
                v-for="(hp, index) in clsRanksOf(pageOfChannel(activeSource, channel))"
                :key="hp.id"
                class="m-rank-row"
                @click="openSpecialLink(hp.url, hp.title, '财联社')"
              >
                <span
                  class="m-rank-row__rank"
                  :class="{ 'm-rank-row__rank--top': isTopRank(index + 1) }"
                >
                  {{ index + 1 }}
                </span>
                <div class="m-rank-row__main">
                  <div class="t">{{ hp.title }}</div>
                  <div class="meta">
                    <span>{{ formatNewsTime(hp.ctime) }}</span>
                    <span>{{ formatReadNum(hp.readNum) }}阅读</span>
                  </div>
                </div>
              </button>
              <div
                v-if="clsRanksOf(pageOfChannel(activeSource, channel)).length === 0 && !pageOfChannel(activeSource, channel).loading"
                class="m-empty"
              >
                该栏目暂无内容，点顶部箭头切换其他源
              </div>
            </div>

            <!-- 澎湃热榜：名次榜（标题 + 相对时间） -->
            <div v-else-if="channel.special === 'tpHot'" class="m-rank-list">
              <button
                v-for="(hp, index) in tpRanksOf(pageOfChannel(activeSource, channel))"
                :key="hp.contId"
                class="m-rank-row"
                @click="openSpecialLink(hp.url, hp.title, '澎湃新闻')"
              >
                <span
                  class="m-rank-row__rank"
                  :class="{ 'm-rank-row__rank--top': isTopRank(index + 1) }"
                >
                  {{ index + 1 }}
                </span>
                <div class="m-rank-row__main">
                  <div class="t">{{ hp.title }}</div>
                  <div class="meta"><span>{{ hp.timeText }}</span></div>
                </div>
              </button>
              <div
                v-if="tpRanksOf(pageOfChannel(activeSource, channel)).length === 0 && !pageOfChannel(activeSource, channel).loading"
                class="m-empty"
              >
                该栏目暂无内容，点顶部箭头切换其他源
              </div>
            </div>

            <!-- 东财热搜：热词榜 -->
            <div v-else-if="channel.special === 'emHot'" class="m-rank-list">
              <button
                v-for="(kw, index) in emKeywordsOf(pageOfChannel(activeSource, channel))"
                :key="kw.url"
                class="m-rank-row"
                @click="openSpecialLink(kw.url, kw.phrase, '东方财富')"
              >
                <span
                  class="m-rank-row__rank"
                  :class="{ 'm-rank-row__rank--top': isTopRank(index + 1) }"
                >
                  {{ index + 1 }}
                </span>
                <div class="m-rank-row__main">
                  <div class="t">
                    {{ kw.phrase }}
                    <span v-if="kw.isNew" class="m-kw-new">新</span>
                  </div>
                </div>
                <van-icon name="arrow" class="m-rank-row__go" />
              </button>
              <div
                v-if="emKeywordsOf(pageOfChannel(activeSource, channel)).length === 0 && !pageOfChannel(activeSource, channel).loading"
                class="m-empty"
              >
                该栏目暂无内容，点顶部箭头切换其他源
              </div>
            </div>

            <!-- 东财领涨概念：板块 + 涨跌幅 + 领涨股 -->
            <div v-else-if="channel.special === 'emConcept'" class="m-rank-list">
              <button
                v-for="(cp, index) in emConceptsOf(pageOfChannel(activeSource, channel))"
                :key="cp.code"
                class="m-rank-row"
                @click="openSpecialLink(emConceptSearchUrl(cp.name), cp.name, '东方财富')"
              >
                <span
                  class="m-rank-row__rank"
                  :class="{ 'm-rank-row__rank--top': isTopRank(index + 1) }"
                >
                  {{ index + 1 }}
                </span>
                <div class="m-rank-row__main">
                  <div class="t">{{ cp.name }}</div>
                  <div class="meta"><span>领涨股 {{ cp.leaderStock }}</span></div>
                </div>
                <span class="m-rank-row__pct m-num" :class="pctClass(cp.chgPct)">
                  {{ formatPct(cp.chgPct) }}
                </span>
              </button>
              <div
                v-if="emConceptsOf(pageOfChannel(activeSource, channel)).length === 0 && !pageOfChannel(activeSource, channel).loading"
                class="m-empty"
              >
                该栏目暂无内容，点顶部箭头切换其他源
              </div>
            </div>

            <!-- 同花顺热点主题：主题 chips + 该主题资讯流（通用新闻列表） -->
            <template v-else-if="channel.special === 'theme'">
              <div class="m-chips m-theme-chips">
                <button
                  v-for="theme in thsThemes.items"
                  :key="theme.themeId"
                  class="m-chip m-chip--sub"
                  :class="{ 'm-chip--active': selectedThemeId === theme.themeId }"
                  @click="selectTheme(theme.themeId)"
                >
                  {{ theme.themeName }}
                </button>
              </div>
              <div v-if="thsThemes.loading && thsThemes.items.length === 0" class="m-empty">
                主题加载中…
              </div>
              <div v-else-if="thsThemes.error && thsThemes.items.length === 0" class="m-error">
                <van-icon name="warning-o" />
                <div>主题列表加载失败</div>
                <button class="m-error__retry" @click="void ensureThsThemes()">↻ 重新加载</button>
              </div>
              <div class="m-news-list">
                <NewsRow
                  v-for="item in pageOfChannel(activeSource, channel).items"
                  :key="item.oid"
                  :item="item"
                  @open="openArticle"
                />
                <div
                  v-if="pageOfChannel(activeSource, channel).items.length === 0 && !pageOfChannel(activeSource, channel).loading"
                  class="m-empty"
                >
                  该主题暂无内容，切换其他主题试试
                </div>
              </div>
            </template>

            <!-- 通用新闻列表（NewsRow） -->
            <div v-else class="m-news-list">
              <NewsRow
                v-for="item in pageOfChannel(activeSource, channel).items"
                :key="item.oid"
                :item="item"
                @open="openArticle"
              />
              <div
                v-if="pageOfChannel(activeSource, channel).items.length === 0 && !pageOfChannel(activeSource, channel).loading"
                class="m-empty"
              >
                该栏目暂无内容，点顶部箭头切换其他源
              </div>
            </div>
            <!-- 触底哨兵：进入视口自动追加下一页 -->
            <div
              :ref="(el) => observeSentinel(channelKeyOf(activeSource, channel), el)"
              class="m-load-sentinel"
            ></div>
            <div class="m-footer">{{ footerText(channelKeyOf(activeSource, channel)) }}</div>
          </template>
        </van-pull-refresh>
      </van-tab>
    </van-tabs>

    <!-- 新闻源设置弹层（显隐 + 拖拽排序，与今天炒什么平台设置同构；
         拖拽用 vue-draggable-plus，handle 限定手柄 + force-fallback（WebView 必需）） -->
    <van-popup v-model:show="settingsOpen" position="bottom" round>
      <div style="padding: 14px 16px 18px">
        <div class="m-board-head" style="padding-top: 0">
          <div class="m-board-head__title">新闻源设置</div>
          <div class="m-board-head__time">开关显隐 · 拖拽调整顺序</div>
        </div>
        <VueDraggable
          v-model="newsSettings.order"
          tag="div"
          :animation="150"
          handle=".m-drag-handle"
          :force-fallback="true"
          fallback-class="sortable-fallback"
          ghost-class="m-drag-ghost"
          chosen-class="m-drag-chosen"
          :fallback-tolerance="6"
          @start="dragActiveKey = activeSource.key"
          @update="onOrderChanged"
        >
          <div
            v-for="sourceKey in newsSettings.order"
            :key="sourceKey"
            class="m-sheet-row"
          >
            <span class="m-drag-handle"><van-icon name="wap-nav" /></span>
            <div
              class="m-sheet-row__name"
              :class="{ 'm-sheet-row__name--off': newsSettings.hidden.includes(sourceKey) }"
            >
              {{ sourceLabel(sourceKey) }}
              <span v-if="newsSettings.hidden.includes(sourceKey)">已隐藏 · 缓存保留</span>
            </div>
            <van-switch
              :model-value="!newsSettings.hidden.includes(sourceKey)"
              size="20px"
              @update:model-value="(value: boolean) => toggleSource(sourceKey, value)"
            />
          </div>
        </VueDraggable>
        <van-button type="primary" block round style="margin-top: 14px" @click="settingsOpen = false">
          完成
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

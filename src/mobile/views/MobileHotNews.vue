<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import type { ComponentPublicInstance } from 'vue';
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
import { formatNewsTime, formatPct, formatSnapshotTime, isTopRank, pctClass } from '../utils/format';
import NewsRow from '../components/NewsRow.vue';
import NewsSkeleton from '../components/NewsSkeleton.vue';
import NewsArticlePane from '../components/NewsArticlePane.vue';
import type { NewsArticlePaneTarget } from '../components/NewsArticlePane.vue';
import { useBreakpoint } from '../composables/use-breakpoint';
import { useSwipeSwitch } from '../composables/use-swipe-switch';

/**
 * 热点新闻（移动端）
 *
 * 新闻源切换在 navbar 标题两侧的箭头 icon（◀ logo 当前源名 ▶，点击循环切换可见源）；
 * 各源子栏目（如同花顺的快讯/头条）升为 Vant Tabs（原源 tabs 的位置），一次只渲染当前源；
 * 频道页状态（items/翻页游标）按「源:栏目」独立持久化缓存
 * （30 分钟 TTL），下拉为唯一强制刷新，navbar 不设刷新按钮；
 * 2026-10-20 起取消前台轮询（王总反馈「页面放着不动自己闪一下刷新」）：
 * 原 30s 轮询 force 路径会清列表 + 删缓存重建，既闪屏又打穿缓存 TTL——
 * 快照类内容刷新只走下拉，进入 / 切回页面一律吃缓存
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

/* === 大屏（≥840px）主从布局 ===
 * 左列表右原文同屏（左4右6，2026-10-28 王总指定）：openArticle 在 lg 档不再跳
 * /article 路由，就地写入右侧窗格的阅读目标；窗格内部复用 webview 容器逻辑
 * （iframe + 进度条 + 系统浏览器兜底），被目标站拒嵌时点窗格右上角 ↗ 兜底 */
const { lg } = useBreakpoint();

/** 右侧窗格当前阅读目标（null = 占位态「点击左侧新闻」） */
const paneArticle = ref<NewsArticlePaneTarget | null>(null);

/* === 窄屏（<840px）原文弹窗（2026-10-30 王总指定）===
 * 原 /article 整页路由已删除：窄屏改为 80% 屏高的底部弹窗加载同一 NewsArticlePane
 * 节点，与大屏右栏只是承载容器不同、阅读节点完全一致，两条分支不再各养一套逻辑 */
/** 原文弹窗当前阅读目标（null = 弹窗关闭） */
const modalArticle = ref<NewsArticlePaneTarget | null>(null);

/** 弹窗显隐（van-popup 的 v-model 需要 LHS，经 computed 桥接「有无阅读目标」） */
const modalOpen = computed<boolean>({
  get: () => modalArticle.value !== null,
  set: (open) => {
    if (!open) modalArticle.value = null;
  },
});

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

/** 当前「源 × 栏目」的页状态（reactive 记录自动补默认值；内容区单一渲染只读它） */
const activePage = computed<ChannelPageState>(
  () => pages[activeChannelKey.value] ?? PAGE_STATE_DEFAULT(),
);

/** 当前频道的特殊渲染分支（缺省走 NewsRow 通用新闻列表；模板分支判定用） */
const activeChannelSpecial = computed(
  () => channelDefOf(activeChannelKey.value)?.special,
);

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
 * @param opts.force 清空重拉（下拉）
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

/* === swiper 式横滑切源（2026-10-30 王总指定，交互对齐 youtube-desktop）===
 * 中间为当前源实际内容，两侧相邻源骨架屏；拖拽跟手 → 松手按位移/轻扫速度判定 →
 * 过阈值动画滑入相邻骨架屏、动画结束才切 activeIndex 发真实请求（未过阈值回弹）。
 * 手势绑在下方 .m-swipe 内容区（不含子栏目 tabs 条，m-chips 主题条由 ignoreSelector 排除） */
/** 当前源在可见源中的下标（横滑边界钳制用；隐藏源后与 activeIndex 解耦取实位） */
const swipeIndex = computed(() => {
  const idx = visibleSources.value.findIndex((source) => source.key === activeSource.value.key);
  return Math.max(idx, 0);
});

const {
  onSwipeEl,
  phase: swipePhase,
  containerStyle,
} = useSwipeSwitch({
  count: () => visibleSources.value.length,
  index: () => swipeIndex.value,
  // 手势绑定的内容区里只有主题 chips 需要横向滚动，整块让位原生横滚
  ignoreSelector: '.m-chips',
  onChange: (next) => {
    activeIndex.value = next;
  },
});

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
 * 大屏（≥840px）写右侧窗格就地阅读；窄屏写 80% 屏高弹窗（2026-10-30 起，/article 路由已删）
 * @param item 新闻条目
 */
const openArticle = (item: HotNewsItem): void => {
  if (item.url.startsWith(TDX_NEWS_DETAIL_BASE)) {
    showSuccessToast('已在系统浏览器打开');
    void openUrl(item.url).catch(() => window.open(item.url, '_blank'));
    return;
  }
  const target = { url: item.url, title: item.title, media: item.media };
  if (lg.value) {
    paneArticle.value = target;
    return;
  }
  modalArticle.value = target;
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

/** 当前频道内容是否为空（通用列表看 items、特殊榜单看各自载荷；骨架/空态判定用） */
const activeEmpty = computed<boolean>(() => {
  const st = activePage.value;
  if (st.special?.kind === 'clsHot') return st.special.ranks.length === 0;
  if (st.special?.kind === 'tpHot') return st.special.ranks.length === 0;
  if (st.special?.kind === 'emHot') return st.special.keywords.length === 0;
  if (st.special?.kind === 'emConcept') return st.special.concepts.length === 0;
  return st.items.length === 0;
});

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

    <!-- 大屏（≥840px）主从布局容器：左列表（4/10）右原文（6/10）；
         窄档为纯纵向壳（flex column），结构上等同原直排 -->
    <div class="m-news-duo">
      <div class="m-news-duo__l">
        <!-- 子栏目 Tabs：空 van-tab 只当分段选择器，内容由下方 .m-swipe 承担
             （2026-10-30 横滑切源改版，同 MobileBoard）。:key 按 source 强制换源整体
             重挂载：换源当轮 Vant 的 setLine 会跑在新 TabTitle ref 登记之前而静默跳过
             （浏览器实测 2026-10-12，nextTick resize 也救不了），指示条停留在旧源偏移；
             重挂载走 Tabs init 的测量路径，实测是准的 -->
        <van-tabs
          :key="activeSource.key"
          v-model:active="activeChannelIndex"
          class="m-tabs m-tabs--selector"
          :ellipsis="false"
        >
          <van-tab v-for="channel in activeSource.channels" :key="channel.key" :title="channel.label" />
        </van-tabs>

        <!-- swiper 式横滑切源内容区（2026-10-30 王总指定，交互对齐 youtube-desktop）：
             中间为当前源实际内容，两侧相邻源骨架屏（拖拽/过渡期挂载、随容器位移）；
             首载与切源过渡态一律骨架屏（骨架即 loading），下拉 / 触底保留 loading 语义 -->
        <div :ref="onSwipeEl" class="m-swipe">
          <div class="m-swipe__inner" :style="containerStyle">
            <!-- 相邻源骨架屏：边界侧不挂（不循环） -->
            <div
              v-if="swipePhase !== null && swipeIndex > 0"
              class="m-swipe__side m-swipe__side--prev"
            >
              <NewsSkeleton />
            </div>
            <div
              v-if="swipePhase !== null && swipeIndex < visibleSources.length - 1"
              class="m-swipe__side m-swipe__side--next"
            >
              <NewsSkeleton />
            </div>

            <van-pull-refresh
              :model-value="activePage.refreshing"
              @refresh="onPullRefresh(activeChannelKey)"
            >
              <div v-if="activePage.error" class="m-error">
                <van-icon name="warning-o" />
                <div>内容加载失败，请检查网络后重试</div>
                <button class="m-error__retry" @click="retry(activeChannelKey)">
                  ↻ 重新加载
                </button>
              </div>
              <template v-else>
                <!-- 首载 / 切源过渡态：骨架屏（骨架即 loading，不再展示加载文案） -->
                <NewsSkeleton v-if="activeEmpty && activePage.loading" />
                <template v-else>
                  <!-- 同花顺热点主题：主题 chips + 该主题资讯流（通用新闻列表） -->
                  <template v-if="activeChannelSpecial === 'theme'">
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
                    <div class="m-news-list">
                      <NewsRow
                        v-for="item in activePage.items"
                        :key="item.oid"
                        :item="item"
                        @open="openArticle"
                      />
                    </div>
                  </template>

                  <!-- 财联社热榜：名次榜（标题 + 时间 + 阅读数） -->
                  <div v-else-if="activeChannelSpecial === 'clsHot'" class="m-rank-list">
                    <button
                      v-for="(hp, index) in clsRanksOf(activePage)"
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
                  </div>

                  <!-- 澎湃热榜：名次榜（标题 + 相对时间） -->
                  <div v-else-if="activeChannelSpecial === 'tpHot'" class="m-rank-list">
                    <button
                      v-for="(hp, index) in tpRanksOf(activePage)"
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
                  </div>

                  <!-- 东财热搜：热词榜 -->
                  <div v-else-if="activeChannelSpecial === 'emHot'" class="m-rank-list">
                    <button
                      v-for="(kw, index) in emKeywordsOf(activePage)"
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
                  </div>

                  <!-- 东财领涨概念：板块 + 涨跌幅 + 领涨股 -->
                  <div v-else-if="activeChannelSpecial === 'emConcept'" class="m-rank-list">
                    <button
                      v-for="(cp, index) in emConceptsOf(activePage)"
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
                  </div>

                  <!-- 通用新闻列表（NewsRow） -->
                  <div v-else class="m-news-list">
                    <NewsRow
                      v-for="item in activePage.items"
                      :key="item.oid"
                      :item="item"
                      @open="openArticle"
                    />
                  </div>
                </template>
                <!-- 空态（非加载中且无内容） -->
                <div v-if="activeEmpty && !activePage.loading" class="m-empty">
                  {{
                    activeChannelSpecial === 'theme'
                      ? '该主题暂无内容，切换其他主题试试'
                      : '该栏目暂无内容，点顶部箭头切换其他源'
                  }}
                </div>
                <!-- 触底哨兵：进入视口自动追加下一页 -->
                <div
                  :ref="(el) => observeSentinel(activeChannelKey, el)"
                  class="m-load-sentinel"
                ></div>
                <div class="m-footer">{{ footerText(activeChannelKey) }}</div>
              </template>
            </van-pull-refresh>
          </div>
        </div>
      </div>
      <!-- 大屏右栏：原文阅读窗格（2026-10-28 王总指定：默认不显示，点左栏新闻才出现，
           关闭后右栏整体收起、左栏占满；窗格头部自带 ✕ 关闭按钮） -->
      <div v-if="lg && paneArticle" class="m-news-duo__r">
        <NewsArticlePane :article="paneArticle" @close="paneArticle = null" />
      </div>
    </div>

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

    <!-- 窄屏原文弹窗（80% 屏高，2026-10-30 王总指定）：加载与大屏右栏同一 NewsArticlePane 节点，
         :key 按 url 换稿重挂（进度条 / iframe 重新走加载链）；头部自带 ↗ 系统浏览器兜底与 ✕ 关闭 -->
    <van-popup
      v-model:show="modalOpen"
      position="bottom"
      round
      :style="{ height: '80%' }"
    >
      <NewsArticlePane
        v-if="modalArticle"
        :key="modalArticle.url"
        :article="modalArticle"
        @close="modalArticle = null"
      />
    </van-popup>
  </div>
</template>

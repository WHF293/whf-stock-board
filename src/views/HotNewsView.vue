<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { openUrl } from "@tauri-apps/plugin-opener";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseEmpty from "../components/ui/BaseEmpty.vue";
import BaseModal from "../components/ui/BaseModal.vue";
import BaseSkeleton from "../components/ui/BaseSkeleton.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import HotNewsChannelBar from "../components/news/HotNewsChannelBar.vue";
import HotNewsSourceModal from "../components/news/HotNewsSourceModal.vue";
import {
  fetchClsDepth,
  fetchClsHotList,
  fetchEastmoneyHotNews,
  fetchEmHotKeywords,
  fetchEmLeadingConcepts,
  fetchEmRecommendNews,
  fetchSinaHotNews,
  fetchThepaperHotList,
  fetchThepaperHotNews,
  fetchThsHeadlineHotNews,
  fetchThsHotNews,
  fetchThsHotThemes,
  fetchThsThemeFeed,
  type ClsHotItem,
  type EmConceptLeader,
  type EmHotKeyword,
  type HotNewsItem,
  type ThepaperHotItem,
  type ThsHotTheme,
} from "../api/news.api";
import { useDataCacheStore } from "../stores/data-cache";
import { useSettingsStore } from "../stores/settings";
import { DATA_CACHE_KEY } from "../constants/data-cache.constants";
import { HOST_HEADER_ITEM } from "../constants/header.constants";
import {
  CLS_SUB_VIEW_LABELS,
  CLS_SUB_VIEW_OPTIONS,
  EM_SUB_VIEW_LABELS,
  EM_SUB_VIEW_OPTIONS,
  THS_SUB_VIEW_LABELS,
  THS_SUB_VIEW_OPTIONS,
  TP_SUB_VIEW_LABELS,
  TP_SUB_VIEW_OPTIONS,
  type ClsSubView,
  type EmSubView,
  type ThsSubView,
  type TpSubView,
} from "../constants/hot-news.constants";
import { STORAGE_NS_HOT_NEWS_FILTER } from "../constants/storage-key.constants";
import { appStorage } from "../utils/app-local-storage";
import { buildNewsAnalysisPrompt } from "../utils/build-news-analysis-prompt";
import { requestAgentAnalysis } from "../agent/agent-bridge";
import { useNotificationsStore } from "../stores/notifications";
import { NOTIFY_TONE } from "../constants/notify.constants";

/**
 * 热点新闻：横向卡片流（每源一张卡片，固定 375px 宽，超出页面横向滚动）
 *
 * 翻页模型：新浪 / 同花顺（快讯、热点主题）为页码递增（cursor=number），
 * 东财为 sortEnd 游标、澎湃为 startTime 游标（cursor=string）、同花顺头条为单页无翻页；
 * 「同花顺热点主题」卡片内含三条取数通道（热点主题 / 快讯 / 头条，见 ThsSubView）——
 * 三者各自独立分页与缓存，只拉当前选中子视图；热点主题子视图头部另有主题 chips 单选行，
 * 切换主题重置该通道分页；
 * 「东方财富」卡片同样按子视图拆分（快讯 / 推荐 / 热搜 / 领涨概念，见 EmSubView）：
 * 快讯沿用 7×24 通道，其余三个是 so.eastmoney.com 同名模块的单页快照（无翻页），
 * 热搜 / 领涨概念的数据结构不是新闻条目，卡片与放大弹窗内分支渲染；
 * 「澎湃新闻」卡片按子视图拆分（快讯 / 热榜，见 TpSubView）：
 * 快讯沿用财经频道通道，热榜是频道页右侧栏的单页快照（名次榜，分支渲染）；
 * 「财联社」卡片按子视图拆分（深度 / 热榜，见 ClsSubView）：
 * 深度 = 深度页 top_article + depth_list 快照（映射成通用条目复用列表渲染），
 * 热榜 = 热门文章排行榜快照（名次 + 阅读数，分支渲染）；接口需动态计算 sign（md5∘sha1）；
 * 每源独立维护状态与快照（oid 去重），卡片内点击条目在新窗口打开原文页面
 * （避开 X-Frame-Options / CSP）
 * 卡片右上角「放大」按钮打开宽版弹窗（两列网格），数据与分页状态与卡片共享；
 * 顶部「新闻源设置」弹窗：勾选控制显示/隐藏，拖拽手柄调整卡片顺序，
 * 顺序与勾选整包持久化到 appStorage
 */

/** 卡片级新闻源（设置弹窗里可勾选 / 拖拽排序的粒度） */
type NewsSource = "sina" | "eastmoney" | "ths" | "thepaper" | "cls";

/**
 * 取数通道：有独立分页状态与缓存键的最小单位
 *
 * 与卡片源一一对应，唯一例外是同花顺卡片——它按子视图拆成三条通道
 * （ths-theme 热点主题 / ths-flash 快讯 / ths-headline 头条）
 */
type NewsChannel =
  | "sina"
  | "eastmoney"
  | "thepaper"
  | "ths-theme"
  | "ths-flash"
  | "ths-headline";

/** 源展示名（面板与卡片标题共用） */
const SOURCE_LABELS: Record<NewsSource, string> = {
  sina: "新浪财经",
  eastmoney: "东方财富",
  ths: "同花顺热点主题",
  thepaper: "澎湃新闻",
  cls: "财联社",
};

/** 默认源顺序（首次进入 / 持久化数据缺源时按此补齐） */
const DEFAULT_SOURCE_ORDER: readonly NewsSource[] = [
  "sina",
  "eastmoney",
  "ths",
  "thepaper",
  "cls",
];

// 同花顺卡片的子视图（ThsSubView）与展示名定义在 constants/hot-news.constants.ts，
// 供本页与 HotNewsChannelBar 组件共用

/** 子视图 → 取数通道（同时是缓存键后缀） */
const THS_SUB_VIEW_CHANNEL: Record<ThsSubView, NewsChannel> = {
  theme: "ths-theme",
  flash: "ths-flash",
  headline: "ths-headline",
};

/**
 * 旧版已合并/已废弃的源键（同花顺三卡 → 单卡 ths）
 *
 * 读取持久化数据时命中这些值一律归并到 ths，勾选态取或（任一侧曾启用就算启用），
 * 避免升级后「同花顺热点主题」卡片因为旧键不再识别而凭空消失
 */
const LEGACY_THS_SOURCES: readonly string[] = [
  "ths",
  "ths-headline",
  "ths-theme",
];

/** 持久化数据里可识别的源键全集（含历史键，仅用于读取） */
const RECOGNIZED_SOURCE_VALUES: readonly string[] = [
  ...DEFAULT_SOURCE_ORDER,
  ...LEGACY_THS_SOURCES,
];

/**
 * 历史源键归一化到当前卡片源
 * @param value 持久化里的原始源键
 * @returns 当前版本的卡片源
 */
const normalizeSource = (value: string): NewsSource =>
  LEGACY_THS_SOURCES.includes(value) ? "ths" : (value as NewsSource);

/** 持久化的单源设置条目（label 不落盘，渲染时经 SOURCE_LABELS 查询） */
interface SourceItem {
  value: NewsSource;
  enabled: boolean;
}

/**
 * 从 appStorage 加载源设置（顺序 + 勾选）
 *
 * 兼容三种形态：
 * - 新格式（有序数组）：按存储顺序恢复，缺失的源（版本升级新增）追加末尾默认开启；
 *   旧版同花顺三源按 LEGACY_THS_SOURCES 归并成一条；
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
          (item): item is { value: string; enabled: boolean } =>
            !!item &&
            typeof item === "object" &&
            "value" in item &&
            typeof item.value === "string" &&
            RECOGNIZED_SOURCE_VALUES.includes(item.value) &&
            typeof item.enabled === "boolean",
        );
        // 归并后的顺序取各源首次出现的位次；同花顺三源合并为一条，勾选态取或
        const mergedEnabled = new Map<NewsSource, boolean>();
        const ordered: NewsSource[] = [];
        for (const item of valid) {
          const value = normalizeSource(item.value);
          if (!mergedEnabled.has(value)) {
            ordered.push(value);
            mergedEnabled.set(value, item.enabled);
          } else if (item.enabled) {
            mergedEnabled.set(value, true);
          }
        }
        const restored = ordered.map((value) => ({
          value,
          enabled: mergedEnabled.get(value) ?? true,
        }));
        // 补齐持久化里没有的源（版本升级新增），追加末尾默认开启
        const appended = DEFAULT_SOURCE_ORDER.filter(
          (value) => !mergedEnabled.has(value),
        ).map((value) => ({ value, enabled: true }));
        return [...restored, ...appended];
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
  return DEFAULT_SOURCE_ORDER.map((value) => ({
    value,
    enabled: true,
  }));
};

/** 源设置列表（数组顺序 = 面板行序 = 卡片渲染顺序；持久化到 appStorage） */
const sourceItems = ref<SourceItem[]>(loadSourceItems());

// 迁移结果与持久化原文不一致时立即回写一次：
// deep watch 只在后续变更时触发，若不主动回写，旧版遗留的源键会一直留在存储里
// （读取侧虽已兼容，但存储会与页面实际状态长期不一致）
if (appStorage.getItem(STORAGE_NS_HOT_NEWS_FILTER) !== JSON.stringify(sourceItems.value)) {
  appStorage.setItem(
    STORAGE_NS_HOT_NEWS_FILTER,
    JSON.stringify(sourceItems.value),
  );
}

/** 顺序或勾选变化时整包同步到 appStorage（深监听覆盖 splice 重排与勾选切换） */
watch(
  sourceItems,
  (val) => {
    appStorage.setItem(STORAGE_NS_HOT_NEWS_FILTER, JSON.stringify(val));
  },
  { deep: true },
);

/** 「新闻源设置」弹窗开关（默认收起） */
const sourceModalOpen = ref(false);

const notifications = useNotificationsStore();

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关（设置 → 布局编排 → 右上角工具编排） */
const settingsStore = useSettingsStore();
const agentEntryVisible = computed(() =>
  !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/**
 * 收集当前已加载展示的新闻条目：各通道状态里的条目拍平
 * （含同花顺 / 东财各子视图通道；无标题的占位条目剔除）
 * @returns 新闻条目列表
 */
const collectDisplayedNews = (): HotNewsItem[] =>
  Object.values(states.value).flatMap((state) => state.items).filter((item) => item.title !== '');

/** 「AI 总结」：把当前展示的全部新闻交给 Agent 分析利好 / 利空板块与个股 */
const onAiSummary = (): void => {
  const prompt = buildNewsAnalysisPrompt(collectDisplayedNews());
  if (prompt === '') {
    notifications.push({
      title: '暂无可总结的新闻',
      body: '请等待新闻列表加载完成后再发起 AI 总结',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  void requestAgentAnalysis(prompt);
};

/** 弹窗用的源选项（含展示名；顺序 = 卡片顺序） */
const sourceOptions = computed(() =>
  sourceItems.value.map((item) => ({
    value: item.value,
    label: SOURCE_LABELS[item.value],
    enabled: item.enabled,
  })),
);

/**
 * 应用弹窗提交的草稿：整包替换 sourceItems，
 * 顺序 / 勾选变化由上方 deep watch 落盘、由下方补拉 watch 拉取新启用源
 * @param items 弹窗提交的源设置
 */
const onSourceConfirm = (items: { value: string; enabled: boolean }[]): void => {
  sourceItems.value = items.map(({ value, enabled }) => ({
    value: value as NewsSource,
    enabled,
  }));
};

/** 实际渲染的卡片（按勾选过滤；顺序沿用 sourceItems，与面板行序一致） */
const visibleCards = computed(() =>
  sourceItems.value
    .filter((item) => item.enabled)
    .map((item) => ({ value: item.value, label: SOURCE_LABELS[item.value] })),
);

/** 同花顺卡片当前子视图（热点主题 / 快讯 / 头条） */
const thsSubView = ref<ThsSubView>("theme");

/**
 * 东财卡片当前子视图（快讯 / 推荐 / 热搜 / 领涨概念）
 *
 * 快讯沿用既有 7×24 快讯通道（states.eastmoney）；
 * 其余三个是 so.eastmoney.com 同名模块的单页快照（无翻页），
 * 数据结构与新闻列表不同，各自持有独立状态并在卡片内分支渲染
 */
const emSubView = ref<EmSubView>("flash");

/** 单页快照模块的通用状态（无游标 / 无翻页；东财各模块与澎湃热榜共用） */
interface SnapshotState<T> {
  items: T[];
  loading: boolean;
  error: boolean;
  /** 是否已完成首次加载（切走再切回直接复用） */
  initialized: boolean;
}

const createSnapshotState = <T,>(): SnapshotState<T> => ({
  items: [],
  loading: false,
  error: false,
  initialized: false,
});

/** 东财推荐资讯（映射成通用新闻条目，复用列表渲染） */
const emRecState = ref<SnapshotState<HotNewsItem>>(createSnapshotState());

/** 东财今日热搜（热词榜） */
const emHotState = ref<SnapshotState<EmHotKeyword>>(createSnapshotState());

/** 东财领涨概念（板块行情榜） */
const emConceptState = ref<SnapshotState<EmConceptLeader>>(
  createSnapshotState(),
);

/**
 * 拉取东财单页快照模块的公共骨架（幂等：已初始化或加载中跳过）
 * @param state 目标模块状态
 * @param fetcher 取数函数
 * @param label 日志标签
 * @param force 强制重拉（无视 initialized）
 */
const ensureSnapshot = async <T,>(
  state: SnapshotState<T>,
  fetcher: () => Promise<T[]>,
  label: string,
  force = false,
): Promise<void> => {
  if (state.loading || (state.initialized && !force)) return;
  state.loading = true;
  state.error = false;
  if (force) state.items = [];
  try {
    state.items = await fetcher();
    state.initialized = true;
  } catch (error) {
    state.error = true;
    console.error(`[hot-news] ${label}`, error);
  } finally {
    state.loading = false;
  }
};

/**
 * 就绪东财推荐资讯
 * @param force 强制刷新（无视 initialized 重拉）
 * @returns 完成后 resolve
 */
const ensureEmRec = (force = false): Promise<void> =>
  ensureSnapshot(emRecState.value, () => fetchEmRecommendNews(12), "em-rec", force);

/**
 * 就绪东财今日热搜
 * @param force 强制刷新（无视 initialized 重拉）
 * @returns 完成后 resolve
 */
const ensureEmHot = (force = false): Promise<void> =>
  ensureSnapshot(emHotState.value, () => fetchEmHotKeywords(20), "em-hot", force);

/**
 * 就绪东财领涨概念
 * @param force 强制刷新（无视 initialized 重拉）
 * @returns 完成后 resolve
 */
const ensureEmConcept = (force = false): Promise<void> =>
  ensureSnapshot(emConceptState.value, () => fetchEmLeadingConcepts(10), "em-concept", force);

/**
 * 就绪东财卡片当前子视图（快讯走通用通道，其余走各自快照）
 * @param force 强制刷新（忽略缓存 / initialized）
 */
const ensureEmCardLoaded = (force = false): void => {
  if (emSubView.value === "flash") {
    if (force) {
      void forceRefresh("eastmoney");
    } else if (!states.value.eastmoney.initialized) {
      void loadMore("eastmoney");
    }
    return;
  }
  if (emSubView.value === "rec") void ensureEmRec(force);
  else if (emSubView.value === "hot") void ensureEmHot(force);
  else void ensureEmConcept(force);
};

/**
 * 切换东财卡片的子视图（切过去时按需补拉该子视图数据）
 * @param view 目标子视图值（来自切换控件）
 */
const selectEmSubView = (view: string): void => {
  if (emSubView.value === view) return;
  emSubView.value = view as EmSubView;
  ensureEmCardLoaded();
};

/**
 * 澎湃卡片当前子视图（快讯 / 热榜）
 *
 * 快讯沿用既有财经频道通道（states.thepaper）；
 * 热榜是频道页右侧栏的单页快照（无翻页），名次榜数据结构，卡片内分支渲染
 */
const tpSubView = ref<TpSubView>("flash");

/** 澎湃热榜（名次榜快照） */
const tpHotState = ref<SnapshotState<ThepaperHotItem>>(createSnapshotState());

/**
 * 就绪澎湃热榜
 * @param force 强制刷新（无视 initialized 重拉）
 * @returns 完成后 resolve
 */
const ensureTpHot = (force = false): Promise<void> =>
  ensureSnapshot(tpHotState.value, () => fetchThepaperHotList(20), "tp-hot", force);

/**
 * 就绪澎湃卡片当前子视图（快讯走通用通道，热榜走快照）
 * @param force 强制刷新（忽略缓存 / initialized）
 */
const ensureTpCardLoaded = (force = false): void => {
  if (tpSubView.value === "hot") {
    void ensureTpHot(force);
    return;
  }
  if (force) {
    void forceRefresh("thepaper");
  } else if (!states.value.thepaper.initialized) {
    void loadMore("thepaper");
  }
};

/**
 * 切换澎湃卡片的子视图（切过去时按需补拉该子视图数据）
 * @param view 目标子视图值（来自切换控件）
 */
const selectTpSubView = (view: string): void => {
  if (tpSubView.value === view) return;
  tpSubView.value = view as TpSubView;
  ensureTpCardLoaded();
};

/**
 * 财联社卡片当前子视图（深度 / 热榜）
 *
 * 两者都是站点单页快照（深度页 top_article + depth_list / 热门文章排行榜），
 * 不走通用通道游标体系，各自持有独立快照状态并在卡片内分支渲染
 */
const clsSubView = ref<ClsSubView>("depth");

/** 财联社深度快照（top_article 置顶头条 + depth_list 资讯流，均映射成通用条目） */
const clsDepthState = ref<SnapshotState<HotNewsItem>>(createSnapshotState());

/** 财联社热榜快照（热门文章排行榜，含阅读数） */
const clsHotState = ref<SnapshotState<ClsHotItem>>(createSnapshotState());

/**
 * 就绪财联社深度快照
 * @param force 强制刷新（无视 initialized 重拉）
 * @returns 完成后 resolve
 */
const ensureClsDepth = (force = false): Promise<void> =>
  ensureSnapshot(clsDepthState.value, () => fetchClsDepth().then((s) => [...s.topArticles, ...s.items]), "cls-depth", force);

/**
 * 就绪财联社热榜快照
 * @param force 强制刷新（无视 initialized 重拉）
 * @returns 完成后 resolve
 */
const ensureClsHot = (force = false): Promise<void> =>
  ensureSnapshot(clsHotState.value, () => fetchClsHotList(13), "cls-hot", force);

/**
 * 就绪财联社卡片当前子视图
 * @param force 强制刷新（忽略 initialized）
 */
const ensureClsCardLoaded = (force = false): void => {
  if (clsSubView.value === "hot") void ensureClsHot(force);
  else void ensureClsDepth(force);
};

/**
 * 切换财联社卡片的子视图（切过去时按需补拉该子视图数据）
 * @param view 目标子视图值（来自切换控件）
 */
const selectClsSubView = (view: string): void => {
  if (clsSubView.value === view) return;
  clsSubView.value = view as ClsSubView;
  ensureClsCardLoaded();
};

// ---------- 面板拖拽排序（vue-draggable-plus / SortableJS） ----------
// 模板里用 <VueDraggable v-model="sourceItems"> 直接重排数组；
// 顺序变更由上方 deep watch 落盘，无需手工维护拖拽态与插入下标。

/** 缓存的快照条目（含抓取时间，用于 TTL 判定） */
interface NewsCacheEntry {
  items: HotNewsItem[];
  /** 新浪 / 同花顺：下一页页码；东财 / 澎湃：游标字符串（'' = 首页） */
  cursor: number | string;
  hasMore: boolean;
  fetchedAt: number;
  /** 热点主题通道专用：快照对应选中的主题 id（恢复时联动选中态） */
  themeId?: string;
}

/** 单个通道的加载状态 */
interface SourceState {
  items: HotNewsItem[];
  /** 新浪 / 同花顺：下一页页码；东财 / 澎湃：游标字符串（'' = 首页） */
  cursor: number | string;
  /** 是否还有更多（页码源按满页判定 / 游标源按上游游标判定 / 单页源恒为 false） */
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

/** 走 number 页码游标的通道（其他通道如东财 / 澎湃走字符串游标） */
const NUMBER_CURSOR_SOURCES: readonly NewsChannel[] = [
  "sina",
  "ths-theme",
  "ths-flash",
];

/** 每页条数 */
const PAGE_SIZE = 20;

/** 新闻缓存有效期（毫秒）：期内直接复用快照不请求，过期后清空分页数据重拉 */
const CACHE_TTL_MS = 30 * 60 * 1000;

const dataCache = useDataCacheStore();

/**
 * 缓存是否在有效期内
 * @param fetchedAt 抓取时间戳（毫秒）
 * @returns 是否未过期
 */
const isFresh = (fetchedAt: number): boolean =>
  fetchedAt > 0 && Date.now() - fetchedAt < CACHE_TTL_MS;

/** 同花顺热点主题卡片的主题选择状态（独立于通用 items 分页状态） */
interface ThsThemeCardState {
  themes: ThsHotTheme[];
  /** 当前选中的主题 id（空 = 尚未就绪） */
  selectedId: string;
  /** 主题列表是否加载中 */
  loading: boolean;
  /** 主题列表是否加载失败 */
  error: boolean;
}

const thsThemeState = ref<ThsThemeCardState>({
  themes: [],
  selectedId: "",
  loading: false,
  error: false,
});

/**
 * 拉取热点主题列表（幂等：已有主题或加载中直接返回当前选中 id）
 * @returns 当前选中的主题 id（就绪后非空；失败返回空串）
 */
const ensureThsThemes = async (): Promise<string> => {
  if (thsThemeState.value.themes.length > 0) {
    return thsThemeState.value.selectedId;
  }
  if (thsThemeState.value.loading) return "";
  thsThemeState.value.loading = true;
  thsThemeState.value.error = false;
  try {
    const themes = await fetchThsHotThemes();
    thsThemeState.value.themes = themes;
    if (!thsThemeState.value.selectedId && themes.length > 0) {
      thsThemeState.value.selectedId = themes[0].themeId;
    }
  } catch (error) {
    thsThemeState.value.error = true;
    console.error("[hot-news] ths-theme 主题列表", error);
  } finally {
    thsThemeState.value.loading = false;
  }
  return thsThemeState.value.selectedId;
};

/**
 * 从快照恢复单通道状态：
 * - 快照在 30 分钟有效期内：整包恢复（期内不再发任何请求）；
 * - 快照缺失或已过期：清空之前的分页数据，回到首页重新拉取
 * @param channel 取数通道
 * @returns 通道初始状态
 */
const createSourceState = (channel: NewsChannel): SourceState => {
  const entry = dataCache.get<NewsCacheEntry>(
    DATA_CACHE_KEY.HOT_NEWS_ITEMS + channel,
  );
  if (entry && isFresh(entry.fetchedAt)) {
    // 热点主题通道：联动恢复选中的主题（主题名列表由 ensureThsThemes 另行拉取）
    if (channel === "ths-theme" && entry.themeId) {
      thsThemeState.value.selectedId = entry.themeId;
    }
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
    cursor: NUMBER_CURSOR_SOURCES.includes(channel) ? 1 : "",
    // 单页源（同花顺头条）同样以 hasMore=true 起步——loadMore 入口有
    // `!state.hasMore` 守卫，初始 false 会把首次加载也拦掉；
    // 单页语义由 loadMore 拉完首页后置 hasMore=false 实现
    hasMore: true,
    // 注意：这里不预置 loading=true，否则 loadMore 的进行中判定会自我阻塞；
    // loading 由 loadMore 进入时置位，模板的骨架屏由「loading 且无数据」兜住
    loading: false,
    error: false,
    initialized: false,
    fetchedAt: 0,
  };
};

/** 各通道状态（同花顺卡片的三个子视图各占一条，互不影响） */
const states = ref<Record<NewsChannel, SourceState>>({
  sina: createSourceState("sina"),
  eastmoney: createSourceState("eastmoney"),
  thepaper: createSourceState("thepaper"),
  "ths-theme": createSourceState("ths-theme"),
  "ths-flash": createSourceState("ths-flash"),
  "ths-headline": createSourceState("ths-headline"),
});

/**
 * 把东财单页快照状态适配成通用 SourceState 形态
 * （快照无游标 / 无翻页：hasMore 恒 false，「加载更多」按没有更多处理）
 *
 * ⚠️ items 只用于通用模板的「N 条」badge 与空态判定：
 * - 推荐子视图传真实条目（news 分支直接渲染 card.state.items）；
 * - 热搜 / 领涨概念的正文由各自的分支从 emHotState / emConceptState 渲染，
 *   这里传仅含 oid 的占位条目凑出正确计数（news 分支不会在这两个子视图下渲染）
 * @param snap 快照状态
 * @param count 真实条数（badge 展示用）
 * @param realItems 真实条目（推荐子视图传，其余省略）
 * @returns 通用通道状态
 */
const asSourceState = (
  snap: SnapshotState<unknown>,
  count: number,
  realItems?: HotNewsItem[],
): SourceState => ({
  items:
    realItems ??
    Array.from({ length: count }, (_, index) => ({
      oid: `em-snap-${index}`,
    }) as HotNewsItem),
  cursor: "",
  hasMore: false,
  loading: snap.loading,
  error: snap.error,
  initialized: snap.initialized,
  fetchedAt: 0,
});

/** 东财卡片当前子视图的通用状态（快讯 = 原生通道，其余 = 快照适配） */
const emCardState = computed<SourceState>(() => {
  switch (emSubView.value) {
    case "rec":
      return asSourceState(
        emRecState.value,
        emRecState.value.items.length,
        emRecState.value.items,
      );
    case "hot":
      return asSourceState(emHotState.value, emHotState.value.items.length);
    case "concept":
      return asSourceState(
        emConceptState.value,
        emConceptState.value.items.length,
      );
    default:
      return states.value.eastmoney;
  }
});

/** 卡片正文渲染类型（东财热搜/领涨概念与澎湃/财联社热榜的数据结构不是新闻条目，分支渲染） */
type CardBodyKind = "news" | "hot" | "concept" | "rank" | "clsRank";

/**
 * 卡片正文渲染类型（东财 / 澎湃 / 财联社卡片按当前子视图判定，其余恒为新闻列表）
 * @param card 卡片源
 * @returns 正文渲染类型
 */
const cardBodyKind = (card: NewsSource): CardBodyKind => {
  if (card === "eastmoney") {
    if (emSubView.value === "hot") return "hot";
    if (emSubView.value === "concept") return "concept";
  }
  if (card === "thepaper" && tpSubView.value === "hot") return "rank";
  if (card === "cls" && clsSubView.value === "hot") return "clsRank";
  return "news";
};

/** 澎湃卡片当前子视图的通用状态（快讯 = 原生通道，热榜 = 快照适配） */
const tpCardState = computed<SourceState>(() => {
  if (tpSubView.value === "hot") {
    return asSourceState(tpHotState.value, tpHotState.value.items.length);
  }
  return states.value.thepaper;
});

/** 财联社卡片当前子视图的通用状态（两个子视图均为快照适配，深度带真实条目复用列表渲染） */
const clsCardState = computed<SourceState>(() => {
  if (clsSubView.value === "hot") {
    return asSourceState(clsHotState.value, clsHotState.value.items.length);
  }
  return asSourceState(
    clsDepthState.value,
    clsDepthState.value.items.length,
    clsDepthState.value.items,
  );
});

/**
 * 渲染用卡片视图（同花顺 / 东财 / 澎湃 / 财联社卡片按当前子视图解析出实际状态，其余卡片通道即自身）
 *
 * 财联社两个子视图均为站点快照、不走通用通道游标体系，故 channel 为 null
 * （与 expandedChannel 同一约定），仅卡片自身的 state 参与渲染。
 */
const cardViews = computed(() =>
  visibleCards.value.map((card) => {
    const body = cardBodyKind(card.value);
    if (card.value === "cls") {
      return { ...card, channel: null, state: clsCardState.value, body };
    }
    const channel: NewsChannel =
      card.value === "ths"
        ? THS_SUB_VIEW_CHANNEL[thsSubView.value]
        : card.value;
    const state: SourceState =
      card.value === "eastmoney"
        ? emCardState.value
        : card.value === "thepaper"
          ? tpCardState.value
          : states.value[channel];
    return { ...card, channel, state, body };
  }),
);

/**
 * 拉取并追加指定通道下一页（oid 去重）
 * 分页随滚动 / 点击持续追加；30 分钟缓存仅用于挂载时整包恢复，不阻断翻页
 * @param source 取数通道
 */
const loadMore = async (source: NewsChannel): Promise<void> => {
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
    } else if (source === "thepaper") {
      // 澎湃：startTime 毫秒游标（'' = 首页），hasMore 由 hasNext 决定
      const { items, nextCursor } = await fetchThepaperHotNews(
        state.cursor as string,
        PAGE_SIZE,
      );
      fresh = items;
      state.hasMore = nextCursor !== null;
      state.cursor = nextCursor ?? "";
    } else if (source === "ths-headline") {
      // 同花顺头条：首屏一次拉全（精选 + 资讯流），单页无翻页
      fresh = await fetchThsHeadlineHotNews();
      state.hasMore = false;
    } else if (source === "ths-flash") {
      // 同花顺快讯：页码翻页
      const items = await fetchThsHotNews(state.cursor as number, PAGE_SIZE);
      fresh = items;
      state.hasMore = items.length >= PAGE_SIZE;
      state.cursor = (state.cursor as number) + 1;
    } else {
      // 同花顺热点主题：页码翻页；首次加载先就绪主题列表（默认选中第一个）
      let themeId = thsThemeState.value.selectedId;
      if (!themeId) themeId = await ensureThsThemes();
      if (!themeId) throw new Error("热点主题列表不可用");
      const { items, hasMore } = await fetchThsThemeFeed(
        themeId,
        state.cursor as number,
        PAGE_SIZE,
      );
      fresh = items;
      state.hasMore = hasMore;
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
      // 热点主题通道记录选中主题，恢复快照时联动选中态
      ...(source === "ths-theme"
        ? { themeId: thsThemeState.value.selectedId }
        : {}),
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
 * 强制清空指定通道缓存并重新拉取（无视 30 分钟 TTL）
 * @param source 取数通道
 */
const forceRefresh = async (source: NewsChannel): Promise<void> => {
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

/**
 * 就绪某卡片的当前通道首屏（幂等：已初始化或加载中不会重复请求）
 * - 同花顺卡片：只拉当前子视图（其余子视图在切换时再拉），并顺带就绪主题名列表；
 * - 其余卡片：通道即卡片自身
 * @param source 卡片源
 */
const ensureCardLoaded = (source: NewsSource): void => {
  if (source === "ths") {
    const channel = THS_SUB_VIEW_CHANNEL[thsSubView.value];
    if (!states.value[channel].initialized) void loadMore(channel);
    void ensureThsThemes();
    return;
  }
  // 东财卡片按当前子视图分发（快讯走通用通道，其余走各自快照模块）
  if (source === "eastmoney") {
    ensureEmCardLoaded();
    return;
  }
  // 澎湃卡片同理（快讯走通用通道，热榜走快照）
  if (source === "thepaper") {
    ensureTpCardLoaded();
    return;
  }
  // 财联社卡片两个子视图均为快照模块
  if (source === "cls") {
    ensureClsCardLoaded();
    return;
  }
  if (!states.value[source].initialized) void loadMore(source);
};

// 首屏：仅并发拉取**已勾选**的源（未勾选的源不请求，避免为不显示的卡片白打上游）
onMounted(() => {
  for (const { value, enabled } of sourceItems.value) {
    if (enabled) ensureCardLoaded(value);
  }
});

/**
 * 勾选新启用的源时补拉首屏
 *
 * 首屏只拉已勾选的源，若不在这里补拉，用户临时勾选一个源后卡片会一直停在
 * 「暂无热点新闻」（空列表不产生滚动事件，触底加载无从触发）
 */
watch(
  sourceItems,
  (items) => {
    for (const { value, enabled } of items) {
      if (enabled) ensureCardLoaded(value);
    }
  },
  { deep: true },
);

// ---------- 卡片放大弹窗（卡片仅 375px 宽，宽版弹窗便于读长内容） ----------
// 复用卡片当前通道的数据与分页状态（不另开请求），弹窗内切换子视图 / 主题同样作用于卡片

/** 放大弹窗开关 */
const expandedOpen = ref(false);

/** 放大弹窗展示的卡片（关闭后保留旧值，避免淡出动画期间正文先消失） */
const expandedCard = ref<NewsSource>("sina");

/** 放大弹窗当前取数通道（同花顺卡片跟随卡片当前子视图；财联社两个子视图均为快照，无通道返 null） */
const expandedChannel = computed<NewsChannel | null>(() => {
  if (expandedCard.value === "cls") return null;
  if (expandedCard.value === "ths") {
    return THS_SUB_VIEW_CHANNEL[thsSubView.value];
  }
  return expandedCard.value;
});

/** 放大弹窗对应的通道状态（东财 / 澎湃 / 财联社卡片跟随其当前子视图的适配状态） */
const expandedState = computed<SourceState>(() => {
  if (expandedCard.value === "eastmoney") return emCardState.value;
  if (expandedCard.value === "thepaper") return tpCardState.value;
  if (expandedCard.value === "cls") return clsCardState.value;
  const channel = expandedChannel.value;
  return channel ? states.value[channel] : states.value.sina;
});

/** 放大弹窗正文渲染类型（与卡片一致） */
const expandedBody = computed<CardBodyKind>(() => cardBodyKind(expandedCard.value));

/** 放大弹窗标题（同花顺 / 东财 / 澎湃 / 财联社卡片带上当前子视图名，便于分辨放大的是哪一路内容） */
const expandedTitle = computed(() => {
  const label = SOURCE_LABELS[expandedCard.value];
  if (expandedCard.value === "ths") {
    return `${label} · ${THS_SUB_VIEW_LABELS[thsSubView.value]}`;
  }
  if (expandedCard.value === "eastmoney") {
    return `${label} · ${EM_SUB_VIEW_LABELS[emSubView.value]}`;
  }
  if (expandedCard.value === "thepaper") {
    return `${label} · ${TP_SUB_VIEW_LABELS[tpSubView.value]}`;
  }
  if (expandedCard.value === "cls") {
    return `${label} · ${CLS_SUB_VIEW_LABELS[clsSubView.value]}`;
  }
  return label;
});

/**
 * 打开某卡片的放大弹窗（顺带补齐该卡片当前通道首屏，避免放大后是空列表）
 * @param card 卡片源
 */
const openExpanded = (card: NewsSource): void => {
  expandedCard.value = card;
  expandedOpen.value = true;
  ensureCardLoaded(card);
};

/** 放大弹窗：加载更多（快照子视图 hasMore 恒 false，按钮自然禁用） */
const loadMoreExpanded = (): void => {
  const channel = expandedChannel.value;
  if (channel) void loadMore(channel);
};

/** 放大弹窗：强制刷新（东财 / 澎湃 / 财联社卡片按子视图重拉对应模块，其余按通道重拉） */
const forceRefreshExpanded = (): void => {
  if (expandedCard.value === "eastmoney") {
    ensureEmCardLoaded(true);
    return;
  }
  if (expandedCard.value === "thepaper") {
    ensureTpCardLoaded(true);
    return;
  }
  if (expandedCard.value === "cls") {
    ensureClsCardLoaded(true);
    return;
  }
  const channel = expandedChannel.value;
  if (channel) void forceRefresh(channel);
};

/**
 * 卡片 footer 的强制刷新（东财 / 澎湃 / 财联社卡片按子视图重拉对应模块，其余按通道重拉）
 * @param card 卡片源
 */
const refreshCard = (card: NewsSource): void => {
  if (card === "eastmoney") {
    ensureEmCardLoaded(true);
    return;
  }
  if (card === "thepaper") {
    ensureTpCardLoaded(true);
    return;
  }
  if (card === "cls") {
    ensureClsCardLoaded(true);
    return;
  }
  const channel: NewsChannel =
    card === "ths" ? THS_SUB_VIEW_CHANNEL[thsSubView.value] : card;
  void forceRefresh(channel);
};

/**
 * 切换同花顺卡片的子视图（切过去时按需补拉该通道首屏）
 * @param view 目标子视图值（来自切换控件，泛化后为 string）
 */
const selectThsSubView = (view: string): void => {
  if (thsSubView.value === view) return;
  thsSubView.value = view as ThsSubView;
  ensureCardLoaded("ths");
};

/**
 * 切换热点主题：重置该通道分页状态并重新拉取首页
 * @param themeId 目标主题 id
 */
const selectThsTheme = async (themeId: string): Promise<void> => {
  if (thsThemeState.value.selectedId === themeId) return;
  thsThemeState.value.selectedId = themeId;
  states.value["ths-theme"] = {
    items: [],
    cursor: 1,
    hasMore: true,
    loading: false,
    error: false,
    initialized: false,
    fetchedAt: 0,
  };
  dataCache.set(DATA_CACHE_KEY.HOT_NEWS_ITEMS + "ths-theme", null);
  await loadMore("ths-theme");
};

/**
 * 卡片内列表触底（距底 < 60px）时自动加载下一页
 * @param source 取数通道（财联社等纯快照卡片传 null，无通用通道 → 直接忽略）
 * @param event 滚动事件
 */
const onListScroll = (source: NewsChannel | null, event: Event): void => {
  if (!source) return;
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

/**
 * 卡片 footer「加载更多」（财联社等纯快照卡片传 null → 直接忽略，按钮此时也已禁用）
 * @param source 取数通道
 */
const loadMoreFromCard = (source: NewsChannel | null): void => {
  if (source) void loadMore(source);
};

/** 各新闻源站点 logo（public/news-logos/，本地资源离线可用） */
const SOURCE_LOGOS: Record<NewsSource, string> = {
  sina: "/news-logos/sina.ico",
  eastmoney: "/news-logos/eastmoney.ico",
  ths: "/news-logos/10jqka.ico",
  thepaper: "/news-logos/thepaper.ico",
  cls: "/news-logos/cls.ico",
};

/** 新闻原文窗口尺寸（居中弹出） */
const NEWS_WINDOW_WIDTH = 1024;
const NEWS_WINDOW_HEIGHT = 768;

/**
 * 打开新闻原文：
 * - Tauri：新建独立 WebviewWindow 加载原文页（应用内 webview 容器），
 *   远程页面无 IPC 权限（capabilities 仅对 main 授予核心权限，
 *   news-* 窗口只保留原生关闭能力）；创建失败时回退系统默认浏览器；
 * - 浏览器：新开 900 x 300 小窗直接导航原文页——不使用 iframe，
 *   规避新闻站点的 X-Frame-Options / CSP 反框架限制（iframe 方案会白屏）
 * @param url 新闻原文链接
 */
const openInNewWindow = async (url: string): Promise<void> => {
  if (isTauri()) {
    try {
      // label 全局唯一且不能复用已销毁窗口的 label，用时间戳避免冲突
      const label = `news-${Date.now()}`;
      const win = new WebviewWindow(label, {
        url,
        title: "新闻",
        width: NEWS_WINDOW_WIDTH,
        height: NEWS_WINDOW_HEIGHT,
        center: true,
      });
      // 创建失败（权限缺失 / label 冲突等）时回退系统浏览器
      win.once("tauri://error", (event) => {
        console.error("[hot-news] webview window", event);
        void openUrl(url);
      });
      return;
    } catch (error) {
      console.error("[hot-news] webview window", error);
      try {
        await openUrl(url);
      } catch (openError) {
        console.error("[hot-news] opener", openError);
      }
      return;
    }
  }
  // 浏览器：3:1 小窗（900 x 300）居中弹出
  const BROWSER_WINDOW_WIDTH = 900;
  const BROWSER_WINDOW_HEIGHT = Math.round(BROWSER_WINDOW_WIDTH / 3);
  const left = Math.max(
    0,
    Math.round((window.screen.availWidth - BROWSER_WINDOW_WIDTH) / 2),
  );
  const top = Math.max(
    0,
    Math.round((window.screen.availHeight - BROWSER_WINDOW_HEIGHT) / 2),
  );
  const features =
    `width=${BROWSER_WINDOW_WIDTH},height=${BROWSER_WINDOW_HEIGHT},left=${left},top=${top},` +
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
 * 阅读数展示（财联社热榜）
 * @param readNum 阅读数
 * @returns 「311508」或「311.5万」形态的紧凑文本
 */
const formatReadNum = (readNum: number): string => {
  if (readNum >= 10000) {
    const w = readNum / 10000;
    return `${w >= 100 ? Math.round(w) : w.toFixed(1)}万`;
  }
  return String(readNum);
};

/**
 * 加载更多按钮文案（按状态切换）
 * @param state 单通道状态
 * @returns 按钮文字
 */
const loadMoreLabel = (state: SourceState): string => {
  if (state.loading) return "加载中...";
  if (!state.hasMore) return "没有更多了";
  return "加载更多";
};
</script>

<template>
  <!-- 单根容器：MainLayout 通过 :class="pageAnim" 下发页面进入动画类名，
         而多根组件无法继承 attrs（会丢动画并刷 Vue warn），故统一包一层 -->
  <div>
    <!-- 「新闻源设置」工具条：按钮打开弹窗（勾选 / 拖拽排序都在弹窗内，草稿模式） -->
    <div class="flex shrink-0 items-center justify-between border-b border-flat-weak px-4 py-2">
      <span class="text-xs text-text-tertiary">
        已启用 {{ visibleCards.length }} / {{ sourceItems.length }} 个新闻源
      </span>
      <div class="flex items-center gap-2">
        <BaseButton v-if="agentEntryVisible" variant="ghost" @click="onAiSummary">
          <MenuIcon name="agent" :size="14" />
          AI 分析
        </BaseButton>
        <BaseButton variant="ghost" @click="sourceModalOpen = true">
          <MenuIcon name="settings" :size="14" />
          新闻源设置
        </BaseButton>
      </div>
    </div>

    <!-- 新闻源设置弹窗（草稿模式：确认才生效） -->
    <HotNewsSourceModal
      v-model:open="sourceModalOpen"
      :items="sourceOptions"
      @confirm="onSourceConfirm"
    />

    <!-- 卡片放大弹窗：宽版两列布局，复用该卡片当前通道的数据与分页（不另开请求） -->
    <BaseModal
      v-model:open="expandedOpen"
      :title="expandedTitle"
      max-width-class="max-w-5xl"
      height-class="h-[70dvh]"
    >
      <!-- 同花顺 / 东财 / 澎湃 / 财联社卡片：放大后同样能切子视图（状态与卡片共享）；
           放在固定筛选栏里（其余卡片不传该插槽，避免渲染空条），滚正文时保持可见 -->
      <template
        v-if="
          expandedCard === 'ths' ||
            expandedCard === 'eastmoney' ||
            expandedCard === 'thepaper' ||
            expandedCard === 'cls'
        "
        #filters
      >
        <HotNewsChannelBar
          v-if="expandedCard === 'ths'"
          :views="THS_SUB_VIEW_OPTIONS"
          :active="thsSubView"
          :themes="thsThemeState.themes"
          :selected-theme-id="thsThemeState.selectedId"
          :themes-loading="thsThemeState.loading"
          :themes-error="thsThemeState.error"
          roomy
          @select-view="selectThsSubView"
          @select-theme="selectThsTheme"
          @retry-themes="ensureThsThemes()"
        />
        <HotNewsChannelBar
          v-else-if="expandedCard === 'eastmoney'"
          :views="EM_SUB_VIEW_OPTIONS"
          :active="emSubView"
          roomy
          @select-view="selectEmSubView"
        />
        <HotNewsChannelBar
          v-else-if="expandedCard === 'thepaper'"
          :views="TP_SUB_VIEW_OPTIONS"
          :active="tpSubView"
          roomy
          @select-view="selectTpSubView"
        />
        <HotNewsChannelBar
          v-else
          :views="CLS_SUB_VIEW_OPTIONS"
          :active="clsSubView"
          roomy
          @select-view="selectClsSubView"
        />
      </template>

      <div class="flex flex-col gap-3">
        <div
          v-if="expandedState.loading && !expandedState.initialized"
          class="py-6"
        >
          <BaseSkeleton />
        </div>
        <div
          v-else-if="expandedState.error && !expandedState.initialized"
          class="py-10"
        >
          <BaseEmpty text="热点新闻加载失败，请稍后重试" />
        </div>
        <!-- 东财热搜：热词双列榜（编号 + 词 + 「新」徽标） -->
        <ul
          v-else-if="expandedBody === 'hot'"
          class="grid gap-x-6 gap-y-1 md:grid-cols-2"
        >
          <li v-for="(kw, index) in emHotState.items" :key="kw.phrase">
            <button
              type="button"
              class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-flat-weak/50"
              @click="openInNewWindow(kw.url)"
            >
              <span class="w-5 shrink-0 text-center text-xs font-semibold text-text-tertiary">
                {{ index + 1 }}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm text-text">
                {{ kw.phrase }}
              </span>
              <span
                v-if="kw.isNew"
                class="shrink-0 rounded px-1 py-px text-[10px] font-medium text-up"
              >
                新
              </span>
            </button>
          </li>
        </ul>
        <!-- 东财领涨概念：板块行情榜（序号 + 名称 + 涨跌幅 + 领涨股） -->
        <ul
          v-else-if="expandedBody === 'concept'"
          class="grid gap-x-6 gap-y-1 md:grid-cols-2"
        >
          <li v-for="(concept, index) in emConceptState.items" :key="concept.code">
            <button
              type="button"
              class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-flat-weak/50"
              @click="
                openInNewWindow(
                  `https://so.eastmoney.com/web/s?keyword=${concept.name}`,
                )
              "
            >
              <span
                class="h-[18px] w-[18px] shrink-0 rounded-full text-center text-[10px] leading-[18px] font-semibold"
                :class="index < 3 ? 'bg-up text-white' : 'bg-flat-weak text-text-tertiary'"
              >
                {{ index + 1 }}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm text-text">
                {{ concept.name }}
              </span>
              <span
                class="shrink-0 text-sm font-medium"
                :class="concept.chgPct >= 0 ? 'text-up' : 'text-down'"
              >
                {{ concept.chgPct.toFixed(2) }}%
              </span>
              <span class="w-20 shrink-0 truncate text-right text-xs text-text-tertiary">
                {{ concept.leaderStock }}
              </span>
            </button>
          </li>
        </ul>
        <!-- 澎湃热榜：名次榜（名次圆标 + 标题 + 发布时间文本） -->
        <ul v-else-if="expandedBody === 'rank'" class="flex flex-col gap-1">
          <li v-for="(hp, index) in tpHotState.items" :key="hp.contId">
            <button
              type="button"
              class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-flat-weak/50"
              @click="openInNewWindow(hp.url)"
            >
              <span
                class="h-[18px] w-[18px] shrink-0 rounded-full text-center text-[10px] leading-[18px] font-semibold"
                :class="index < 3 ? 'bg-up text-white' : 'bg-flat-weak text-text-tertiary'"
              >
                {{ index + 1 }}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm text-text">
                {{ hp.title }}
              </span>
              <span
                v-if="hp.timeText"
                class="shrink-0 text-xs text-text-tertiary"
              >
                {{ hp.timeText }}
              </span>
            </button>
          </li>
        </ul>
        <!-- 财联社热榜：热门文章排行榜（名次圆标 + 标题 + 阅读数） -->
        <ul v-else-if="expandedBody === 'clsRank'" class="flex flex-col gap-1">
          <li v-for="(hp, index) in clsHotState.items" :key="hp.id">
            <button
              type="button"
              class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-flat-weak/50"
              @click="openInNewWindow(hp.url)"
            >
              <span
                class="h-[18px] w-[18px] shrink-0 rounded-full text-center text-[10px] leading-[18px] font-semibold"
                :class="index < 3 ? 'bg-up text-white' : 'bg-flat-weak text-text-tertiary'"
              >
                {{ index + 1 }}
              </span>
              <span class="min-w-0 flex-1 truncate text-sm text-text">
                {{ hp.title }}
              </span>
              <span class="shrink-0 text-xs text-text-tertiary">
                {{ formatReadNum(hp.readNum) }}阅读
              </span>
            </button>
          </li>
        </ul>
        <ul v-else-if="expandedState.items.length > 0" class="grid gap-2 md:grid-cols-2">
          <li v-for="item in expandedState.items" :key="item.oid" class="flex">
            <button
              type="button"
              class="pressable flex w-full flex-col rounded-lg border border-flat-weak bg-surface p-3 text-left hover:border-primary/50"
              @click="openInNewWindow(item.url)"
            >
              <p class="line-clamp-2 text-sm font-medium text-text">
                {{ item.title }}
              </p>
              <p
                v-if="item.summary"
                class="mt-1.5 line-clamp-3 text-xs leading-relaxed text-text-tertiary"
              >
                {{ item.summary }}
              </p>
              <p
                class="mt-auto flex items-center gap-2 pt-2 text-xs text-text-tertiary"
              >
                <span>{{ item.media }}</span>
                <span v-if="formatTime(item.ctime)">{{
                  formatTime(item.ctime)
                }}</span>
              </p>
            </button>
          </li>
        </ul>
        <BaseEmpty v-else text="暂无热点新闻" />
      </div>

      <template #footer>
        <span class="mr-auto text-xs text-text-tertiary">
          已加载 {{ expandedState.items.length }} 条
        </span>
        <BaseButton
          variant="ghost"
          :disabled="expandedState.loading || !expandedState.hasMore"
          @click="loadMoreExpanded"
        >
          {{ loadMoreLabel(expandedState) }}
        </BaseButton>
        <BaseButton
          variant="ghost"
          :disabled="expandedState.loading"
          @click="forceRefreshExpanded"
        >
          强制刷新
        </BaseButton>
      </template>
    </BaseModal>

    <!-- 横向卡片流：每源一张 375px 卡片，超出页面横向滚动 -->
    <!-- 高度用 100dvh - 7rem：扣除 MainLayout 头部 h-14(56px) + main 内部 div 的 p-6 上下(48px) + buffer -->
    <div class="flex h-[calc(100dvh-9rem)] min-h-0 gap-4 overflow-x-auto p-4">
      <BaseCard
        v-for="card in cardViews"
        :key="card.value"
        class="!flex !h-full !w-[375px] !shrink-0 !flex-col !overflow-hidden !p-0"
      >
        <!-- 卡片 header：源名称 + 当前条数 + 放大按钮 -->
        <header
          class="flex shrink-0 items-center justify-between gap-2 border-b border-flat-weak px-4 py-3"
        >
          <h2 class="flex items-center gap-2 text-sm font-semibold text-text">
            <img
              :src="SOURCE_LOGOS[card.value]"
              alt=""
              class="h-5 w-5 rounded"
              loading="lazy"
            />
            {{ card.label }}
          </h2>
          <div class="flex shrink-0 items-center gap-1">
            <span class="text-xs text-text-tertiary">
              {{ card.state.items.length }} 条
            </span>
            <!-- 放大：卡片宽 375px，弹窗内用宽版布局读更多内容 -->
            <button
              type="button"
              class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
              :aria-label="`放大查看${card.label}`"
              :title="`放大查看${card.label}`"
              @click="openExpanded(card.value)"
            >
              <MenuIcon name="expand" :size="14" />
            </button>
          </div>
        </header>

        <!-- 同花顺卡片：通道切换控件（子视图 热点主题/快讯/头条 + 主题 chips） -->
        <div
          v-if="card.value === 'ths'"
          class="shrink-0 border-b border-flat-weak px-3 py-2"
        >
          <HotNewsChannelBar
            :views="THS_SUB_VIEW_OPTIONS"
            :active="thsSubView"
            :themes="thsThemeState.themes"
            :selected-theme-id="thsThemeState.selectedId"
            :themes-loading="thsThemeState.loading"
            :themes-error="thsThemeState.error"
            @select-view="selectThsSubView"
            @select-theme="selectThsTheme"
            @retry-themes="ensureThsThemes()"
          />
        </div>

        <!-- 东财卡片：子视图切换控件（快讯/推荐/热搜/领涨概念） -->
        <div
          v-if="card.value === 'eastmoney'"
          class="shrink-0 border-b border-flat-weak px-3 py-2"
        >
          <HotNewsChannelBar
            :views="EM_SUB_VIEW_OPTIONS"
            :active="emSubView"
            @select-view="selectEmSubView"
          />
        </div>

        <!-- 澎湃卡片：子视图切换控件（快讯/热榜） -->
        <div
          v-if="card.value === 'thepaper'"
          class="shrink-0 border-b border-flat-weak px-3 py-2"
        >
          <HotNewsChannelBar
            :views="TP_SUB_VIEW_OPTIONS"
            :active="tpSubView"
            @select-view="selectTpSubView"
          />
        </div>

        <!-- 财联社卡片：子视图切换控件（深度/热榜） -->
        <div
          v-if="card.value === 'cls'"
          class="shrink-0 border-b border-flat-weak px-3 py-2"
        >
          <HotNewsChannelBar
            :views="CLS_SUB_VIEW_OPTIONS"
            :active="clsSubView"
            @select-view="selectClsSubView"
          />
        </div>

        <!-- 卡片 body：列表（占满剩余高度，内部滚动） -->
        <div
          class="flex-1 overflow-y-auto"
          @scroll.passive="onListScroll(card.channel, $event)"
        >
          <div
            v-if="card.state.loading && !card.state.initialized"
            class="p-4"
          >
            <BaseSkeleton />
          </div>
          <div
            v-else-if="card.state.error && !card.state.initialized"
            class="py-10"
          >
            <BaseEmpty text="热点新闻加载失败，请稍后重试" />
          </div>
          <!-- 东财热搜：热词双列榜（编号 + 词 + 「新」徽标） -->
          <ul
            v-else-if="card.value === 'eastmoney' && card.body === 'hot'"
            class="grid gap-x-4 gap-y-0.5 p-3"
          >
            <li v-for="(kw, index) in emHotState.items" :key="kw.phrase">
              <button
                type="button"
                class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left odd:bg-flat-weak/30"
                @click="openInNewWindow(kw.url)"
              >
                <span
                  class="w-5 shrink-0 text-center text-xs font-semibold"
                  :class="index < 3 ? 'text-up' : 'text-text-tertiary'"
                >
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-text">
                  {{ kw.phrase }}
                </span>
                <span
                  v-if="kw.isNew"
                  class="shrink-0 rounded bg-up-weak px-1 py-px text-[10px] font-medium text-up"
                >
                  新
                </span>
              </button>
            </li>
          </ul>
          <!-- 东财领涨概念：板块行情榜（序号 + 名称 + 涨跌幅 + 领涨股） -->
          <ul
            v-else-if="card.value === 'eastmoney' && card.body === 'concept'"
            class="p-3"
          >
            <li
              v-for="(concept, index) in emConceptState.items"
              :key="concept.code"
              class="odd:bg-flat-weak/30"
            >
              <button
                type="button"
                class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                @click="
                  openInNewWindow(
                    `https://so.eastmoney.com/web/s?keyword=${concept.name}`,
                  )
                "
              >
                <span
                  class="h-[18px] w-[18px] shrink-0 rounded-full text-center text-[10px] leading-[18px] font-semibold"
                  :class="
                    index < 3 ? 'bg-up text-white' : 'bg-flat-weak text-text-tertiary'
                  "
                >
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-text">
                  {{ concept.name }}
                </span>
                <span
                  class="shrink-0 text-sm font-medium"
                  :class="concept.chgPct >= 0 ? 'text-up' : 'text-down'"
                >
                  {{ concept.chgPct.toFixed(2) }}%
                </span>
                <span
                  class="w-16 shrink-0 truncate text-right text-xs text-text-tertiary"
                >
                  {{ concept.leaderStock }}
                </span>
              </button>
            </li>
          </ul>
          <!-- 澎湃热榜：名次榜（名次圆标 + 标题 + 发布时间文本） -->
          <ul
            v-else-if="card.value === 'thepaper' && card.body === 'rank'"
            class="flex flex-col p-2"
          >
            <li
              v-for="(hp, index) in tpHotState.items"
              :key="hp.contId"
              class="odd:bg-flat-weak/30"
            >
              <button
                type="button"
                class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                @click="openInNewWindow(hp.url)"
              >
                <span
                  class="h-[18px] w-[18px] shrink-0 rounded-full text-center text-[10px] leading-[18px] font-semibold"
                  :class="
                    index < 3 ? 'bg-up text-white' : 'bg-flat-weak text-text-tertiary'
                  "
                >
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-text">
                  {{ hp.title }}
                </span>
                <span
                  v-if="hp.timeText"
                  class="shrink-0 text-xs text-text-tertiary"
                >
                  {{ hp.timeText }}
                </span>
              </button>
            </li>
          </ul>
          <!-- 财联社热榜：热门文章排行榜（名次圆标 + 标题 + 阅读数） -->
          <ul
            v-else-if="card.value === 'cls' && card.body === 'clsRank'"
            class="flex flex-col p-2"
          >
            <li
              v-for="(hp, index) in clsHotState.items"
              :key="hp.id"
              class="odd:bg-flat-weak/30"
            >
              <button
                type="button"
                class="pressable flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left"
                @click="openInNewWindow(hp.url)"
              >
                <span
                  class="h-[18px] w-[18px] shrink-0 rounded-full text-center text-[10px] leading-[18px] font-semibold"
                  :class="
                    index < 3 ? 'bg-up text-white' : 'bg-flat-weak text-text-tertiary'
                  "
                >
                  {{ index + 1 }}
                </span>
                <span class="min-w-0 flex-1 truncate text-sm text-text">
                  {{ hp.title }}
                </span>
                <span class="shrink-0 text-xs text-text-tertiary">
                  {{ formatReadNum(hp.readNum) }}阅读
                </span>
              </button>
            </li>
          </ul>
          <ul v-else-if="card.state.items.length > 0" class="divide-y divide-flat-weak">
            <li
              v-for="item in card.state.items"
              :key="item.oid"
              class="odd:bg-flat-weak/30"
            >
              <button
                type="button"
                class="pressable block w-full px-4 py-3 text-left active:scale-[0.99]"
                @click="openInNewWindow(item.url)"
              >
                <p class="text-sm font-medium text-text">{{ item.title }}</p>
                <p
                  v-if="item.summary"
                  class="mt-1 line-clamp-2 text-xs text-text-tertiary"
                >
                  {{ item.summary }}
                </p>
                <p
                  class="mt-1.5 flex items-center gap-2 text-xs text-text-tertiary"
                >
                  <span>{{ item.media }}</span>
                  <span v-if="formatTime(item.ctime)">{{
                    formatTime(item.ctime)
                  }}</span>
                </p>
              </button>
            </li>
          </ul>
          <BaseEmpty v-else text="暂无热点新闻" />
        </div>

        <!-- 卡片 footer：加载更多 / 强制刷新 / 缓存提示 -->
        <div
          v-if="card.state.items.length > 0"
          class="flex shrink-0 flex-col items-center gap-1 border-t border-flat-weak px-4 py-3"
        >
          <div class="flex items-center gap-2">
            <BaseButton
              variant="ghost"
              :disabled="card.state.loading || !card.state.hasMore"
              @click="loadMoreFromCard(card.channel)"
            >
              {{ loadMoreLabel(card.state) }}
            </BaseButton>
            <BaseButton
              variant="ghost"
              :disabled="card.state.loading"
              @click="refreshCard(card.value)"
            >
              强制刷新
            </BaseButton>
          </div>
          <!-- 加载中状态：旋转圈 + 文案 -->
          <div
            v-if="card.state.loading && card.state.items.length > 0"
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
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { showFailToast } from 'vant';
import { VueDraggable } from 'vue-draggable-plus';
import { useRouter } from 'vue-router';
import { fetchHotBoard } from '../../common/api/hot-board.api.ts';
import type { HotBoardItem } from '../../common/types/hot-board.types.ts';
import {
  BOARD_GROUPS,
  BOARD_SOURCE_LABELS,
  BOARD_SOURCE_LOGOS,
  BOARD_SOURCE_ORDER,
} from '../../common/constants/hot-board.constants.ts';
import type { BoardSource } from '../../common/constants/hot-board.constants.ts';
import { STORAGE_NS_MOBILE_BOARD_SETTINGS } from '../../common/constants/storage-key.constants.ts';
import { MOBILE_CACHE_TTL_MS } from '../constants';
import { mobileCacheGet, mobileCacheGetStale, mobileCacheSet } from '../cache';
import { appStorage } from '../../common/utils/app-local-storage';
import { useMobilePolling } from '../composables/use-mobile-polling';
import {
  formatPct,
  formatRankChange,
  formatSnapshotTime,
  isTopRank,
  pctClass,
  rankChangeClass,
} from '../utils/format';

/**
 * 今天炒什么（移动端）
 *
 * 平台切换在 navbar 标题两侧的箭头 icon（◀ logo 今天炒什么 ▶，点击循环切换可见平台）；
 * 各平台的分组子分类升为 Vant Tabs（原平台 tabs 的位置），一次只渲染当前平台；
 * 榜单页状态按「平台 × 分组」独立持久化缓存（30 分钟 TTL）；
 * 榜单行点击进个股详情页 /stock/:symbol（与搜索页 / 市场榜单行同口径）；
 * ⚙ 平台设置弹层：开关显隐 + 上下移排序（拖拽排序为后续迭代），设置持久化
 */

/** 平台设置持久化形态（order 全量序 / hidden 隐藏集合） */
interface MobileBoardSettings {
  order: BoardSource[];
  hidden: BoardSource[];
}

/** 平台分组页运行期状态 */
interface BoardPageState {
  items: HotBoardItem[];
  loading: boolean;
  refreshing: boolean;
  error: boolean;
  fetchedAt: number | null;
  initialized: boolean;
}

const BOARD_PAGE_DEFAULT = (): BoardPageState => ({
  items: [],
  loading: false,
  refreshing: false,
  error: false,
  fetchedAt: null,
  initialized: false,
});

const router = useRouter();

/** 榜单行点击进个股详情页
 * @param symbol 完整符号（如 sh600519，热股榜数据已归一） */
const goStock = (symbol: string): void => {
  if (symbol) void router.push(`/stock/${symbol}`);
};

const readBoardSettings = (): MobileBoardSettings => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_BOARD_SETTINGS);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<MobileBoardSettings>;
      if (Array.isArray(parsed.order) && Array.isArray(parsed.hidden)) {
        return { order: parsed.order, hidden: parsed.hidden };
      }
    } catch {
      // 坏包回落默认
    }
  }
  return { order: [...BOARD_SOURCE_ORDER], hidden: [] };
};

const buildCacheKey = (source: BoardSource, group: string): string => `board:${source}:${group}`;

const settings = reactive<MobileBoardSettings>(readBoardSettings());
const persistSettings = (): void => {
  appStorage.setItem(
    STORAGE_NS_MOBILE_BOARD_SETTINGS,
    JSON.stringify({ order: settings.order, hidden: settings.hidden }),
  );
};

/** 平台可见序（隐藏平台不参与 navbar 箭头切换；顺序 = 平台设置调整后的持久化序） */
const visibleSources = computed<BoardSource[]>(() =>
  settings.order.filter((key) => !settings.hidden.includes(key)),
);

const activeIndex = ref(0);
/** 当前平台的分组 tab 序（分组子分类升为 tabs 后的 v-model） */
const activeGroupIndex = ref(0);
const settingsOpen = ref(false);

/** 安全取当前平台（设置变更后 activeIndex 越界时回落第一个可见平台） */
const activeSource = computed<BoardSource>(() => {
  const list = visibleSources.value;
  return list[Math.min(activeIndex.value, list.length - 1)] ?? settings.order[0]!;
});

const activeKey = computed(() => {
  const source = activeSource.value;
  return `${source}:${groupOf(source)}`;
});

const activeFetchedAt = computed<number | null>(() => pages[activeKey.value]?.fetchedAt ?? null);

/** 每平台当前分组（默认各平台第一组；会话内记忆） */
const groupBySource = reactive<Record<string, string>>(
  Object.fromEntries(
    BOARD_SOURCE_ORDER.map((source) => [source, BOARD_GROUPS[source][0]!.value]),
  ),
);

const pages = reactive<Record<string, BoardPageState>>({});

/**
 * 模板取状态（reactive 记录自动补默认值）；分组 tab 面板各取各的分组数据，
 * 避免横滑过渡期间面板串用当前记忆分组的数据
 * @param source 平台 key
 * @param group 分组 key
 * @returns 该「平台 × 分组」的状态
 */
const pageOfGroup = (source: BoardSource, group: string): BoardPageState => {
  const key = buildCacheKey(source, group);
  return (pages[key] ??= BOARD_PAGE_DEFAULT());
};

/**
 * 平台当前选中的分组 key
 * @param source 平台 key
 * @returns 分组 key
 */
const groupOf = (source: BoardSource): string => groupBySource[source]!;

/**
 * 平台可切换的分组清单
 * @param source 平台 key
 * @returns 分组选项（命名与桌面一致）
 */
const groupsOf = (source: BoardSource) => BOARD_GROUPS[source];

/**
 * 平台 logo 字（取展示名首字）
 * @param source 平台 key
 * @returns 展示名首字
 */
const logoOf = (source: BoardSource): string => BOARD_SOURCE_LABELS[source].slice(0, 1);

/**
 * 拉取一个「平台 × 分组」榜单
 * @param source 平台 key
 * @param group 分组 key
 * @param opts 加载选项
 * @param opts.force 清空重拉（下拉 / 轮询）
 * @param opts.silent 失败不翻错误态、不打 toast
 */
const ensureBoard = async (
  source: BoardSource,
  group: string,
  opts: { force?: boolean; silent?: boolean } = {},
): Promise<void> => {
  const key = buildCacheKey(source, group);
  const st = (pages[key] ??= BOARD_PAGE_DEFAULT());
  if (st.loading) return;

  if (!st.initialized) {
    st.initialized = true;
    const fresh = mobileCacheGet<HotBoardItem[]>(key, MOBILE_CACHE_TTL_MS);
    if (fresh) {
      st.items = fresh.value;
      st.fetchedAt = fresh.at;
      if (Date.now() - fresh.at <= MOBILE_CACHE_TTL_MS) return;
    }
  }

  st.loading = true;
  if (!opts.silent) st.error = false;
  try {
    const items = await fetchHotBoard(source, group);
    st.items = items;
    st.fetchedAt = Date.now();
    mobileCacheSet(key, items);
  } catch {
    if (!opts.silent) {
      if (st.items.length === 0) {
        const stale = mobileCacheGetStale<HotBoardItem[]>(key);
        if (stale) {
          st.items = stale.value;
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
 * navbar 标题箭头切换平台（循环：首个左切到末位，末位右切回首位）
 * @param offset 切换偏移（-1 上一个 / 1 下一个）
 */
const switchSource = (offset: number): void => {
  const list = visibleSources.value;
  const len = list.length;
  if (len === 0) return;
  const idx = list.indexOf(activeSource.value);
  const base = idx >= 0 ? idx : 0;
  activeIndex.value = (base + offset + len) % len;
};

/**
 * 激活平台变化（navbar 箭头 / 显隐校正 / 排序跟随）：
 * 分组 tab 高亮对齐该平台记忆的分组，并确保当前「平台 × 分组」已加载
 */
watch(activeIndex, () => {
  const source = activeSource.value;
  const gi = groupsOf(source).findIndex((group) => group.value === groupOf(source));
  activeGroupIndex.value = Math.max(gi, 0);
  void ensureBoard(source, groupOf(source));
});

/**
 * 切换分组
 * @param source 平台 key
 * @param group 分组 key
 */
const switchGroup = (source: BoardSource, group: string): void => {
  if (groupOf(source) === group) return;
  groupBySource[source] = group;
  void ensureBoard(source, group);
};

/**
 * 分组 tab 切换（点 tab / 横滑经 v-model 回流）：记忆到该平台并加载
 */
watch(activeGroupIndex, () => {
  const source = activeSource.value;
  const group = groupsOf(source)[activeGroupIndex.value];
  if (group) switchGroup(source, group.value);
});

/**
 * 下拉刷新：清当前「平台 × 分组」缓存（内存 + 持久层）→ 强制重拉
 * @param source 平台 key
 * @param group 分组 key
 */
const onPullRefresh = (source: BoardSource, group: string): void => {
  const st = (pages[buildCacheKey(source, group)] ??= BOARD_PAGE_DEFAULT());
  st.refreshing = true;
  void ensureBoard(source, group, { force: true, silent: false }).finally(() => {
    st.refreshing = false;
  });
};

/**
 * 平台显隐开关（至少保留一个平台；隐藏后不参与箭头切换，缓存保留）
 * @param source 平台 key
 * @param visible true 显示，false 隐藏
 */
const toggleSource = (source: BoardSource, visible: boolean): void => {
  const nextHidden = new Set(settings.hidden);
  if (visible) {
    nextHidden.delete(source);
  } else {
    if (settings.order.length - nextHidden.size <= 1) {
      showFailToast('至少保留一个平台');
      return;
    }
    nextHidden.add(source);
  }
  settings.hidden = [...nextHidden];
  persistSettings();
};

/* 平台排序改 vue-draggable-plus 拖拽（2026-10-20 王总指定）：v-model 即时更新 order，
   拖拽结束 @update 持久化，原上下移 moveSource 已删 */

/** 前台轮询：静默刷新当前「平台 × 分组」 */
useMobilePolling(() => {
  const source = activeSource.value;
  return ensureBoard(source, groupOf(source)!, { force: true, silent: true });
});

onMounted(() => {
  const source = activeSource.value;
  void ensureBoard(source, groupOf(source)!);
});
</script>

<template>
  <div class="m-page-flex">
    <!-- v2 起为首页入口卡跳转的二级页（DESIGN-MOBILE.md §2.3）：navbar 带返回键 -->
    <!-- navbar 标题两侧箭头循环切平台，标题前带当前平台 logo（王总 2026-10-11 / 2026-10-12） -->
    <van-nav-bar
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    >
      <template #title>
        <div class="m-nav-switch">
          <van-icon name="play" class="m-nav-switch__flip" size="15" @click="switchSource(-1)" />
          <img class="m-nav-src-logo" :src="BOARD_SOURCE_LOGOS[activeSource]" alt="" />
          <span>今天炒什么</span>
          <van-icon name="play" size="15" @click="switchSource(1)" />
        </div>
      </template>
      <template #right>
        <van-icon name="setting-o" size="18" @click="settingsOpen = true" />
      </template>
    </van-nav-bar>

    <!-- 快照时刻（当前平台当前分组）：Vant NoticeBar -->
    <van-notice-bar
      v-if="activeFetchedAt !== null"
      class="m-notice"
      :scrollable="false"
      left-icon="clock-o"
    >
      快照生成于 {{ formatSnapshotTime(activeFetchedAt) }} · 缓存 30 分钟 · 下拉刷新
    </van-notice-bar>

    <!-- 分组 Tabs（原平台 tabs 的位置，平台切换改由 navbar 标题两侧箭头承担；
         animated 点击切换横滑过渡；不开 swipeable，触摸拦截为零，垂直滚动完全原生）。
         :key 按平台强制换源整体重挂载：换源当轮 Vant 的 setLine 会跑在新 TabTitle
         ref 登记之前而静默跳过（浏览器实测 2026-10-12，nextTick resize 也救不了），
         指示条停留在旧平台偏移；重挂载走 Tabs init 的测量路径，实测是准的 -->
    <van-tabs
      :key="activeSource"
      v-model:active="activeGroupIndex"
      class="m-tabs"
      animated
      :lazy-render="false"
      :ellipsis="false"
    >
      <van-tab v-for="group in groupsOf(activeSource)" :key="group.value" :title="group.label">
        <van-pull-refresh
          :model-value="pageOfGroup(activeSource, group.value).refreshing"
          @refresh="onPullRefresh(activeSource, group.value)"
        >
          <div v-if="pageOfGroup(activeSource, group.value).error" class="m-error">
            <div>榜单加载失败，请检查网络后重试</div>
            <button
              class="m-error__retry"
              @click="ensureBoard(activeSource, group.value, { force: true })"
            >
              ↻ 重新加载
            </button>
          </div>
          <template v-else>
            <div class="m-board-card">
              <div class="m-board-head">
                <div class="m-board-head__logo">{{ logoOf(activeSource) }}</div>
                <div class="m-board-head__title">{{ BOARD_SOURCE_LABELS[activeSource] }}</div>
                <div class="m-board-head__time">
                  {{ formatSnapshotTime(pageOfGroup(activeSource, group.value).fetchedAt) }} 抓取
                </div>
              </div>
              <div class="m-board-list">
                <div
                  v-for="item in pageOfGroup(activeSource, group.value).items"
                  :key="item.symbol"
                  class="m-board-row"
                  @click="goStock(item.symbol)"
                >
                  <span
                    class="m-board-row__rank"
                    :class="{ 'm-board-row__rank--top': isTopRank(item.rank) }"
                  >
                    {{ item.rank }}
                  </span>
                  <div class="m-board-row__name">
                    <div class="t">{{ item.name }}</div>
                    <div class="c">{{ item.code }}</div>
                  </div>
                  <div class="m-board-row__px">
                    <div class="p m-num">{{ item.price ?? '--' }}</div>
                    <div class="g m-num" :class="pctClass(item.changePct)">
                      {{ formatPct(item.changePct) }}
                    </div>
                  </div>
                  <div class="m-board-row__heat">
                    <div class="h">{{ item.heatLabel || '--' }}</div>
                    <span
                      class="hc m-num"
                      :class="rankChangeClass(item.rankChange)"
                    >
                      {{ formatRankChange(item.rankChange) }}
                    </span>
                  </div>
                </div>
                <div
                  v-if="pageOfGroup(activeSource, group.value).items.length === 0 && !pageOfGroup(activeSource, group.value).loading"
                  class="m-empty"
                >
                  榜单暂无内容，点顶部箭头切换其他平台
                </div>
                <div v-if="pageOfGroup(activeSource, group.value).items.length > 0" class="m-footer">已经到底了~</div>
              </div>
            </div>
          </template>
        </van-pull-refresh>
      </van-tab>
    </van-tabs>

    <!-- 平台设置弹层（显隐 + 拖拽排序；vue-draggable-plus，handle 手柄 + force-fallback） -->
    <van-popup v-model:show="settingsOpen" position="bottom" round>
      <div style="padding: 14px 16px 18px">
        <div class="m-board-head" style="padding-top: 0">
          <div class="m-board-head__title">平台设置</div>
          <div class="m-board-head__time">开关显隐 · 拖拽调整顺序</div>
        </div>
        <VueDraggable
          v-model="settings.order"
          tag="div"
          :animation="150"
          handle=".m-drag-handle"
          :force-fallback="true"
          fallback-class="sortable-fallback"
          ghost-class="m-drag-ghost"
          chosen-class="m-drag-chosen"
          :fallback-tolerance="6"
          @update="persistSettings()"
        >
          <div
            v-for="source in settings.order"
            :key="source"
            class="m-sheet-row"
          >
            <span class="m-drag-handle"><van-icon name="wap-nav" /></span>
            <div class="m-board-head__logo">{{ logoOf(source) }}</div>
            <div class="m-sheet-row__name" :class="{ 'm-sheet-row__name--off': settings.hidden.includes(source) }">
              {{ BOARD_SOURCE_LABELS[source] }}
              <span v-if="settings.hidden.includes(source)">已隐藏 · 缓存保留</span>
            </div>
            <van-switch
              :model-value="!settings.hidden.includes(source)"
              size="20px"
              @update:model-value="(value: boolean) => toggleSource(source, value)"
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

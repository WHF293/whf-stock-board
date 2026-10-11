<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { showFailToast } from 'vant';
import { useRouter } from 'vue-router';
import { fetchHotBoard } from '../../common/api/hot-board.api.ts';
import type { HotBoardItem } from '../../common/types/hot-board.types.ts';
import {
  BOARD_GROUPS,
  BOARD_SOURCE_LABELS,
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
 * 五平台 Vant Tabs 切换（点 tab 切平台），一次只渲染一个平台；
 * 每平台保留自己的分组 chips（命名与桌面 hot-board.constants.ts 一致）；
 * 榜单页状态按「平台 × 分组」独立持久化缓存（30 分钟 TTL）；
 * 榜单行点击 v1 不响应（二期 K 线详情页）；
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

/** 平台 chip 顺序（隐藏平台不渲染；顺序 = 平台设置拖动后的持久化序） */
const visibleSources = computed<BoardSource[]>(() =>
  settings.order.filter((key) => !settings.hidden.includes(key)),
);

const activeIndex = ref(0);
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
 * 模板取状态（reactive 记录自动补默认值）
 * @param source 平台 key
 * @returns 该平台当前分组的状态
 */
const pageOf = (source: BoardSource): BoardPageState => {
  const key = buildCacheKey(source, groupOf(source));
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
 * Tabs 激活平台变化（点击 tab 或手势横滑都会经 v-model 回流）：确保当前平台当前分组已加载
 */
watch(activeIndex, () => {
  const source = visibleSources.value[activeIndex.value] ?? activeSource.value;
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
 * 下拉刷新：清当前「平台 × 分组」缓存（内存 + 持久层）→ 强制重拉
 * @param source 平台 key
 */
const onPullRefresh = (source: BoardSource): void => {
  const group = groupOf(source);
  const st = (pages[buildCacheKey(source, group)] ??= BOARD_PAGE_DEFAULT());
  st.refreshing = true;
  void ensureBoard(source, group, { force: true, silent: false }).finally(() => {
    st.refreshing = false;
  });
};

/**
 * 平台显隐开关（至少保留一个平台；隐藏只隐藏 chips，缓存保留）
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

/**
 * 平台排序（上移 / 下移；持久化）
 * @param index 当前序号
 * @param offset 移动偏移（-1 上移 / 1 下移）
 */
const moveSource = (index: number, offset: number): void => {
  const target = index + offset;
  if (target < 0 || target >= settings.order.length) return;
  const order = [...settings.order];
  const [moved] = order.splice(index, 1);
  order.splice(target, 0, moved!);
  settings.order = order;
  persistSettings();
};

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
    <!-- v2 起为首页入口卡跳转的二级页（design-mobile.md §2.3）：navbar 带返回键 -->
    <van-nav-bar
      title="今天炒什么"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    >
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

    <!-- 平台 Tabs（animated 点击切换横滑过渡；不开 swipeable，触摸拦截为零，垂直滚动完全原生） -->
    <van-tabs
      v-model:active="activeIndex"
      class="m-tabs"
      animated
      :lazy-render="false"
      :ellipsis="false"
    >
      <van-tab v-for="source in visibleSources" :key="source" :title="BOARD_SOURCE_LABELS[source]">
        <!-- 分组 chips（命名与桌面一致） -->
        <div class="m-chips">
          <button
            v-for="group in groupsOf(source)"
            :key="group.value"
            class="m-chip m-chip--sub"
            :class="{ 'm-chip--active': groupOf(source) === group.value }"
            @click="switchGroup(source, group.value)"
          >
            {{ group.label }}
          </button>
        </div>

        <van-pull-refresh :model-value="pageOf(source).refreshing" @refresh="onPullRefresh(source)">
          <div v-if="pageOf(source).error" class="m-error">
            <div>榜单加载失败，请检查网络后重试</div>
            <button
              class="m-error__retry"
              @click="ensureBoard(source, groupOf(source), { force: true })"
            >
              ↻ 重新加载
            </button>
          </div>
          <template v-else>
            <div class="m-board-card">
              <div class="m-board-head">
                <div class="m-board-head__logo">{{ logoOf(source) }}</div>
                <div class="m-board-head__title">{{ BOARD_SOURCE_LABELS[source] }}</div>
                <div class="m-board-head__time">
                  {{ formatSnapshotTime(pageOf(source).fetchedAt) }} 抓取
                </div>
              </div>
              <div class="m-board-list">
                <div
                  v-for="item in pageOf(source).items"
                  :key="item.symbol"
                  class="m-board-row"
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
                  v-if="pageOf(source).items.length === 0 && !pageOf(source).loading"
                  class="m-empty"
                >
                  榜单暂无内容，左右滑动切换其他平台
                </div>
                <div v-if="pageOf(source).items.length > 0" class="m-footer">已经到底了~</div>
              </div>
            </div>
          </template>
        </van-pull-refresh>
      </van-tab>
    </van-tabs>

    <!-- 平台设置弹层（显隐 + 排序；拖拽为后续迭代，先上下移） -->
    <van-popup v-model:show="settingsOpen" position="bottom" round>
      <div style="padding: 14px 16px 18px">
        <div class="m-board-head" style="padding-top: 0">
          <div class="m-board-head__title">平台设置</div>
          <div class="m-board-head__time">开关显隐 · ↑↓ 调整顺序</div>
        </div>
        <div
          v-for="(source, index) in settings.order"
          :key="source"
          class="m-sheet-row"
        >
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
          <button
            class="m-order-btn"
            :disabled="index === 0"
            @click="moveSource(index, -1)"
          >
            ↑
          </button>
          <button
            class="m-order-btn"
            :disabled="index === settings.order.length - 1"
            @click="moveSource(index, 1)"
          >
            ↓
          </button>
        </div>
        <van-button type="primary" block round style="margin-top: 14px" @click="settingsOpen = false">
          完成
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

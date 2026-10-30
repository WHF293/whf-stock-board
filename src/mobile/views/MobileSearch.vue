<script setup lang="ts">
/**
 * 股票搜索页（v2.2）：同花顺式搜索，首页 navbar 搜索入口的落点
 *
 * - 导航自绘一行（返回 + 输入框 + 搜索），不再用 van-nav-bar 的 title 槽（左箭头 absolute 定位会与输入框重叠）
 * - 无关键词：最近搜索（上次点选过的股票，最多 10 条，最新在前去重，持久化）+ 热门搜索榜单
 * - 有关键词（>=2 字符）：300ms 防抖即搜；「搜索」按钮/回车立即触发
 * - 结果行：名称 + 市场标签/代码（同花顺版式）；+ 一键加自选（默认分组），
 *   行点击进个股详情 /stock/:code 并记入最近搜索
 */
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { showToast } from 'vant';
import { searchStocks } from '../../common/api/search.api';
import { fetchHotBoard } from '../../common/api/hot-board.api';
import {
  BOARD_GROUPS,
  BOARD_SOURCE_ORDER,
} from '../../common/constants/hot-board.constants';
import type { BoardSource } from '../../common/constants/hot-board.constants';
import { useWatchlistStore } from '../../common/stores/watchlist';
import type { SearchResult } from '../../common/types/stock-quote.types';
import type { HotBoardItem } from '../../common/types/hot-board.types';
import { appStorage } from '../../common/utils/app-local-storage';
import {
  STORAGE_NS_MOBILE_BOARD_SETTINGS,
  STORAGE_NS_MOBILE_SEARCH_HISTORY,
} from '../../common/constants/storage-key.constants';
import { SEARCH_MARKET_LABELS } from '../../common/constants/search.constants';

const router = useRouter();
const store = useWatchlistStore();

/* === 热门搜索（与首页入口卡同口径：平台设置内第一个可见榜单 Top6） === */
const hot = ref<HotBoardItem[]>([]);

/** 与 MobileHome 同口径读平台设置（顺序 + 显隐）
 * @returns 平台设置对象：order 为展示顺序，hidden 为隐藏平台列表 */
const readBoardSettings = (): { order: BoardSource[]; hidden: BoardSource[] } => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_BOARD_SETTINGS);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<{ order: BoardSource[]; hidden: BoardSource[] }>;
      if (Array.isArray(parsed.order) && Array.isArray(parsed.hidden)) {
        return { order: parsed.order, hidden: parsed.hidden };
      }
    } catch {
      // 坏包回落默认
    }
  }
  return { order: [...BOARD_SOURCE_ORDER], hidden: [] };
};

const loadHot = async (): Promise<void> => {
  try {
    const { order, hidden } = readBoardSettings();
    const source = order.find((key) => !hidden.includes(key)) ?? BOARD_SOURCE_ORDER[0]!;
    const group = BOARD_GROUPS[source][0]!.value;
    hot.value = (await fetchHotBoard(source, group)).slice(0, 6);
  } catch {
    // 热门搜索属锦上添花，失败静默留空
  }
};
void loadHot();

/* === 搜索：防抖 300ms 即搜 + 按钮/回车立即搜 === */
const keyword = ref('');
const searching = ref(false);
const results = ref<SearchResult[]>([]);
let searchTimer: number | undefined;

/** 执行一次搜索
 * @param kw 关键词
 * @returns 无返回值，结果写入 results */
const doSearch = async (kw: string): Promise<void> => {
  searching.value = true;
  try {
    results.value = await searchStocks(kw);
  } catch {
    results.value = [];
  } finally {
    searching.value = false;
  }
};

/** 输入防抖（>=2 字符才请求）
 * @param value 输入关键词 */
const onInput = (value: string): void => {
  window.clearTimeout(searchTimer);
  const kw = value.trim();
  if (kw.length < 2) {
    results.value = [];
    searching.value = false;
    return;
  }
  searchTimer = window.setTimeout(() => void doSearch(kw), 300);
};

/** 「搜索」按钮 / 回车：立即搜当前关键词
 * @returns 无返回值，词长不足 2 时忽略 */
const onSearchNow = (): void => {
  const kw = keyword.value.trim();
  if (kw.length < 2) return;
  window.clearTimeout(searchTimer);
  void doSearch(kw);
};

/* === 结果行视图 === */

/** 市场标签（按完整符号前缀推导）
 * @param code 完整符号（如 sh600519 / hk00700 / usAAPL）
 * @returns 标签文案（沪A/深A/创/科创/北A/港股/美股），非上述市场返回空串 */
const marketTag = (code: string): string => {
  if (code.startsWith('hk')) return SEARCH_MARKET_LABELS.hk;
  if (code.startsWith('us')) return SEARCH_MARKET_LABELS.us;
  if (code.startsWith('sh68')) return '科创';
  if (code.startsWith('sh6')) return '沪A';
  if (code.startsWith('sz30')) return '创';
  if (code.startsWith('sz0')) return '深A';
  if (code.startsWith('bj')) return '北A';
  return '';
};

/** 标签配色档
 * @param code 完整符号
 * @returns 配色类名（t-a/t-cre/t-star/t-bj/t-hk） */
const tagCls = (code: string): string => {
  if (code.startsWith('hk')) return 't-hk';
  if (code.startsWith('us')) return 't-star';
  if (code.startsWith('sh68')) return 't-star';
  if (code.startsWith('sz30')) return 't-cre';
  if (code.startsWith('bj')) return 't-bj';
  return 't-a';
};

/** 展示用裸代码（去交易所前缀）
 * @param code 完整符号
 * @returns 裸数字代码 */
const bareCode = (code: string): string => code.replace(/^[a-z]{2}/, '');

/** 行点击进个股详情（并记入最近搜索）
 * @param code 完整符号
 * @param name 股票名（记录用；热门词路径没有则不记） */
const goStock = (code: string, name?: string): void => {
  if (name) rememberStock({ code, name });
  void router.push(`/stock/${code}`);
};

/* === 最近搜索：上次点选过的股票，最多 10 条，最新在前去重，appStorage 持久化 === */

/** 单条最近搜索 */
interface SearchHistoryItem {
  code: string;
  name: string;
}

/** 上限条数（用户定论：最多保留 10 个） */
const SEARCH_HISTORY_LIMIT = 10;

const history = ref<SearchHistoryItem[]>(readHistory());

/** 读持久化的最近搜索（坏包/缺字段静默回落空）
 * @returns 历史条目列表（已按最新在前截断） */
function readHistory(): SearchHistoryItem[] {
  try {
    const raw = appStorage.getItem(STORAGE_NS_MOBILE_SEARCH_HISTORY);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as Partial<SearchHistoryItem>[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SearchHistoryItem => typeof item?.code === 'string' && typeof item?.name === 'string')
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch {
    return [];
  }
}

/** 持久化当前历史 */
const saveHistory = (): void => {
  appStorage.setItem(STORAGE_NS_MOBILE_SEARCH_HISTORY, JSON.stringify(history.value));
};

/**
 * 记录一条最近搜索（去重置顶，超限截断）
 * @param item 点选的股票
 */
const rememberStock = (item: SearchHistoryItem): void => {
  history.value = [item, ...history.value.filter((h) => h.code !== item.code)].slice(0, SEARCH_HISTORY_LIMIT);
  saveHistory();
};

/**
 * 删除单条最近搜索
 * @param code 完整符号
 */
const removeHistory = (code: string): void => {
  history.value = history.value.filter((h) => h.code !== code);
  saveHistory();
};

/** 清空最近搜索 */
const clearHistory = (): void => {
  history.value = [];
  saveHistory();
};

/** 加自选（默认分组，去重由 store 负责）
 * @param item 搜索结果条目 */
const onAdd = (item: SearchResult): void => {
  const ok = store.addStock({ symbol: item.code, name: item.name, addedAt: Date.now() });
  showToast(ok ? `已加自选「${item.name}」` : '自选已存在');
};

/** 点热门词：填入关键词立即搜
 * @param name 热门词（股票名）
 * @returns 无返回值 */
const pickHot = (name: string): void => {
  keyword.value = name;
  void doSearch(name);
};
</script>

<template>
  <div class="m-page-flex">
    <!-- navbar：仅返回 + 标题（输入框独立成块放下方，不与导航挤一行） -->
    <van-nav-bar
      title="搜索"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <!-- 通栏输入块：输入框 + 搜索按钮（固定在列表上方，不随内容滚动） -->
    <div class="m-sch-bar">
      <input
        v-model="keyword"
        class="m-sch-input"
        placeholder="代码 / 名称 / 拼音"
        @update:model-value="onInput"
        @keyup.enter="onSearchNow"
      />
      <span class="m-sch-go" @click="onSearchNow">搜索</span>
    </div>

    <div class="m-sub-scroll">
      <!-- 无有效关键词：最近搜索 + 热门搜索 -->
      <template v-if="results.length === 0 && keyword.trim().length < 2">
        <template v-if="history.length > 0">
          <div class="m-sch-hot__t m-sch-his__t">
            最近搜索
            <span class="m-sch-his__clear" @click="clearHistory">清空</span>
          </div>
          <div class="m-card m-sch-card">
            <div v-for="h in history" :key="h.code" class="m-row m-sch-row">
              <div class="m-sch-row__main" @click="goStock(h.code, h.name)">
                <div class="m-sch-row__nm">{{ h.name }}</div>
                <div class="m-sch-row__meta">
                  <span class="m-sch-row__code">{{ bareCode(h.code) }}</span>
                </div>
              </div>
              <van-icon name="cross" class="m-sch-add" @click.stop="removeHistory(h.code)" />
            </div>
          </div>
        </template>

        <div class="m-sch-hot__t">热门搜索</div>
        <div class="m-sch-hot__grid">
          <div v-for="(item, i) in hot" :key="item.code" class="m-sch-hot__item" @click="pickHot(item.name)">
            <span class="m-sch-hot__rank" :class="`r${i + 1}`">{{ i + 1 }}</span>
            <span class="m-sch-hot__nm">{{ item.name }}</span>
          </div>
        </div>
        <!-- 热门榜单首载：骨架行过渡（骨架即 loading） -->
        <div v-if="hot.length === 0" class="m-skel-block">
          <div v-for="i in 6" :key="i" class="m-skel-row"></div>
        </div>
      </template>

      <!-- 搜索结果 -->
      <template v-else>
        <div v-if="searching" class="m-state">搜索中…</div>
        <div v-else-if="results.length === 0" class="m-state">无匹配结果</div>
        <div v-else class="m-card m-sch-card">
          <div v-for="item in results" :key="item.code" class="m-row m-sch-row">
            <div class="m-sch-row__main" @click="goStock(item.code, item.name)">
              <div class="m-sch-row__nm">{{ item.name }}</div>
              <div class="m-sch-row__meta">
                <span v-if="marketTag(item.code)" class="m-sch-tag" :class="tagCls(item.code)">
                  {{ marketTag(item.code) }}
                </span>
                <span class="m-sch-row__code">{{ bareCode(item.code) }}</span>
              </div>
            </div>
            <van-icon name="plus" class="m-sch-add" @click.stop="onAdd(item)" />
          </div>
        </div>
      </template>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>

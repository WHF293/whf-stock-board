<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchFullQuotes } from '../../common/api/quotes.api';
import { INDEX_SYMBOLS } from '../../common/constants/index-symbols.constants';
import type { FullQuote } from '../../common/types/stock-quote.types';
import {
  BOARD_GROUPS,
  BOARD_SOURCE_LABELS,
  BOARD_SOURCE_ORDER,
} from '../../common/constants/hot-board.constants';
import type { BoardSource } from '../../common/constants/hot-board.constants';
import { fetchHotBoard } from '../../common/api/hot-board.api';
import type { HotBoardItem } from '../../common/types/hot-board.types';
import { appStorage } from '../../common/utils/app-local-storage';
import { STORAGE_NS_MOBILE_BOARD_SETTINGS } from '../../common/constants/storage-key.constants';

/**
 * 首页（v2 Tab1）：开盘前 30 秒看完全局
 *
 * 版式按 .ai/项目资源/stock-board-mobile-home-tab-v2.html A0：
 * 玻璃 navbar（日期问候 + 设置）→ 指数情绪条 → 今天炒什么入口卡 → 二期预告卡。
 * 分区降级：指数条 / 入口卡各自独立加载与重试，互不阻塞（稿 A2 口径）。
 */
const router = useRouter();

/** 日期问候（navbar 副行 + 主行） */
const dateLabel = computed(() =>
  new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'long' }),
);
const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 6) return '夜深了';
  if (h < 11) return '早上好';
  if (h < 13) return '中午好';
  if (h < 18) return '下午好';
  return '晚上好';
});

/* === 指数情绪条（一期 4 项：进入首页刷新一次，30s TTL；点击无动作，二期并入全景） === */
const INDEX_LABELS: Record<string, string> = {
  sh000001: '上证指数',
  sz399001: '深证成指',
  sz399006: '创业板指',
  sh000688: '科创50',
};
interface IndexPill {
  code: string;
  name: string;
  price: number;
  changePct: number | null;
}
const indices = ref<IndexPill[]>([]);
const indicesError = ref(false);
const INDEX_TTL_MS = 30_000;
let indicesAt = 0;

const loadIndices = async (force = false): Promise<void> => {
  if (!force && Date.now() - indicesAt < INDEX_TTL_MS) return;
  try {
    const quotes: FullQuote[] = await fetchFullQuotes(INDEX_SYMBOLS);
    indices.value = quotes.map((q) => ({
      code: q.code,
      name: q.name || INDEX_LABELS[q.code] || q.code,
      price: q.price,
      changePct: q.changePercent,
    }));
    indicesError.value = false;
    indicesAt = Date.now();
  } catch {
    indicesError.value = true;
  }
};

/* === 今天炒什么入口卡：主线 + Top5 预览（六平台榜单第一名口径，稿附录③） === */
interface BoardCardState {
  source: BoardSource | null;
  mainline: string;
  top5: HotBoardItem[];
}
const boardCard = ref<BoardCardState>({ source: null, mainline: '', top5: [] });
const boardError = ref(false);

/** 与 MobileBoard 同口径读平台设置（顺序 + 显隐）
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

const loadBoardCard = async (): Promise<void> => {
  try {
    const { order, hidden } = readBoardSettings();
    const source = order.find((key) => !hidden.includes(key)) ?? BOARD_SOURCE_ORDER[0]!;
    const group = BOARD_GROUPS[source][0]!.value;
    const items = await fetchHotBoard(source, group);
    boardCard.value = {
      source,
      mainline: items[0]?.name ?? '',
      top5: items.slice(0, 5),
    };
    boardError.value = false;
  } catch {
    boardError.value = true;
  }
};

const goBoard = (): void => {
  void router.push('/board');
};

/* === 更多功能卡（v2 二期已上线：直达对应二级页） === */
const PHASE2_CARDS = [
  { key: 'panorama', icon: '▦', label: '行情全景' },
  { key: 'market-rank', icon: '☰', label: '市场榜单' },
  { key: 'board-calendar', icon: '▤', label: '板块日历' },
] as const;

const onPhase2Click = (key: string): void => {
  void router.push(`/${key}`);
};

/** 整页下拉刷新：两个分区并行重拉（强制越过 TTL）
 * @returns 无返回值，finally 里复位 v-model 收起下拉状态 */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {

  try {
    await Promise.all([loadIndices(true), loadBoardCard()]);
  } finally {
    refreshing.value = false;
  }
};

onMounted(() => {
  void loadIndices(true);
  void loadBoardCard();
});

/* === 格式化 === */
const fmtPrice = (v: number): string => v.toFixed(2);
const fmtPct = (v: number | null): string =>
  v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const pctClass = (v: number | null): string =>
  v === null || v === 0 ? 'm-flat' : v > 0 ? 'm-up' : 'm-down';
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar class="m-nav m-home-glass-nav" safe-area-inset-top>
      <template #title>
        <span class="m-home-nav__date">{{ dateLabel }} · {{ greeting }}</span>
      </template>
      <template #right>
        <van-icon name="setting-o" size="18" @click="router.push('/settings')" />
      </template>
    </van-nav-bar>

    <!-- 整页下拉刷新（面板内滚动 + PullRefresh 宿主结构，与 news/board 同构） -->
    <van-pull-refresh v-model="refreshing" class="m-home-scroll" @refresh="onRefresh">
      <!-- 指数情绪条（分区降级：失败只降这一条） -->
      <div class="m-home-index-bar">
        <template v-if="indices.length > 0">
          <div v-for="item in indices" :key="item.code" class="m-home-index">
            <div class="m-home-index__name">{{ item.name }}</div>
            <div class="m-home-index__px" :class="pctClass(item.changePct)">
              {{ fmtPrice(item.price) }}
            </div>
            <div class="m-home-index__pct" :class="pctClass(item.changePct)">
              {{ fmtPct(item.changePct) }}
            </div>
          </div>
        </template>
        <div v-else-if="indicesError" class="m-home-err">
          指数加载失败
          <span class="retry" @click="loadIndices(true)">重试</span>
        </div>
        <div v-for="n in 4" v-else :key="n" class="m-home-index m-home-index--skeleton">
          <van-skeleton title :row="1" :loading="true" />
        </div>
      </div>

      <!-- 今天炒什么入口卡 -->
      <div class="m-home-sec">
        <span class="m-home-sec__t">今天炒什么</span>
        <span class="m-home-sec__s">热度主线 · Top5 预览</span>
      </div>
      <div v-if="boardError" class="m-home-err">
        榜单加载失败
        <span class="retry" @click="loadBoardCard()">重试</span>
      </div>
      <div v-else-if="boardCard.top5.length === 0" class="m-home-board-card">
        <van-skeleton title :row="3" :loading="true" />
      </div>
      <div v-else class="m-home-board-card" @click="goBoard">
        <div class="m-home-board-card__head">
          <span class="m-home-board-card__badge">
            {{ boardCard.source ? BOARD_SOURCE_LABELS[boardCard.source] : '' }}
          </span>
          <span class="m-home-board-card__main">
            {{ boardCard.mainline }}
            <span class="sub">当前热度榜首 · 点击查看完整榜单</span>
          </span>
          <span class="m-home-board-card__more">›</span>
        </div>
        <div
          v-for="(item, i) in boardCard.top5"
          :key="item.code"
          class="m-home-board-row"
          @click.stop="goBoard"
        >
          <span class="m-home-board-row__rank" :class="{ top: i === 0 }">{{ i + 1 }}</span>
          <span class="m-home-board-row__nm">
            {{ item.name }}<span class="code">{{ item.code }}</span>
          </span>
          <span class="m-home-board-row__heat">{{ item.heatLabel }}</span>
          <span class="m-home-board-row__pct" :class="pctClass(item.changePct)">
            {{ fmtPct(item.changePct) }}
          </span>
        </div>
      </div>

      <!-- 二期预告卡（锁定态） -->
      <div class="m-home-sec">
        <span class="m-home-sec__t">更多功能</span>
        <span class="m-home-sec__s">更多行情工具</span>
      </div>
      <div class="m-home-soon-grid">
        <div
          v-for="card in PHASE2_CARDS"
          :key="card.key"
          class="m-home-soon"
          @click="onPhase2Click(card.key)"
        >
          <div class="m-home-soon__ic">{{ card.icon }}</div>
          <div class="m-home-soon__t">{{ card.label }}</div>
          <span class="m-home-soon__tag">进入 ›</span>
        </div>
      </div>

      <!-- 底部让位（悬浮 TabBar + 手势区，design-mobile.md §2.1） -->
      <div class="m-home-tail"></div>
    </van-pull-refresh>
  </div>
</template>

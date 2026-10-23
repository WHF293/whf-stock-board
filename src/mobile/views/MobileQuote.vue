<script setup lang="ts">
/**
 * 行情（2026-10-20 新增主 Tab）：参考同花顺行情页结构——
 * 指数模块自首页整体迁入（A 股指数条 + 全球指数展开区，数据口径不变），
 * 指数模块下方为金刚区快捷入口五项（今天炒什么 / 盘面雷达 / 连板 / 异动 / 龙虎榜，
 * 自首页金刚区迁出）。首页仍保留成交额 / 分布 / 情绪等模块，不受影响。
 * - 指数：fetchFullQuotes（东财，30s TTL）+ fetchGlobalIndexQuotes（展开时拉取）
 * - 金刚区四项下方平铺两卡（2026-10-20 王总指定，自首页迁入）：
 *   大盘评级（自持 60s TTL 轮询）+ 今天炒什么（主线 + Top5 预览）
 *   （2026-10-20 王总指定：评级在前；热力同日与首页今天炒什么互换回首页）
 * - 失败态：保留指数名、数值 --/--%（与原首页同口径）
 * - 整页下拉刷新并行重拉
 * - 骨架：.m-page-flex + .m-home-scroll（navbar 固定、面板内滚动，与首页同构；2026-10-20 修复）
 */
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showFailToast } from 'vant';
import { VueDraggable } from 'vue-draggable-plus';
import { fetchFullQuotes } from '../../common/api/quotes.api';
import { fetchGlobalIndexQuotes } from '../../common/api/panorama.api';
import { fetchHotBoard } from '../../common/api/hot-board.api';
import { INDEX_SYMBOLS } from '../../common/constants/index-symbols.constants';
import {
  BOARD_GROUPS,
  BOARD_SOURCE_LABELS,
  BOARD_SOURCE_ORDER,
} from '../../common/constants/hot-board.constants';
import type { BoardSource } from '../../common/constants/hot-board.constants';
import type { HotBoardItem } from '../../common/types/hot-board.types';
import type { GlobalIndexQuote } from '../../common/types/panorama.types';
import type { FullQuote } from '../../common/types/stock-quote.types';
import { appStorage } from '../../common/utils/app-local-storage';
import {
  STORAGE_NS_MOBILE_BOARD_SETTINGS,
  STORAGE_NS_MOBILE_QUOTE_KING_SETTINGS,
} from '../../common/constants/storage-key.constants';
import MobileRatingCard from '../components/MobileRatingCard.vue';

const router = useRouter();

/* === 指数模块（自 MobileHome 原样迁入，2026-10-20 王总指定） === */
const INDEX_LABELS: Record<string, string> = {
  sh000001: '上证指数',
  sz399001: '深证成指',
  sz399006: '创业板指',
};
/**
 * A 股指数条列表（2026-10-13 王总：去掉科创50；PC 市场总览仍用全量 INDEX_SYMBOLS）
 */
const HOME_INDEX_SYMBOLS = INDEX_SYMBOLS.filter((code) => code !== 'sh000688');
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

/** A 股指数条占位（名称取 INDEX_LABELS，顺序与 HOME_INDEX_SYMBOLS 一致） */
const indexPlaceholders = HOME_INDEX_SYMBOLS.map((code) => ({
  code,
  name: INDEX_LABELS[code] ?? code,
}));

/** 全球指数占位名（顺序与 PANORAMA_GLOBAL_INDEX_SECIDS 对齐） */
const GLOBAL_INDEX_PLACEHOLDERS = [
  '恒生指数',
  '道琼斯',
  '纳斯达克',
  '标普500',
  '日经225',
  '韩国KOSPI',
];

/* 全球指数（PC 同款 6 项：恒生/道琼斯/纳斯达克/标普500/日经225/KOSPI，东财 ulist 源） */
const globalIndices = ref<GlobalIndexQuote[]>([]);
const globalIndicesError = ref(false);
/** 展开区显隐（会话内记忆即可，与 PC 展开开关一致不持久化） */
const indexExpanded = ref(false);

const loadGlobalIndices = async (force = false): Promise<void> => {
  if (!force && globalIndices.value.length > 0) return;
  try {
    // 上游 200 ≠ 有数据（diff 缺失返回空数组），空数组也按错误态给重试入口
    globalIndices.value = await fetchGlobalIndexQuotes();
    globalIndicesError.value = globalIndices.value.length === 0;
  } catch {
    globalIndicesError.value = true;
  }
};

const loadIndices = async (force = false): Promise<void> => {
  if (!force && Date.now() - indicesAt < INDEX_TTL_MS) return;
  void loadGlobalIndices(force);
  try {
    const quotes: FullQuote[] = await fetchFullQuotes(HOME_INDEX_SYMBOLS);
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

/* === 金刚区快捷入口（自首页金刚区迁出四项，样式复用全局 .m-home-king） === */
interface QuoteKingItem {
  icon: string;
  label: string;
  to: string;
  /** icon 固定彩色（与首页金刚区同一套，不随主题） */
  color: string;
}
/** 行情页金刚区五项（2026-10-20 王总指定：今天炒什么 / 连板 / 异动 / 龙虎榜；盘面雷达（原市场榜单）同日自首页金刚区迁入） */
const QUOTE_KING_ITEMS: readonly QuoteKingItem[] = [
  { icon: 'fire-o', label: '今天炒什么', to: '/board', color: '#f97316' },
  { icon: 'chart-trending-o', label: '盘面雷达', to: '/market-rank', color: '#8b5cf6' },
  { icon: 'medal-o', label: '连板', to: '/rank/event', color: '#f59e0b' },
  { icon: 'bell', label: '异动', to: '/rank/events', color: '#ef4444' },
  { icon: 'flag-o', label: '龙虎榜', to: '/rank/dragon-tiger', color: '#ec4899' },
];

/* === 金刚区入口设置（长按 tile 弹出，显隐 + 拖拽排序；与首页同交互，独立持久化键——
   行情页入口集合与首页不相交，共用键会让两页设置互相污染，2026-10-20 修正为独立键） === */
/** 行情页金刚区设置持久化形态（order 全量序 / hidden 隐藏集合），与首页 kingSettings 同构 */
interface QuoteKingSettings {
  order: string[];
  hidden: string[];
}

/** to → 定义（设置弹窗行渲染 / 持久化序回填用） */
const QUOTE_KING_BY_TO = new Map(QUOTE_KING_ITEMS.map((item) => [item.to, item]));

const readQuoteKingSettings = (): QuoteKingSettings => {
  const raw = appStorage.getItem(STORAGE_NS_MOBILE_QUOTE_KING_SETTINGS);
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as Partial<QuoteKingSettings>;
      if (Array.isArray(parsed.order) && Array.isArray(parsed.hidden)) {
        // 未知 key 剔除、新入口按默认序补尾（版本升级后 defs 增删的兜底）
        const known = parsed.order.filter((to) => QUOTE_KING_BY_TO.has(to));
        for (const item of QUOTE_KING_ITEMS) {
          if (!known.includes(item.to)) known.push(item.to);
        }
        return { order: known, hidden: parsed.hidden.filter((to) => QUOTE_KING_BY_TO.has(to)) };
      }
    } catch {
      // 坏包按全显示默认序处理
    }
  }
  return { order: QUOTE_KING_ITEMS.map((item) => item.to), hidden: [] };
};

const quoteKingSettings = reactive<QuoteKingSettings>(readQuoteKingSettings());

const persistQuoteKingSettings = (): void => {
  appStorage.setItem(
    STORAGE_NS_MOBILE_QUOTE_KING_SETTINGS,
    JSON.stringify({ order: quoteKingSettings.order, hidden: quoteKingSettings.hidden }),
  );
};

/** 可见入口（隐藏项不渲染；顺序 = 设置调整后的持久化序） */
const visibleQuoteKingItems = computed<QuoteKingItem[]>(() =>
  quoteKingSettings.order
    .filter((to) => !quoteKingSettings.hidden.includes(to))
    .map((to) => QUOTE_KING_BY_TO.get(to))
    .filter((item): item is QuoteKingItem => item !== undefined),
);

/* --- 金刚区设置弹窗（长按 tile 打开；桌面浏览器右键同开，便于调试） --- */
const kingSettingsOpen = ref(false);

/**
 * 入口显隐开关（至少保留一个入口）
 * @param to 入口路由路径
 * @param visible true 显示，false 隐藏
 */
const toggleKing = (to: string, visible: boolean): void => {
  const nextHidden = new Set(quoteKingSettings.hidden);
  if (visible) {
    nextHidden.delete(to);
  } else {
    if (quoteKingSettings.order.length - nextHidden.size <= 1) {
      showFailToast('至少保留一个入口');
      return;
    }
    nextHidden.add(to);
  }
  quoteKingSettings.hidden = [...nextHidden];
  persistQuoteKingSettings();
};

/* --- 长按手势（pointer 事件统一覆盖触屏长按与桌面按住；阈值 500ms，位移 >10px 视为滚动取消） --- */
const KING_LONG_PRESS_MS = 500;
let kingPressTimer: number | null = null;
let kingPressStart: { x: number; y: number } | null = null;
/** 长按已触发标记：吞掉长按后 pointerup 派生的 click，避免弹窗打开同时跳页 */
let kingLongPressFired = false;

const clearKingPress = (): void => {
  if (kingPressTimer !== null) {
    clearTimeout(kingPressTimer);
    kingPressTimer = null;
  }
  kingPressStart = null;
};

/** tile 按下：启动长按计时
 * @param e 指针按下事件（记录起点坐标，供移动阈值判定） */
const onKingPressStart = (e: PointerEvent): void => {
  clearKingPress();
  kingLongPressFired = false;
  kingPressStart = { x: e.clientX, y: e.clientY };
  kingPressTimer = window.setTimeout(() => {
    kingPressTimer = null;
    kingLongPressFired = true;
    kingSettingsOpen.value = true;
  }, KING_LONG_PRESS_MS);
};

/** tile 抬起 / 取消：停表（长按已触发的场景由 click 兜底吞掉跳页） */
const onKingPressEnd = (): void => {
  clearKingPress();
};

/** tile 移动：超过阈值判定为滚动/拖动，取消长按
 * @param e 指针移动事件 */
const onKingPressMove = (e: PointerEvent): void => {
  if (!kingPressStart) return;
  const dx = e.clientX - kingPressStart.x;
  const dy = e.clientY - kingPressStart.y;
  if (dx * dx + dy * dy > 100) clearKingPress();
};

/**
 * tile 点击跳页（长按触发过的当次点击吞掉）
 * @param to 入口路由路径
 */
const goTile = (to: string): void => {
  if (kingLongPressFired) {
    kingLongPressFired = false;
    return;
  }
  router.push(to);
};

/* === 今天炒什么入口卡（自首页迁入，2026-10-20 王总指定两模块互换）：主线 + Top5 预览 === */
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

/* === 大盘评级卡（自首页迁入；自持 60s TTL 轮询，下拉刷新强制重拉） === */
const ratingCardRef = ref<InstanceType<typeof MobileRatingCard> | null>(null);

/* === 格式化（与首页同口径） === */
/**
 * 最新价文案（两位小数）
 * @param v 价格
 * @returns 形如 `12.34`
 */
const fmtPrice = (v: number): string => v.toFixed(2);
const fmtPct = (v: number | null): string =>
  v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const pctClass = (v: number | null): string =>
  v === null || v === 0 ? 'm-flat' : v > 0 ? 'm-up' : 'm-down';

/* === 整页下拉刷新 === */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    await Promise.all([loadIndices(true), loadBoardCard()]);
    void ratingCardRef.value?.load(true);
  } finally {
    refreshing.value = false;
  }
};

onMounted(() => {
  void loadIndices(true);
  void loadBoardCard();
});
</script>

<template>
  <!-- 主 Tab 骨架（.m-page-flex）：navbar 固定在顶、下拉刷新区面板内滚动（与首页 MobileHome 同构，
       修复 navbar 随内容滑走——2026-10-20 王总反馈） -->
  <div class="m-page-flex">
    <van-nav-bar title="行情" class="m-nav" safe-area-inset-top />

    <van-pull-refresh v-model="refreshing" class="m-home-scroll" @refresh="onRefresh">
      <!-- 1. 指数模块（自首页迁入：A 股指数条 + 全球指数展开区） -->
      <div class="m-home-index-bar">
        <!-- 失败态：保留指数名，数值显示 --/--%（弱化展示），不整块报错 -->
        <template v-if="indicesError">
          <div
            v-for="item in indexPlaceholders"
            :key="item.code"
            class="m-home-index m-home-index--err"
          >
            <div class="m-home-index__name">{{ item.name }}</div>
            <div class="m-home-index__px">--</div>
            <div class="m-home-index__pct">--%</div>
          </div>
        </template>
        <template v-else-if="indices.length > 0">
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
        <div v-for="n in 3" v-else :key="n" class="m-home-index m-home-index--skeleton">
          <van-skeleton title :row="1" :loading="true" />
        </div>
      </div>
      <!-- 指数条失败提示：异常占位 + 重试（仅在失败态出现） -->
      <div v-if="indicesError" class="m-home-err-strip">
        <van-icon name="warning-o" />
        指数加载失败
        <button class="m-err-retry" @click="loadIndices(true)">重试</button>
      </div>
      <!-- 全球指数展开区（PC 市场总览同款高度过渡：常驻容器 max-height + opacity） -->
      <div class="m-home-index-expand" :class="{ 'm-home-index-expand--open': indexExpanded }">
        <template v-if="indexExpanded">
          <!-- 失败态：保留指数名 + --/--% 占位（与 A 股指数条同口径） -->
          <template v-if="globalIndicesError">
            <div class="m-home-index-grid">
              <div
                v-for="name in GLOBAL_INDEX_PLACEHOLDERS"
                :key="name"
                class="m-home-index m-home-index--err"
              >
                <div class="m-home-index__name">{{ name }}</div>
                <div class="m-home-index__px">--</div>
                <div class="m-home-index__pct">--%</div>
              </div>
            </div>
            <div class="m-home-err-strip">
              <van-icon name="warning-o" />
              全球指数加载失败
              <button class="m-err-retry" @click="loadGlobalIndices(true)">重试</button>
            </div>
          </template>
          <div v-else-if="globalIndices.length > 0" class="m-home-index-grid">
            <div v-for="g in globalIndices" :key="g.code" class="m-home-index">
              <div class="m-home-index__name">{{ g.name }}</div>
              <div class="m-home-index__px" :class="pctClass(g.changePercent)">
                {{ g.price === null ? '--' : fmtPrice(g.price) }}
              </div>
              <div class="m-home-index__pct" :class="pctClass(g.changePercent)">
                {{ fmtPct(g.changePercent) }}
              </div>
            </div>
          </div>
          <div v-else class="m-home-index-grid">
            <div v-for="n in 6" :key="n" class="m-home-index m-home-index--skeleton">
              <van-skeleton title :row="1" :loading="true" />
            </div>
          </div>
        </template>
      </div>
      <!-- 全球指数展开开关（通栏居中幽灵圆钮，仅 chevron；展开时 icon 落在全球指数下方） -->
      <button
        class="m-home-index-more"
        :class="{ 'm-home-index-more--open': indexExpanded }"
        data-track="QUOTE_INDEX_MORE"
        :aria-expanded="indexExpanded"
        :aria-label="indexExpanded ? '收起全球指数' : '展开全球指数'"
        @click="indexExpanded = !indexExpanded"
      >
        <van-icon name="arrow-down" />
      </button>

      <!-- 2. 金刚区快捷入口（今天炒什么 / 盘面雷达 / 连板 / 异动 / 龙虎榜，自首页金刚区迁入；
           长按任意 tile 弹出入口设置，显隐 + 拖拽排序，交互与首页一致） -->
      <div class="m-home-king m-quote-king">
        <div
          v-for="item in visibleQuoteKingItems"
          :key="item.to"
          class="m-home-king__item"
          @click="goTile(item.to)"
          @pointerdown="onKingPressStart"
          @pointerup="onKingPressEnd"
          @pointercancel="onKingPressEnd"
          @pointermove="onKingPressMove"
          @contextmenu.prevent="kingSettingsOpen = true"
        >
          <span class="m-home-king__ic"><van-icon :name="item.icon" :style="{ color: item.color }" /></span>
          <span class="m-home-king__name">{{ item.label }}</span>
        </div>
      </div>

      <!-- 3. 大盘评级（自首页迁入，平铺；组件自持 60s TTL 轮询；2026-10-20 王总指定排在热力前） -->
      <div class="m-card m-quote-rate">
        <div class="m-home-sec m-home-sec--in">
          <span class="m-home-sec__t">大盘评级</span>
          <span class="m-home-sec__s">同花顺评分 · 60s 刷新</span>
        </div>
        <MobileRatingCard ref="ratingCardRef" />
      </div>

      <!-- 4. 今天炒什么（自首页迁入，2026-10-20 王总指定与板块热力互换；点击进 /board） -->
      <div class="m-home-sec">
        <span class="m-home-sec__t">今天炒什么</span>
        <span class="m-home-sec__s">热度主线 · Top5 预览</span>
      </div>
      <div v-if="boardError" class="m-home-err-box m-home-err-box--board">
        <van-icon name="warning-o" />
        榜单加载失败
        <span class="retry" @click="loadBoardCard()">重试</span>
      </div>
      <div v-else-if="boardCard.top5.length === 0" class="m-home-board-card">
        <van-skeleton title :row="3" :loading="true" />
      </div>
      <div v-else class="m-home-board-card" @click="router.push('/board')">
        <div class="m-home-board-card__head">
          <span class="m-home-board-card__badge">
            {{ boardCard.source ? BOARD_SOURCE_LABELS[boardCard.source] : '' }}
          </span>
          <span class="m-home-board-card__more">查看更多 ›</span>
        </div>
        <div
          v-for="(item, i) in boardCard.top5"
          :key="item.code"
          class="m-home-board-row"
          @click.stop="router.push('/board')"
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

      <!-- 底部让位（悬浮 TabBar + 手势区） -->
      <div class="m-home-tail"></div>
    </van-pull-refresh>

    <!-- 金刚区入口设置弹层（长按 tile 打开；显隐 + 拖拽排序，与首页金刚区设置同构；
         拖拽用 vue-draggable-plus，handle 限定手柄 + force-fallback（WebView 必需）） -->
    <van-popup v-model:show="kingSettingsOpen" position="bottom" round>
      <div style="padding: 14px 16px 18px">
        <div class="m-board-head" style="padding-top: 0">
          <div class="m-board-head__title">金刚区入口设置</div>
          <div class="m-board-head__time">开关显隐 · 拖拽调整顺序</div>
        </div>
        <VueDraggable
          v-model="quoteKingSettings.order"
          tag="div"
          :animation="150"
          handle=".m-drag-handle"
          :force-fallback="true"
          fallback-class="sortable-fallback"
          ghost-class="m-drag-ghost"
          chosen-class="m-drag-chosen"
          :fallback-tolerance="6"
          @update="persistQuoteKingSettings()"
        >
          <div
            v-for="to in quoteKingSettings.order"
            :key="to"
            class="m-sheet-row"
          >
            <span class="m-drag-handle"><van-icon name="wap-nav" /></span>
            <div
              class="m-sheet-row__name"
              :class="{ 'm-sheet-row__name--off': quoteKingSettings.hidden.includes(to) }"
            >
              {{ QUOTE_KING_BY_TO.get(to)?.label ?? to }}
              <span v-if="quoteKingSettings.hidden.includes(to)">已隐藏</span>
            </div>
            <van-switch
              :model-value="!quoteKingSettings.hidden.includes(to)"
              size="20px"
              @update:model-value="(value: boolean) => toggleKing(to, value)"
            />
          </div>
        </VueDraggable>
        <van-button type="primary" block round style="margin-top: 14px" @click="kingSettingsOpen = false">
          完成
        </van-button>
      </div>
    </van-popup>
  </div>
</template>

<style scoped>
/* 行情页金刚区五项正好一行 5 格：直接继承 .m-home-king 的 repeat(5, 1fr)，无需覆盖 */
</style>

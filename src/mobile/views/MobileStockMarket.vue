<script setup lang="ts">
/**
 * 个股行情（移动端二级页，入口在首页金刚区「个股行情」；PC /stock-market 同源移动版）
 *
 * 数据源：同花顺行情中心 ajax HTML 片段（fetchThsStockBoardPage，GBK，服务端排序 + 翻页）。
 * - 板块 chips 横滚：全部 / 沪市A股 / 深市A股 / 北交所 / 创业板 / 科创板
 * - 列表默认涨跌幅降序（移动端不做表头排序，PC 独有）；每页 20 条上拉加载（van-list）
 * - 行点击 → /stock/:code 个股详情（全站统一落点）
 * - 30s 前台轮询首页替换（useMobilePolling，页面隐藏即停）；下拉刷新重置回第 1 页
 */
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchThsStockBoardPage } from '../../common/api/ths-stock-board.api.ts';
import {
  THS_STOCK_BOARD_PAGE_SIZE,
  THS_STOCK_BOARD_TABS,
  type ThsStockBoard,
} from '../../common/constants/ths-market.constants.ts';
import { toFullSymbol } from '../../common/utils/to-full-symbol';
import type { ThsStockRow } from '../../common/types/ths-market.types.ts';
import { pctClass } from '../utils/format';
import { useMobilePolling } from '../composables/use-mobile-polling';
import { useBreakpoint } from '../composables/use-breakpoint';
import { useStockPane } from '../composables/use-stock-pane';
import StockDetailPane from '../components/StockDetailPane.vue';

const router = useRouter();

/* lg 档主从布局（稿：Pad横屏主从布局改造 S7）：点行右栏就地看个股 */
const { lg } = useBreakpoint();
const { paneSymbol, paneOpen, openStock, closePane } = useStockPane();

/** 板块 chips（横滚；与 PC Tab 同一常量单源） */
const boards = THS_STOCK_BOARD_TABS;
const board = ref<ThsStockBoard>('all');

const rows = ref<ThsStockRow[]>([]);
const page = ref(1);
const loading = ref(false);
const error = ref(false);
/** van-list：true 表示加载完所有页（总页数未知时恒 false，靠空页兜底） */
const finished = ref(false);

/**
 * 拉取指定页并按模式合并：loadMore 追加，reset 替换
 * @param mode 'reset' 回第 1 页替换 / 'more' 追加下一页（van-list 自管 loading，不设防抖闸）
 */
const loadPage = async (mode: 'reset' | 'more'): Promise<void> => {
  if (mode === 'reset' && loading.value) return;
  loading.value = true;
  try {
    const targetPage = mode === 'reset' ? 1 : page.value + 1;
    const result = await fetchThsStockBoardPage({
      board: board.value,
      field: 'changePercent',
      order: 'desc',
      page: targetPage,
    });
    rows.value = mode === 'reset' ? result.rows : [...rows.value, ...result.rows];
    page.value = targetPage;
    error.value = false;
    // 总页数解析不到时靠「空页」兜底：追加模式拿到 0 行即到底
    finished.value =
      result.rows.length < THS_STOCK_BOARD_PAGE_SIZE ||
      (result.totalPages !== null && targetPage >= result.totalPages);
  } catch {
    // reset 失败置错误态；追加失败不置（van-list 会自动重试本次加载）
    if (mode === 'reset' && rows.value.length === 0) {
      error.value = true;
    } else if (mode === 'more') {
      finished.value = true;
    }
  } finally {
    loading.value = false;
  }
};

/** 板块分组 Tabs 绑定下标（van-tabs 的 active 是 index，这里做 index ↔ board key 互转） */
const activeBoardIndex = computed({
  get: () => Math.max(0, boards.findIndex((b) => b.board === board.value)),
  set: (index: number) => onBoardChange(boards[index]!.board),
});

/**
 * 切换板块：清空重置回第 1 页（标题滚动由 van-tabs 自带）
 * @param next 目标板块
 */
const onBoardChange = (next: ThsStockBoard): void => {
  if (board.value === next) return;
  board.value = next;
  rows.value = [];
  page.value = 1;
  finished.value = false;
  error.value = false;
  void loadPage('reset');
};

// 首屏
void loadPage('reset');

/** 30s 前台轮询（间隔持久化于 useMobilePolling）：静默重拉第 1 页替换（不打断滚动位置） */
useMobilePolling(() => {
  if (page.value === 1 && !loading.value) {
    void loadPage('reset');
  }
});

/** 刷新（2026-10-30 起改由 navbar 刷新按钮触发，不再下拉刷新）：重置回第 1 页。
 * 刷新中按钮图标旋转并防重入 */
const navRefreshing = ref(false);
const refreshAll = async (): Promise<void> => {
  if (navRefreshing.value) return;
  navRefreshing.value = true;
  try {
    await loadPage('reset');
  } finally {
    navRefreshing.value = false;
  }
};

/**
 * 行点击 → 个股详情（6 位代码归一化 sh/sz/bj 完整符号）：
 * lg 档写右栏窗格就地阅读，窄档 / 竖屏整页跳转
 * @param code 6 位代码
 */
const goStock = (code: string): void => {
  const symbol = toFullSymbol(code);
  if (!symbol) return;
  if (lg.value) {
    openStock(symbol);
    return;
  }
  void router.push(`/stock/${symbol}`);
};

/* === 格式化 === */
const fmtPx = (v: number | null): string => (v === null ? '--' : v.toFixed(2));
const fmtPct = (v: number | null): string => (v === null ? '--' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      title="个股行情"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    >
      <template #right>
        <van-icon
          name="replay"
          size="19"
          class="m-nav-refresh"
          :class="{ 'm-nav-refresh--spinning': navRefreshing }"
          @click="refreshAll"
        />
      </template>
    </van-nav-bar>

    <!-- lg 主从布局（稿 S7）：左全量列表 + 右个股详情窗格 -->
    <div class="m-duo">
      <div class="m-duo__l">
        <!-- 板块分组 Tabs（参考今天炒什么：van-tabs 选择器模式，空 van-tab 只当分段选择器；
             不用 animated——内容面板不在此组件内，指示条位移已足够） -->
        <van-tabs
          v-model:active="activeBoardIndex"
          class="m-tabs m-tabs--selector"
          :ellipsis="false"
        >
          <van-tab v-for="item in boards" :key="item.board" :title="item.label" />
        </van-tabs>

        <div class="m-sub-scroll">
          <div class="m-card">
            <!-- 字段头（移动端不做表头排序） -->
            <div class="m-sm-rowhead">
              <span class="nm">名称</span>
              <span class="num">现价</span>
              <span class="num">涨跌幅</span>
              <span class="num">成交额</span>
              <span class="num">换手</span>
            </div>

            <div v-if="error" class="m-state">
              个股行情加载失败
              <span class="retry" @click="loadPage('reset')">重试</span>
            </div>
            <div v-else-if="rows.length === 0 && loading" class="m-skel-fill">
              <div v-for="i in 10" :key="i" class="m-skel-row"></div>
            </div>
            <div v-else-if="rows.length === 0" class="m-state">暂无数据</div>

            <!-- van-list 上拉加载：每页 20 条（与上游单页条数一致） -->
            <van-list
              v-else
              v-model:loading="loading"
              :finished="finished"
              finished-text="已加载全部"
              loading-text="加载中…"
              @load="() => loadPage('more')"
            >
              <div
                v-for="row in rows"
                :key="row.code"
                class="m-sm-row"
                :class="{ 'm-row--pane': paneSymbol === toFullSymbol(row.code) }"
                @click="goStock(row.code)"
              >
                <span class="nm">
                  <b>{{ row.name }}</b>
                  <i>{{ row.code }}</i>
                </span>
                <span class="num m-num">{{ fmtPx(row.price) }}</span>
                <span class="num m-num" :class="pctClass(row.changePercent)">{{ fmtPct(row.changePercent) }}</span>
                <span class="num m-num muted">{{ row.amountText }}</span>
                <span class="num m-num muted">
                  {{ row.turnoverRate === null ? '--' : `${row.turnoverRate.toFixed(2)}%` }}
                </span>
              </div>
            </van-list>
          </div>

          <div class="m-home-tail"></div>
        </div>
      </div>
      <!-- 右窗格仅选中个股时渲染（2026-10-31 王总指定「选中才显示右边栏」），未选中左栏铺满 -->
      <aside v-if="lg && paneOpen" class="m-duo__r">
        <StockDetailPane :symbol="paneSymbol" @close="closePane" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
/* 列表行：5 列 grid，名称列自适应、数值列等宽右对齐（与成分股弹窗同构） */
.m-sm-rowhead,
.m-sm-row {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) repeat(4, minmax(0, 1fr));
  align-items: center;
  gap: 6px;
  padding: 9px 16px;
  border-bottom: 1px solid var(--color-border);
}
.m-sm-rowhead {
  font-size: 11px;
  color: var(--color-text-3);
  padding-bottom: 7px;
}
.m-sm-row { cursor: pointer; }
.m-sm-row:active { background: var(--color-flat-weak); }
.m-sm-row .nm { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.m-sm-row .nm b { font-size: 13px; font-weight: 600; color: var(--color-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.m-sm-row .nm i { font-style: normal; font-size: 10px; color: var(--color-text-3); font-family: var(--font-num); }
.m-sm-row .num, .m-sm-rowhead .num { text-align: right; font-size: 12px; }
.m-sm-rowhead .num { font-size: 11px; }
.muted { color: var(--color-text-2); }
</style>

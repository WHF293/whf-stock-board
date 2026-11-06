<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BaseButton from '../components/ui/BaseButton.vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import BaseTabs from '../components/ui/BaseTabs.vue';
import MenuIcon from '../components/ui/MenuIcon.vue';
import { fetchThsStockBoardPage } from '../../common/api/ths-stock-board.api.ts';
import {
  THS_POLLING_INTERVAL,
  THS_STOCK_BOARD_PAGE_SIZE,
  THS_STOCK_BOARD_TABS,
  type ThsStockBoard,
  type ThsStockBoardField,
} from '../../common/constants/ths-market.constants.ts';
import { usePolling } from '../../common/composables/use-polling';
import { useStockOpen } from '../../common/composables/use-stock-open';
import {
  PAGE_HEADER_ACTIONS_TARGET,
  usePageHeaderSlot,
} from '../../common/composables/use-page-header-slot';
import type { ThsStockRow } from '../../common/types/ths-market.types.ts';

/**
 * 大A个股（原 PC /stock-market 独立页 → 2026-10-22 并入行情全景「全部个股」页签 →
 * 2026-11-06 王总指定随行情全景拆分恢复独立页，/stock-market 路径沿用；
 * 页面入口在盘面雷达页头「大A个股」按钮）
 *
 * 数据源：同花顺行情中心 ajax HTML 片段（fetchThsStockBoardPage，GBK，服务端排序 + 翻页）。
 * - 板块 Tab：全部 / 沪市A股 / 深市A股 / 北交所 / 创业板 / 科创板
 * - 排序：数值列表头点击 → 服务端 field/order 参数（点新列默认降序、同列翻转），
 *   翻页后排序全局有效
 * - 行点击 → 右侧停靠面板个股详情（全站统一落点）
 * - 30s 前台轮询当前页（tradingAware，页面隐藏即停；失败 → 错误态手动重试）
 */
const { openSidebar, openPage, toContextList } = useStockOpen();

// ---------- 单击 / 双击合并派发（与 BaseTable enableDblclickNav 同窗口） ----------
// 单击 = 右侧个股侧栏；双击 = 个股详情整页（携带当前页行列表，详情页左侧可切换同批股票）

/** 单击合并窗口（毫秒），与 BaseTable 口径一致 */
const DBLCLICK_MERGE_MS = 250;
/** 挂起的单击定时器（null = 无待派发单击） */
let pendingClickTimer: number | null = null;

/**
 * 行单击：延迟派发开侧栏，窗口内收到双击则取消
 * @param row 行数据
 */
const onRowClick = (row: ThsStockRow): void => {
  if (pendingClickTimer !== null) {
    window.clearTimeout(pendingClickTimer);
  }
  pendingClickTimer = window.setTimeout(() => {
    pendingClickTimer = null;
    openSidebar(row.code, toContextList(rows.value, (item) => item.code));
  }, DBLCLICK_MERGE_MS);
};

/**
 * 行双击：取消未派发的单击，跳详情整页（携带当前页行列表）
 * @param row 行数据
 */
const onRowDblclick = (row: ThsStockRow): void => {
  if (pendingClickTimer !== null) {
    window.clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
  }
  openPage(row.code, toContextList(rows.value, (item) => item.code));
};

/** 板块 Tab 选项（BaseTabs 要求字符串 value） */
const boardTabOptions = THS_STOCK_BOARD_TABS.map((tab) => ({
  label: tab.label,
  value: tab.board,
}));

/** 当前板块 */
const board = ref<ThsStockBoard>('all');
/** 当前排序字段（默认涨跌幅降序，与同花顺默认序一致） */
const sortField = ref<ThsStockBoardField>('changePercent');
/** 当前排序方向 */
const sortOrder = ref<'asc' | 'desc'>('desc');
/** 当前页码（1 起） */
const page = ref(1);

/** 当页行 */
const rows = ref<ThsStockRow[]>([]);
/** 总页数（片段分页器解析；null 时翻页按钮按有下一页处理） */
const totalPages = ref<number | null>(null);
const loading = ref(false);
const error = ref(false);

/** 拉取当前板块 / 排序 / 页码的数据 */
const load = async (): Promise<void> => {
  if (loading.value) return;
  loading.value = true;
  try {
    const result = await fetchThsStockBoardPage({
      board: board.value,
      field: sortField.value,
      order: sortOrder.value,
      page: page.value,
    });
    rows.value = result.rows;
    totalPages.value = result.totalPages;
    error.value = false;
  } catch (err) {
    // 首载 / 参数切换失败置错误态；轮询间隙抖动保留旧数据
    if (rows.value.length === 0) {
      error.value = true;
    }
    console.error('[stock-market] 拉取失败', err);
  } finally {
    loading.value = false;
  }
};

usePolling({ task: load, intervalMs: THS_POLLING_INTERVAL.STOCK_BOARD, tradingAware: true });
onMounted(() => {
  void load();
});

// 页头手动刷新（原由行情全景宿主调用 expose，2026-11-06 拆分独立页后本页自带刷新按钮）：
// 重拉当前板块 / 排序 / 页码（load 内部有防重入）
const onManualRefresh = (): void => {
  void load();
};

/** 页头挂载守卫（KeepAlive 缓存页：激活才投射，防按钮残留）——刷新按钮上移页头用 */
const { active: headerSlotActive } = usePageHeaderSlot();

// 板块 / 排序变化：重置回第 1 页并立即拉取
watch([board, sortField, sortOrder], () => {
  page.value = 1;
  void load();
});

/**
 * 点击表头排序：同列翻转升降，新列默认降序
 * @param field 排序字段
 */
const onHeaderSort = (field: ThsStockBoardField): void => {
  if (sortField.value === field) {
    sortOrder.value = sortOrder.value === 'desc' ? 'asc' : 'desc';
  } else {
    sortField.value = field;
    sortOrder.value = 'desc';
  }
};

/**
 * 表头排序标记（未排序 ↕ / 降序 ↓ / 升序 ↑）
 * @param field 排序字段
 * @returns 标记字符
 */
const sortMark = (field: ThsStockBoardField): string => {
  if (sortField.value !== field) return '↕';
  return sortOrder.value === 'desc' ? '↓' : '↑';
};

/* === 翻页 === */
const hasPrev = computed(() => page.value > 1);
const hasNext = computed(() =>
  totalPages.value === null ? true : page.value < totalPages.value,
);
const pageText = computed(() =>
  totalPages.value === null ? `第 ${page.value} 页` : `第 ${page.value} / ${totalPages.value} 页`,
);

/** 上一页 */
const goPrev = (): void => {
  if (hasPrev.value && !loading.value) {
    page.value -= 1;
    void load();
  }
};

/** 下一页 */
const goNext = (): void => {
  if (hasNext.value && !loading.value) {
    page.value += 1;
    void load();
  }
};

/**
 * 行点击 → 停靠面板个股详情（6 位代码归一化由 useStockOpen 处理；见上方合并派发注释）
 */
/* === 列定义（服务端排序；label 与同花顺原页对齐） === */
interface ColumnDef {
  key: keyof ThsStockRow;
  label: string;
  sortable: boolean;
  align: 'left' | 'right';
}

const COLUMNS: readonly ColumnDef[] = [
  { key: 'seq', label: '序号', sortable: false, align: 'left' },
  { key: 'code', label: '代码', sortable: false, align: 'left' },
  { key: 'name', label: '名称', sortable: false, align: 'left' },
  { key: 'price', label: '现价', sortable: true, align: 'right' },
  { key: 'changePercent', label: '涨跌幅%', sortable: true, align: 'right' },
  { key: 'change', label: '涨跌', sortable: true, align: 'right' },
  { key: 'speed', label: '涨速%', sortable: true, align: 'right' },
  { key: 'turnoverRate', label: '换手%', sortable: true, align: 'right' },
  { key: 'volumeRatio', label: '量比', sortable: true, align: 'right' },
  { key: 'amplitude', label: '振幅%', sortable: true, align: 'right' },
  { key: 'amountText', label: '成交额', sortable: true, align: 'right' },
  { key: 'floatSharesText', label: '流通股', sortable: true, align: 'right' },
  { key: 'floatMarketCapText', label: '流通市值', sortable: true, align: 'right' },
  { key: 'peText', label: '市盈率', sortable: true, align: 'right' },
];

/**
 * 数值格式化（null → 「--」占位）
 * @param v 数值原值
 * @returns 展示文案
 */
const numText = (v: number | null): string => (v === null ? '--' : String(v));

/** 涨跌着色列（涨跌幅 / 涨跌 / 涨速；其余中性） */
const TREND_KEYS = new Set<string>(['changePercent', 'change', 'speed']);

const cellCls = (col: ColumnDef, row: ThsStockRow): string => {
  if (!TREND_KEYS.has(col.key)) return 'text-text';
  const v = row[col.key];
  if (typeof v !== 'number' || v === 0) return 'text-text-tertiary';
  return v > 0 ? 'text-up' : 'text-down';
};
</script>

<template>
  <div class="flex h-full min-h-0 flex-col gap-4">
    <!-- 提示为辅助信息：容器过窄（抽屉打开挤主区）时整体隐藏，避免被挤成一字一行竖排 -->
    <div class="flex shrink-0 items-center justify-end">
      <span class="hidden shrink-0 text-xs text-text-tertiary @4xl:block">未开盘时展示最近交易日收盘数据</span>
    </div>

    <!-- 手动刷新上移 MainLayout 页头（原行情全景 2026-11-02 王总指定）：重拉当前板块 / 排序 / 页码，拉取中图标旋转 -->
    <Teleport v-if="headerSlotActive" :to="PAGE_HEADER_ACTIONS_TARGET">
      <BaseButton variant="ghost" :disabled="loading" @click="onManualRefresh">
        <MenuIcon name="refresh" :size="14" :class="{ 'animate-spin': loading }" />
        {{ loading ? '刷新中…' : '刷新' }}
      </BaseButton>
    </Teleport>

    <!-- fill + table-scroll-fill 高度链（2026-11-03 王总指定去外层滚动条）：
       卡片吃满剩余高度，表格吃掉「卡高 - 头部/分页」，只有表格滚动 -->
    <BaseCard title="全部个股" fill class="min-h-0 flex-1">
      <template #extra>
        <div class="flex items-center gap-3">
          <span class="text-xs text-text-tertiary">共 {{ THS_STOCK_BOARD_PAGE_SIZE }} 条/页 · 30s 轮询</span>
          <BaseTabs v-model="board" :options="boardTabOptions" />
        </div>
      </template>

      <div v-if="error" class="py-10">
        <BaseEmpty text="个股行情加载失败，请稍后重试（上游可能限频）" />
        <div class="mt-3 text-center">
          <button
            type="button"
            class="pressable rounded-lg px-3 py-1.5 text-sm text-primary hover:bg-primary-weak"
            @click="load"
          >
            重试
          </button>
        </div>
      </div>
      <BaseSkeleton v-else-if="rows.length === 0" />

      <template v-else>
        <div class="table-scroll-fill">
          <table class="w-full text-sm tabular-nums" style="min-width: 960px">
            <thead>
              <tr class="border-b border-flat-weak text-left text-xs text-text-tertiary">
                <th
                  v-for="col in COLUMNS"
                  :key="col.key"
                  class="whitespace-nowrap py-2 pr-2 font-medium last:pr-0"
                  :class="[
                    col.align === 'right' ? 'text-right' : '',
                    col.sortable ? 'cursor-pointer select-none hover:text-text' : '',
                  ]"
                  @click="col.sortable ? onHeaderSort(col.key as ThsStockBoardField) : undefined"
                >
                  {{ col.label }}
                  <span v-if="col.sortable" class="ml-0.5 inline-block text-[10px]">
                    {{ sortMark(col.key as ThsStockBoardField) }}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in rows"
                :key="row.code"
                class="cursor-pointer border-b border-flat-weak last:border-0 hover:bg-flat-weak/50"
                @click="onRowClick(row)"
                @dblclick="onRowDblclick(row)"
              >
                <td
                  v-for="col in COLUMNS"
                  :key="col.key"
                  class="whitespace-nowrap py-2 pr-2 last:pr-0"
                  :class="col.align === 'right' ? 'text-right' : ''"
                >
                  <template v-if="col.key === 'code'">
                    <span class="text-xs text-text-tertiary">{{ row.code }}</span>
                  </template>
                  <template v-else-if="col.key === 'name'">
                    <span class="font-medium text-text">{{ row.name }}</span>
                  </template>
                  <template v-else-if="typeof row[col.key] === 'number' || row[col.key] === null">
                    <span :class="cellCls(col, row)">{{ numText(row[col.key] as number | null) }}</span>
                  </template>
                  <template v-else>
                    <span class="text-text-secondary">{{ row[col.key] as string }}</span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <!-- 分页器：服务端翻页（每页 20 条，与上游单页条数一致） -->
        <div class="mt-3 flex shrink-0 items-center justify-end gap-3 text-sm">
          <span class="text-xs text-text-tertiary">{{ pageText }}</span>
          <button
            type="button"
            class="pressable rounded-lg border border-flat-weak px-3 py-1 text-text-secondary hover:bg-flat-weak hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!hasPrev || loading"
            @click="goPrev"
          >
            上一页
          </button>
          <button
            type="button"
            class="pressable rounded-lg border border-flat-weak px-3 py-1 text-text-secondary hover:bg-flat-weak hover:text-text disabled:cursor-not-allowed disabled:opacity-40"
            :disabled="!hasNext || loading"
            @click="goNext"
          >
            下一页
          </button>
        </div>
      </template>
    </BaseCard>
  </div>
</template>

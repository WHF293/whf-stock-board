<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import BaseCard from '../components/ui/BaseCard.vue';
import BaseEmpty from '../components/ui/BaseEmpty.vue';
import BaseSkeleton from '../components/ui/BaseSkeleton.vue';
import { fetchThsHkBoardPage } from '../../common/api/ths-hk-board.api.ts';
import {
  THS_POLLING_INTERVAL,
  THS_HK_STOCK_BOARD_PAGE_SIZE,
  type ThsHkStockBoardField,
} from '../../common/constants/ths-market.constants.ts';
import { usePolling } from '../../common/composables/use-polling';
import { useStockOpen } from '../../common/composables/use-stock-open';
import type { ThsHkStockRow } from '../../common/types/ths-market.types.ts';

/**
 * 港股个股（行情全景子 tab，2026-10-30 王总指定；「全部个股」改名「大A个股」后并列新增）
 *
 * 数据源：同花顺港股行情中心 ajax HTML 片段（fetchThsHkBoardPage，GBK，
 * 服务端排序 + 翻页，board 仅 all 一档、每页 50 行，全市场 ≈2600 只）。
 * - 排序：数值列表头点击 → 服务端 field/order 参数（点新列默认降序、同列翻转），
 *   翻页后排序全局有效
 * - 行点击 → 右侧停靠面板个股详情（代码已归一化为 hk02715 形态，全站统一落点）
 * - 30s 前台轮询当前页（tradingAware，港股窗口 09:30-16:00；失败 → 错误态手动重试）
 */
const { openSidebar } = useStockOpen();

/** 当前排序字段（默认涨跌幅降序，与 A 股全部个股视图一致） */
const sortField = ref<ThsHkStockBoardField>('changePercent');
/** 当前排序方向 */
const sortOrder = ref<'asc' | 'desc'>('desc');
/** 当前页码（1 起） */
const page = ref(1);

/** 当页行 */
const rows = ref<ThsHkStockRow[]>([]);
/** 总页数（片段分页器解析；null 时翻页按钮按有下一页处理） */
const totalPages = ref<number | null>(null);
const loading = ref(false);
const error = ref(false);

/** 拉取当前排序 / 页码的数据 */
const load = async (): Promise<void> => {
  if (loading.value) return;
  loading.value = true;
  try {
    const result = await fetchThsHkBoardPage({
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
    console.error('[hk-market] 拉取失败', err);
  } finally {
    loading.value = false;
  }
};

usePolling({
  task: load,
  intervalMs: THS_POLLING_INTERVAL.STOCK_BOARD,
  tradingAware: true,
  market: 'HK',
});
onMounted(() => {
  void load();
});

// 排序变化：重置回第 1 页并立即拉取
watch([sortField, sortOrder], () => {
  page.value = 1;
  void load();
});

/**
 * 点击表头排序：同列翻转升降，新列默认降序
 * @param field 排序字段
 */
const onHeaderSort = (field: ThsHkStockBoardField): void => {
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
const sortMark = (field: ThsHkStockBoardField): string => {
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
 * 行点击 → 停靠面板个股详情（hk02715 形态符号，openSidebar 原样透传）
 * @param row 行数据
 */
const onRowClick = (row: ThsHkStockRow): void => {
  openSidebar(row.code);
};

/* === 列定义（服务端排序；label 与同花顺港股页 13 列对齐） === */
interface ColumnDef {
  key: keyof ThsHkStockRow;
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
  { key: 'turnoverRate', label: '换手%', sortable: true, align: 'right' },
  { key: 'volumeText', label: '成交量', sortable: true, align: 'right' },
  { key: 'peText', label: '市盈率', sortable: true, align: 'right' },
  { key: 'prevClose', label: '昨收', sortable: true, align: 'right' },
  { key: 'open', label: '开盘价', sortable: true, align: 'right' },
  { key: 'high', label: '最高价', sortable: true, align: 'right' },
  { key: 'low', label: '最低价', sortable: true, align: 'right' },
];

/**
 * 数值格式化（null → 「--」占位）
 * @param v 数值原值
 * @returns 展示文案
 */
const numText = (v: number | null): string => (v === null ? '--' : String(v));

/** 涨跌着色列（涨跌幅 / 涨跌；其余中性） */
const TREND_KEYS = new Set<string>(['changePercent', 'change']);

const cellCls = (col: ColumnDef, row: ThsHkStockRow): string => {
  if (!TREND_KEYS.has(col.key)) return 'text-text';
  const v = row[col.key];
  if (typeof v !== 'number' || v === 0) return 'text-text-tertiary';
  return v > 0 ? 'text-up' : 'text-down';
};
</script>

<template>
  <BaseCard title="港股个股">
    <template #extra>
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-tertiary">共 {{ THS_HK_STOCK_BOARD_PAGE_SIZE }} 条/页 · 30s 轮询</span>
      </div>
    </template>

    <div v-if="error" class="py-10">
      <BaseEmpty text="港股个股行情加载失败，请稍后重试（上游可能限频）" />
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
      <div class="table-scroll">
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
                @click="col.sortable ? onHeaderSort(col.key as ThsHkStockBoardField) : undefined"
              >
                {{ col.label }}
                <span v-if="col.sortable" class="ml-0.5 inline-block text-[10px]">
                  {{ sortMark(col.key as ThsHkStockBoardField) }}
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

      <!-- 分页器：服务端翻页（每页 50 条，与上游单页条数一致） -->
      <div class="mt-3 flex items-center justify-end gap-3 text-sm">
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
</template>

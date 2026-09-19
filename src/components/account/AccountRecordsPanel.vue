<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTable from '../ui/BaseTable.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { listTradeRecords } from '../../api/account-records-db.api';
import {
  exportRowsToExcel,
  summarizeRecords,
  TRADE_DETAIL_COLUMNS,
  TRADE_SUMMARY_COLUMNS,
} from '../../utils/export-excel';
import type { AccountTradeRecord, ImportKind } from '../../types/account.types';
import type { TableColumn } from '../../types/table.types';
import { useStockOpen } from '../../composables/use-stock-open';

/**
 * 账户成交流水面板（交割单 / 对账单）
 *
 * - 一级按钮组【对账单 / 交割单】：切换数据来源表
 * - 二级按钮组【全部 / 按股票汇总 / 按月汇总】：全部 = 明细平铺；
 *   汇总视图 = 汇总头 + 展开显示组内明细（点击行或 chevron 均可展开）
 * - 每个表格块右上角【导出 excel】：导出当前块所显示的数据
 */
const props = defineProps<{
  /** 账户 id（空则不加载） */
  accountId: string;
}>();

/** 数据来源：statement 对账单 / trade 交割单（默认对账单，与按钮组顺序一致） */
const recordKind = ref<ImportKind>('statement');

/** 展示模式 */
const VIEW_MODE = {
  ALL: 'all',
  BY_STOCK: 'stock',
  BY_MONTH: 'month',
} as const;

/** 展示模式选项 */
const VIEW_MODE_OPTIONS = [
  { label: '全部', value: VIEW_MODE.ALL },
  { label: '按股票汇总', value: VIEW_MODE.BY_STOCK },
  { label: '按月汇总', value: VIEW_MODE.BY_MONTH },
] as const;

/** 当前展示模式 */
const viewMode = ref<string>(VIEW_MODE.ALL);

/** 流水数据 */
const records = ref<AccountTradeRecord[]>([]);

/** 加载态 / 错误态 */
const isLoading = ref(false);
const loadError = ref(false);

// 账户或来源切换时重新加载
watch(
  () => [props.accountId, recordKind.value] as const,
  async ([accountId]) => {
    if (!accountId) {
      records.value = [];
      return;
    }
    isLoading.value = true;
    loadError.value = false;
    try {
      records.value = await listTradeRecords(accountId, recordKind.value);
    } catch (error) {
      console.error('[account-records] load', error);
      loadError.value = true;
      records.value = [];
    } finally {
      isLoading.value = false;
    }
  },
  { immediate: true },
);

/** 明细表列定义（两处明细表共用；数值列右对齐） */
const RIGHT_ALIGNED = new Set([
  'quantity',
  'price',
  'amount',
  'netAmount',
  'stampTax',
  'commission',
  'transferFee',
  'entrustFee',
  'serviceFee',
]);
const detailColumns: TableColumn<AccountTradeRecord>[] = TRADE_DETAIL_COLUMNS.map((col) => ({
  key: col.key as string,
  label: col.label,
  align: RIGHT_ALIGNED.has(col.key as string) ? 'right' : undefined,
}));

/** 明细行（key 生成）
 * @param row 明细行
 * @returns 行 key
 */
const recordKey = (row: AccountTradeRecord): string => row.id;

/**
 * 按股票分组（组内按时间升序）
 * @returns 分组列表
 */
const stockGroups = computed(() => {
  const bySymbol = new Map<string, AccountTradeRecord[]>();
  for (const record of records.value) {
    const list = bySymbol.get(record.symbol) ?? [];
    list.push(record);
    bySymbol.set(record.symbol, list);
  }
  return [...bySymbol.entries()].map(([symbol, groupRecords]) => ({
    key: symbol,
    summary: summarizeRecords(groupRecords, groupRecords[0]?.stockName || symbol),
    records: groupRecords,
  }));
});

/**
 * 按月分组（YYYY-MM）
 * @returns 分组列表
 */
const monthGroups = computed(() => {
  const byMonth = new Map<string, AccountTradeRecord[]>();
  for (const record of records.value) {
    const month = record.tradeDate.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(record);
    byMonth.set(month, list);
  }
  return [...byMonth.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([month, groupRecords]) => ({
      key: month,
      summary: summarizeRecords(groupRecords, month),
      records: groupRecords,
    }));
});

/** 当前汇总分组（按股票 / 按月共用渲染） */
const activeGroups = computed(() =>
  viewMode.value === VIEW_MODE.BY_MONTH ? monthGroups.value : stockGroups.value,
);

/** 展开的分组 key（同时只展开一个，避免长列表全展开难管理） */
const expandedGroupKey = ref<string | null>(null);

/**
 * 切换分组展开
 * @param key 分组 key
 */
const onToggleGroup = (key: string): void => {
  expandedGroupKey.value = expandedGroupKey.value === key ? null : key;
};

// ---------- 按股票汇总：股票名称单击开抽屉 / 双击开详情页（全站统一交互） ----------
const { openSidebar, openPage, toContextList } = useStockOpen();

/**
 * 按股票分组的上下文列表（供详情页左侧列表一键切换同批股票）
 * @returns 上下文股票列表
 */
const stockContextList = () =>
  toContextList(
    stockGroups.value.map((group) => ({ symbol: group.key, name: group.summary.name })),
    (row) => row.symbol,
  );

/** 股票名称单击挂起的定时器（沿用 BaseTable enableDblclickNav 的合并口径） */
let pendingNameClick: number | null = null;

/** 单击/双击合并窗口（毫秒；与 BaseTable 同款） */
const NAME_CLICK_MERGE_MS = 250;

/**
 * 股票名称单击：延迟开抽屉，窗口内收到双击则取消
 * @param key 分组 key（按股票汇总 = 6 位纯代码）
 */
const onNameClick = (key: string): void => {
  if (viewMode.value !== VIEW_MODE.BY_STOCK) return;
  if (pendingNameClick !== null) {
    window.clearTimeout(pendingNameClick);
  }
  pendingNameClick = window.setTimeout(() => {
    pendingNameClick = null;
    openSidebar(key, stockContextList());
  }, NAME_CLICK_MERGE_MS);
};

/**
 * 股票名称双击：取消未派发的单击，直接跳股票详情整页
 * @param key 分组 key（按股票汇总 = 6 位纯代码）
 */
const onNameDblclick = (key: string): void => {
  if (viewMode.value !== VIEW_MODE.BY_STOCK) return;
  if (pendingNameClick !== null) {
    window.clearTimeout(pendingNameClick);
    pendingNameClick = null;
  }
  openPage(key, stockContextList());
};

/**
 * 导出明细行
 * @param rows 明细行
 * @param suffix 文件名后缀
 */
const onExportDetail = (rows: AccountTradeRecord[], suffix: string): void => {
  void exportRowsToExcel(
    rows as unknown as Record<string, unknown>[],
    TRADE_DETAIL_COLUMNS,
    `账户-${props.accountId}-${recordKind.value === 'trade' ? '交割单' : '对账单'}-${suffix}`,
  );
};

/** 导出汇总行 */
const onExportSummary = (): void => {
  void exportRowsToExcel(
    activeGroups.value.map((group) => group.summary as unknown as Record<string, unknown>),
    TRADE_SUMMARY_COLUMNS,
    `账户-${props.accountId}-汇总-${viewMode.value === VIEW_MODE.BY_MONTH ? '按月' : '按股票'}`,
  );
};
</script>

<template>
  <!-- 卡片 fill 模式下的内容列：工具条内容高，表格区吃剩余高度（高度链见 theme.css table-scroll-fill） -->
  <div class="flex min-h-0 flex-1 flex-col gap-3">
    <!-- 一级：数据来源 / 二级：展示模式 -->
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2">
      <BaseTabs
        v-model="recordKind" :options="[
          { label: '对账单', value: 'statement' },
          { label: '交割单', value: 'trade' },
        ]"
      />
      <div class="flex items-center gap-2">
        <BaseTabs v-model="viewMode" :options="VIEW_MODE_OPTIONS" />
        <BaseButton
          variant="ghost"
          :disabled="viewMode === VIEW_MODE.ALL ? records.length === 0 : activeGroups.length === 0"
          @click="viewMode === VIEW_MODE.ALL ? onExportDetail(records, '全部') : onExportSummary()"
        >
          <MenuIcon name="tradeImport" :size="14" />
          导出excel
        </BaseButton>
      </div>
    </div>

    <BaseSkeleton v-if="isLoading" />
    <BaseEmpty
      v-else-if="loadError"
      text="流水加载失败，请稍后重试"
    />
    <BaseEmpty
      v-else-if="records.length === 0"
      :text="`暂无${recordKind === 'trade' ? '交割单' : '对账单'}数据：点击上方「导入」按钮上传同花顺导出文件`"
    />

    <!-- 全部：明细平铺（单滚动容器：表格自己吃满剩余高度，滚动不外溢） -->
    <template v-else-if="viewMode === VIEW_MODE.ALL">
      <BaseTable
        :columns="detailColumns"
        :rows="records"
        :row-key="recordKey"
        min-width="1200px"
        scroll-class="table-scroll-fill"
      >
        <template #quantity="{ row }">
          <span :class="row.quantity >= 0 ? 'text-up' : 'text-down'">
            {{ row.quantity }}
          </span>
        </template>
      </BaseTable>
    </template>

    <!-- 汇总视图：单卡片紧凑列表（分组头行 + 展开的组内明细表），行距比普通表格略高；
         列表自身吃满卡片剩余高度并滚动，页面不出滚动条 -->
    <template v-else>
      <BaseCard fill class="min-h-0 flex-1 overflow-hidden p-0">
        <div class="table-scroll-fill divide-y divide-flat-weak">
          <div v-for="group in activeGroups" :key="group.key">
            <!-- 分组头：汇总行（整行可点） -->
            <button
              type="button"
              class="flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-flat-weak/50"
              @click="onToggleGroup(group.key)"
            >
              <MenuIcon
                :name="expandedGroupKey === group.key ? 'chevronDown' : 'chevronRight'"
                :size="14"
                class="shrink-0 text-text-tertiary"
              />
              <!-- 股票名称：按股票汇总时可单击开抽屉 / 双击开详情页（阻止冒泡，不触发行展开） -->
              <span
                class="truncate text-sm font-medium text-text"
                :class="
                  viewMode === VIEW_MODE.BY_STOCK
                    ? 'cursor-pointer hover:text-primary'
                    : ''
                "
                :title="
                  viewMode === VIEW_MODE.BY_STOCK
                    ? '单击查看详情抽屉 / 双击打开详情页'
                    : undefined
                "
                @click.stop="onNameClick(group.key)"
                @dblclick.stop="onNameDblclick(group.key)"
              >
                {{ group.summary.name }}
              </span>
              <span class="shrink-0 text-xs text-text-tertiary">{{ group.summary.count }} 笔</span>
              <span class="shrink-0 text-xs tabular-nums text-text-secondary">
                买 {{ group.summary.buyAmount.toFixed(0) }} / 卖 {{ group.summary.sellAmount.toFixed(0) }}
              </span>
              <span
                class="ml-auto shrink-0 text-xs tabular-nums"
                :class="group.summary.netAmount >= 0 ? 'text-up' : 'text-down'"
              >
                净 {{ group.summary.netAmount >= 0 ? '+' : '' }}{{ group.summary.netAmount.toFixed(2) }}
              </span>
            </button>

            <!-- 组内明细表（含独立的导出按钮） -->
            <div v-if="expandedGroupKey === group.key" class="border-t border-flat-weak px-4 py-3">
              <div class="mb-2 flex justify-end">
                <BaseButton
                  variant="ghost"
                  @click="onExportDetail(group.records, group.summary.name)"
                >
                  <MenuIcon name="tradeImport" :size="14" />
                  导出excel
                </BaseButton>
              </div>
              <div class="table-scroll" style="max-height: 40vh">
                <BaseTable
                  :columns="detailColumns"
                  :rows="group.records"
                  :row-key="recordKey"
                  min-width="1200px"
                  scroll-class="table-scroll"
                >
                  <template #quantity="{ row }">
                    <span :class="row.quantity >= 0 ? 'text-up' : 'text-down'">
                      {{ row.quantity }}
                    </span>
                  </template>
                </BaseTable>
              </div>
            </div>
          </div>
        </div>
      </BaseCard>
    </template>
  </div>
</template>

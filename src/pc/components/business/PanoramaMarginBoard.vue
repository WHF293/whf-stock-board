<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import BaseCard from '../ui/BaseCard.vue';
import BaseChart from '../charts/BaseChart.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import BaseTable from '../ui/BaseTable.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_BLUE,
  CHART_LINE_PURPLE,
  CHART_LINE_RED,
  CHART_LINE_TEAL,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../common/constants/chart.constants.ts';
import {
  fetchIndexDailyPct,
  fetchMarginAccount,
  fetchMarginTargets,
  type IndexDailyPctItem,
} from '../../../common/api/margin.api.ts';
import type { MarginTargetItem } from '../../../common/api/margin.api.ts';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { useStockOpen } from '../../../common/composables/use-stock-open';
import type { MarginAccountItem } from 'stock-sdk';
import type { TableColumn } from '../../../common/types/table.types.ts';
import { formatYuan } from '../../../common/utils/format-yuan';
import { formatVolume } from '../../../common/utils/format-volume';
import { handleSdkError } from '../../../common/utils/handle-sdk-error';

/**
 * 融资融券（2026-11-02 王总指定新增，原挂行情全景「融资融券」tab；
 * 2026-11-06 王总指定迁入资金流向页 /board-flow——两融本质属资金域，
 * 组件原样复用，文件名保留 Panorama 前缀仅为最小 diff；数据源 stock-sdk `margin`）
 *
 * - 日期切换：日期选项来自账户统计（accountInfo 按日倒序，取近 60 个交易日），
 *   默认最新一期；切换即拉该日两融标明细（targetList(date)），快照按日期缓存
 * - 顶部摘要：所选交易日的市场两融账户指标（融资余额 / 融券余额 / 买入卖出额 /
 *   担保比例 / 参与投资者数），与市场总览「融资融券」卡同源
 * - 标的表：默认按融资余额降序，列头可排序；行单击 → 右侧个股侧栏，
 *   双击 → 个股详情整页（全站统一交互，双击携带来源列表）
 * - 明细表折叠：2026-11-06 王总指定，展开开关放在曲线「日期范围」按钮左边，
 *   默认收起不渲染表格（数千行明细按需挂载，进页更轻）
 *
 * 数据时效：交易所次一交易日公布两融数据，最新一期通常是上一交易日（正常时效）
 */

const dataCache = useDataCacheStore();
const { openSidebar, openPage, toContextList } = useStockOpen();

/** 日期选项最多回看多少期（账户统计返回全历史，选项太长无意义） */
const DATE_OPTION_COUNT = 60;

/** 账户统计（按日倒序；日期选项与摘要条共用） */
const account = ref<MarginAccountItem[]>(
  dataCache.get<MarginAccountItem[]>(DATA_CACHE_KEY.MARGIN_ACCOUNT) ?? [],
);
/** 当前查看的交易日（空串 = 服务端最新交易日） */
const selectedDate = ref('');
const isLoading = ref(false);
const isError = ref(false);
/** 标的明细（当前所选交易日） */
const targets = ref<MarginTargetItem[]>([]);

/** 日期选项（近 N 期，倒序） */
const dateOptions = computed(() =>
  account.value.slice(0, DATE_OPTION_COUNT).map((item) => ({
    label: item.date,
    value: item.date,
  })),
);

/** 所选交易日的账户统计行（摘要条；最新交易日未传日期时对齐 account[0]） */
const selectedAccount = computed<MarginAccountItem | null>(() => {
  if (account.value.length === 0) return null;
  const date = selectedDate.value || account.value[0].date;
  return account.value.find((item) => item.date === date) ?? null;
});

/**
 * 金额列展示（accountInfo 金额单位实为**亿元**，直接按亿读；见 margin.api.ts 单位口径）
 * @param value 金额（亿元；null / undefined → 「--」）
 * @returns 形如 `23152.77亿` 的文案
 */
const fmtYi = (value: number | null | undefined): string =>
  value === null || value === undefined ? '--' : `${value.toFixed(2)}亿`;

/** 摘要条：标签 + 值（null → 「--」） */
const summaryItems = computed<Array<{ label: string; value: string }>>(() => {
  const row = selectedAccount.value;
  return [
    { label: '融资余额', value: fmtYi(row?.finBalance) },
    { label: '融券余额', value: fmtYi(row?.loanBalance) },
    { label: '融资买入额', value: fmtYi(row?.finBuyAmount) },
    { label: '融券卖出额', value: fmtYi(row?.loanSellAmount) },
    {
      label: '平均维持担保比例',
      value:
        row?.avgGuaranteeRatio === null || row?.avgGuaranteeRatio === undefined
          ? '--'
          : `${row.avgGuaranteeRatio.toFixed(2)}%`,
    },
    {
      label: '参与投资者',
      value:
        row?.investorCount === null || row?.investorCount === undefined
          ? '--'
          : `${(row.investorCount / 10_000).toFixed(2)} 万`,
    },
  ];
});

/** 拉取账户统计（成功写快照；首载后补齐日期选项默认值） */
const loadAccount = async (): Promise<void> => {
  const fresh = await fetchMarginAccount();
  account.value = fresh;
  dataCache.set(DATA_CACHE_KEY.MARGIN_ACCOUNT, fresh);
  // 首载：日期选项就绪后默认选最新一期
  if (selectedDate.value === '' && fresh.length > 0) {
    selectedDate.value = fresh[0].date;
  }
};

/** 拉取当前交易日的两融标明细（成功写快照；date 为空串 = 服务端最新） */
const loadTargets = async (): Promise<void> => {
  const cacheKey = DATA_CACHE_KEY.MARGIN_TARGETS_PREFIX + selectedDate.value;
  const cached = dataCache.get<MarginTargetItem[]>(cacheKey);
  if (cached) {
    targets.value = cached;
    return;
  }
  targets.value = await fetchMarginTargets(selectedDate.value || undefined);
  dataCache.set(cacheKey, targets.value);
};

/** 全量刷新（宿主刷新按钮 / 手动重试共用；进行中防重入） */
const refresh = async (): Promise<void> => {
  if (isLoading.value) return;
  isLoading.value = true;
  isError.value = false;
  try {
    // 指数叠加序列与账户统计并行（内部自吞错误，任一失败不影响主数据）
    await Promise.all([loadAccount(), loadIndexPct()]);
    await loadTargets();
  } catch (error) {
    // 首载失败才置错误态；快照已有的旧数据保留展示
    if (targets.value.length === 0 && account.value.length === 0) {
      isError.value = true;
    }
    console.error('[panorama-margin]', handleSdkError(error));
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  void refresh();
});

// 切日期：重拉该日标的明细（快照命中即秒出，不发请求）
watch(selectedDate, () => {
  if (isLoading.value) return;
  void (async () => {
    try {
      await loadTargets();
    } catch (error) {
      console.error('[panorama-margin] targets', handleSdkError(error));
    }
  })();
});

// 供宿主（行情全景页）「刷新」按钮调用
defineExpose({
  /** 手动刷新（进行中调用共享同一任务，refresh 内部有防重入） */
  refresh,
  /** 拉取中状态（宿主用于按钮旋转动画） */
  loading: isLoading,
});

/* === 标的表 === */

/** 展示行（默认融资余额降序，null 沉底；列头再排序作用于本数组副本） */
const sortedRows = computed<MarginTargetItem[]>(() =>
  [...targets.value].sort((a, b) => (b.finBalance ?? -1) - (a.finBalance ?? -1)),
);

/** 标的表列（金额列右侧对齐，元 → 亿口径展示） */
const columns: TableColumn<MarginTargetItem>[] = [
  { key: 'name', label: '名称' },
  { key: 'code', label: '代码' },
  {
    key: 'finBalance',
    label: '融资余额',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.finBalance ?? -1,
  },
  {
    key: 'finBuyAmount',
    label: '融资买入额',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.finBuyAmount ?? -1,
  },
  {
    key: 'finRepayAmount',
    label: '融资偿还额',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.finRepayAmount ?? -1,
  },
  {
    key: 'loanBalance',
    label: '融券余量',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.loanBalance ?? -1,
  },
  {
    key: 'loanSellVolume',
    label: '融券卖出量',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.loanSellVolume ?? -1,
  },
  {
    key: 'loanRepayVolume',
    label: '融券偿还量',
    align: 'right',
    sortable: true,
    sortValue: (row) => row.loanRepayVolume ?? -1,
  },
];

/**
 * 行 key（代码唯一）
 * @param row 行数据
 * @returns 行 key
 */
const rowKey = (row: MarginTargetItem): string => row.code;

// ---------- 融资余额历史曲线（2026-11-02 王总指定新增；数据 = accountInfo 按日全历史，零新增请求） ----------
//
// 2026-11-02 追加：叠加上证指数 / 创业板指对应交易日的收盘涨跌幅曲线（双 Y 轴，
// 右轴 = 涨跌幅 %），观察两融资金与指数涨跌的同步 / 背离

/** 曲线范围档位（近 N 个交易日；BaseTabs 字符串 value） */
const BALANCE_RANGE_OPTIONS = [
  { label: '30天', value: '30' },
  { label: '60天', value: '60' },
  { label: '90天', value: '90' },
  { label: '180天', value: '180' },
] as const;

/** 曲线当前范围（天） */
const balanceRange = ref<string>('30');

/** 个股明细表是否展开（2026-11-06 王总指定：默认收起，开关在曲线范围按钮左边） */
const isTargetsExpanded = ref(false);

/** 叠加对比的指数（腾讯形态符号 + 展示名 + 曲线色；涨跌幅走右轴） */
const INDEX_OVERLAYS = [
  { symbol: 'sh000001', name: '上证指数', color: CHART_LINE_RED },
  { symbol: 'sz399006', name: '创业板指', color: CHART_LINE_PURPLE },
  { symbol: 'sh000688', name: '科创50', color: CHART_LINE_TEAL },
] as const;

/** 指数涨跌幅序列（key = 腾讯形态符号；快照播种，拉取失败该线缺省不阻塞主曲线） */
const indexPctMap = ref<Record<string, IndexDailyPctItem[]>>({});

/** 拉取叠加指数的日涨跌幅序列（会话快照缓存；失败仅 console，不影响主曲线） */
const loadIndexPct = async (): Promise<void> => {
  await Promise.all(
    INDEX_OVERLAYS.map(async (overlay) => {
      const cacheKey = DATA_CACHE_KEY.MARGIN_INDEX_PCT_PREFIX + overlay.symbol;
      const cached = dataCache.get<IndexDailyPctItem[]>(cacheKey);
      if (cached) {
        indexPctMap.value[overlay.symbol] = cached;
        return;
      }
      try {
        // 180 档 + 基期一根（涨跌幅首点要前收），多取 20 根冗余防停市缺口
        const fresh = await fetchIndexDailyPct(overlay.symbol, 200);
        indexPctMap.value[overlay.symbol] = fresh;
        dataCache.set(cacheKey, fresh);
      } catch (error) {
        console.error(`[panorama-margin] ${overlay.name} 日K取数失败，该叠加线缺省`, error);
      }
    }),
  );
};

/** 融资余额走势（亿；account 倒序存储，切片后反转成升序供图表） */
const balanceChartOption = computed<EChartsCoreOption>(() => {
  const rows = account.value
    .slice(0, Number(balanceRange.value))
    .reverse()
    .filter((row) => row.finBalance !== null);
  // 指数涨跌幅按日期对齐到两融交易日轴（该日无数据 → null 断点）
  const pctSeries = INDEX_OVERLAYS.map((overlay) => {
    const byDate = new Map(
      (indexPctMap.value[overlay.symbol] ?? []).map((item) => [item.date, item.pct]),
    );
    return {
      name: overlay.name,
      data: rows.map((row) => byDate.get(row.date) ?? null),
      color: overlay.color,
    };
  });
  return {
    animation: false,
    legend: {
      top: 0,
      right: 0,
      itemWidth: 14,
      itemHeight: 2,
      textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 },
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as {
          axisValue: string;
          value: number | null;
          marker: string;
          seriesName: string;
        }[];
        if (list.length === 0) return '';
        const lines = list.map((point) => {
          if (point.value === null) return `${point.marker}${point.seriesName}：--`;
          const isPct = point.seriesName !== '融资余额';
          const text = point.value.toLocaleString('zh-CN', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          });
          return `${point.marker}${point.seriesName}：${text}${isPct ? '%' : ' 亿'}`;
        });
        return [list[0].axisValue, ...lines].join('<br/>');
      },
    },
    grid: { left: 8, right: 8, top: 24, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: rows.map((row) => row.date.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        // 左轴：融资余额（亿），scale 自适应量级
        type: 'value',
        scale: true,
        axisLabel: {
          color: CHART_TEXT_COLOR,
          fontSize: 10,
          formatter: (value: number) => value.toLocaleString('zh-CN'),
        },
        splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
      },
      {
        // 右轴：指数收盘涨跌幅（%），与左轴网格线共用（splitLine 关闭防双重网格）
        type: 'value',
        scale: true,
        axisLabel: {
          color: CHART_TEXT_COLOR,
          fontSize: 10,
          formatter: (value: number) => `${value.toFixed(1)}%`,
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '融资余额',
        type: 'line',
        yAxisIndex: 0,
        data: rows.map((row) => row.finBalance),
        showSymbol: false,
        lineStyle: { width: 1.6, color: CHART_LINE_BLUE },
        itemStyle: { color: CHART_LINE_BLUE },
      },
      ...pctSeries.map((series) => ({
        name: series.name,
        type: 'line',
        yAxisIndex: 1,
        data: series.data,
        showSymbol: false,
        lineStyle: { width: 1.2, color: series.color, opacity: 0.85 },
        itemStyle: { color: series.color },
      })),
    ],
  };
});

// ---------- 单击 / 双击合并派发（与 BaseTable enableDblclickNav 同窗口） ----------

/** 单击合并窗口（毫秒），与 BaseTable 口径一致 */
const DBLCLICK_MERGE_MS = 250;
/** 挂起的单击定时器（null = 无待派发单击） */
let pendingClickTimer: number | null = null;

/**
 * 行单击：延迟派发开侧栏，窗口内收到双击则取消
 * @param row 行数据
 */
const onRowClick = (row: MarginTargetItem): void => {
  if (pendingClickTimer !== null) {
    window.clearTimeout(pendingClickTimer);
  }
  pendingClickTimer = window.setTimeout(() => {
    pendingClickTimer = null;
    openSidebar(row.code, toContextList(sortedRows.value, (item) => item.code));
  }, DBLCLICK_MERGE_MS);
};

/**
 * 行双击：取消未派发的单击，跳详情整页（携带当前标的列表，详情页左侧可切换同批股票）
 * @param row 行数据
 */
const onRowDblclick = (row: MarginTargetItem): void => {
  if (pendingClickTimer !== null) {
    window.clearTimeout(pendingClickTimer);
    pendingClickTimer = null;
  }
  openPage(row.code, toContextList(sortedRows.value, (item) => item.code));
};
</script>

<template>
  <BaseCard title="融资融券">
    <template #extra>
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-tertiary">数据滞后一个交易日</span>
        <select
          v-model="selectedDate"
          class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
          aria-label="交易日"
        >
          <option v-for="option in dateOptions" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </div>
    </template>

    <div v-if="isError" class="py-10">
      <BaseEmpty text="融资融券数据加载失败，请稍后重试" />
      <div class="mt-3 text-center">
        <button
          type="button"
          class="pressable rounded-lg px-3 py-1.5 text-sm text-primary hover:bg-primary-weak"
          @click="refresh"
        >
          重试
        </button>
      </div>
    </div>
    <BaseSkeleton v-else-if="isLoading && targets.length === 0" />

    <template v-else>
      <!-- 摘要条：所选交易日的市场两融账户指标 -->
      <dl class="mb-4 flex flex-wrap items-baseline gap-x-6 gap-y-2 text-sm">
        <div v-for="item in summaryItems" :key="item.label" class="flex items-baseline gap-2">
          <dt class="text-xs text-text-tertiary">{{ item.label }}</dt>
          <dd class="font-semibold tabular-nums text-text">{{ item.value }}</dd>
        </div>
      </dl>

      <!-- 融资余额历史曲线（2026-11-02 王总指定新增；范围 30/60/90/180 天切换，
           数据 = accountInfo 按日全历史本地切片，零新增请求） -->
      <div class="mb-4">
        <div class="mb-1 flex items-center justify-between gap-2">
          <p class="text-sm font-semibold text-text">融资余额走势</p>
          <div class="flex items-center gap-2">
            <!-- 个股明细展开/收起（默认收起，2026-11-06 王总指定） -->
            <button
              type="button"
              class="pressable flex items-center rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text"
              :aria-expanded="isTargetsExpanded"
              aria-label="个股明细"
              @click="isTargetsExpanded = !isTargetsExpanded"
            >
              <MenuIcon
                name="chevronDown"
                :size="13"
                class="mr-0.5 transition-transform"
                :class="isTargetsExpanded ? 'rotate-180' : ''"
              />
              个股明细
            </button>
            <BaseTabs v-model="balanceRange" :options="BALANCE_RANGE_OPTIONS" aria-label="曲线范围" />
          </div>
        </div>
        <BaseChart :options="balanceChartOption" :style="{ height: '220px' }" />
      </div>

      <!-- 个股明细表：默认收起，开关在曲线范围按钮左边（2026-11-06 王总指定）；
           v-if 按需挂载，数千行明细收起时不进 DOM -->
      <BaseTable
        v-if="isTargetsExpanded"
        :columns="columns"
        :rows="sortedRows"
        :row-key="rowKey"
        row-clickable
        enable-dblclick-nav
        scroll-class="table-scroll"
        min-width="880px"
        :footer-text="`${selectedAccount?.date ?? ''} · 共 ${sortedRows.length} 只两融标的 · 单击开侧栏 / 双击进详情`"
        @row-click="onRowClick"
        @row-dblclick="onRowDblclick"
      >
        <template #name="{ row }">
          <span class="font-medium text-text">{{ row.name }}</span>
        </template>
        <template #code="{ row }">
          <span class="font-mono text-xs text-text-tertiary">{{ row.code }}</span>
        </template>
        <template #finBalance="{ row }">
          {{ row.finBalance === null ? '--' : formatYuan(row.finBalance) }}
        </template>
        <template #finBuyAmount="{ row }">
          {{ row.finBuyAmount === null ? '--' : formatYuan(row.finBuyAmount) }}
        </template>
        <template #finRepayAmount="{ row }">
          {{ row.finRepayAmount === null ? '--' : formatYuan(row.finRepayAmount) }}
        </template>
        <template #loanBalance="{ row }">
          {{ row.loanBalance === null ? '--' : formatVolume(row.loanBalance / 100) }}
        </template>
        <template #loanSellVolume="{ row }">
          {{ row.loanSellVolume === null ? '--' : formatVolume(row.loanSellVolume / 100) }}
        </template>
        <template #loanRepayVolume="{ row }">
          {{ row.loanRepayVolume === null ? '--' : formatVolume(row.loanRepayVolume / 100) }}
        </template>
      </BaseTable>
    </template>
  </BaseCard>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { EChartsCoreOption } from 'echarts/core';
import {
  CHART_AXIS_LINE_COLOR,
  CHART_LINE_PURPLE,
  CHART_SPLIT_LINE_COLOR,
  CHART_TEXT_COLOR,
} from '../../../../common/constants/chart.constants.ts';
import {
  NORTHBOUND_HISTORY_RANGE_OPTIONS,
} from '../../../../common/constants/northbound.constants.ts';
import { fetchNorthboundHistory } from '../../../../common/api/northbound.api.ts';
import { formatNorthboundAmount } from '../../../../common/utils/format-northbound-amount.ts';
import { readTrendColors } from '../../../../common/utils/trend-colors';
import { toFullSymbol } from '../../../../common/utils/to-full-symbol';
import { useSettingsStore } from '../../../../common/stores/settings';
import { useStockOpen } from '../../../../common/composables/use-stock-open';
import type {
  NorthboundHistoryRange,
  NorthboundHistoryRow,
} from '../../../../common/types/northbound.types.ts';
import BaseTabs from '../../ui/BaseTabs.vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseEmpty from '../../ui/BaseEmpty.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseChart from '../../charts/BaseChart.vue';
import MenuIcon from '../../ui/MenuIcon.vue';

/**
 * 南向资金历史卡（资金流向页行 4）
 *
 * 范围（30/60/120 日）切换，参数变化即重拉（不轮询）；
 * 主图：当日净买额柱（正红负绿，随涨跌配色主题）+ 累计净买额线（右轴）。
 * 方向固定南向——北向每日净买额停披露且无公开替代来源（2026-10-30 王总指定删除
 * 北向展示），API 层仍保留北向历史查询能力（2024-08-19 前为真实数据）供 MCP 使用；
 * 明细表的成交额列照常有值。数据层放 common，本组件为 PC 视图
 *
 * 明细表折叠：2026-11-06 王总指定，展开开关放在范围切换按钮左边，默认收起不显示
 */

/** 明细表展示行数（最近 N 个交易日） */
const DETAIL_ROW_COUNT = 6;

/** 明细表是否展开（默认收起，开关在范围切换按钮左边，2026-11-06 王总指定） */
const isDetailExpanded = ref(false);

/** 历史卡图表高度（像素） */
const CHART_HEIGHT_PX = 200;

const settingsStore = useSettingsStore();

/** 当前范围 */
const range = ref<NorthboundHistoryRange>('30d');

/** 历史序列（升序） */
const rows = ref<NorthboundHistoryRow[]>([]);

/** 是否加载中 */
const isLoading = ref(false);

/** 是否取数失败（且无已成功数据兜底） */
const isError = ref(false);

/** 加载序列号（防切换竞态：旧响应回来不覆盖新参数的数据） */
const loadSeq = ref(0);

/** 拉取历史（参数变化即重拉；竞态由序列号守卫） */
const loadHistory = async (): Promise<void> => {
  const seq = loadSeq.value + 1;
  loadSeq.value = seq;
  isLoading.value = true;
  try {
    const data = await fetchNorthboundHistory('south', range.value);
    if (seq !== loadSeq.value) return;
    rows.value = data;
    isError.value = data.length === 0;
  } catch (error) {
    console.error('[northbound] 资金历史取数失败', error);
    if (seq !== loadSeq.value) return;
    isError.value = rows.value.length === 0;
  } finally {
    if (seq === loadSeq.value) {
      isLoading.value = false;
    }
  }
};

// 范围变化即重拉
watch(range, () => {
  void loadHistory();
});

onMounted(() => {
  void loadHistory();
});

/** 柱色（正红负绿，运行时读涨跌配色变量，切主题即时跟随） */
const barColors = computed(() => {
  void settingsStore.trendTheme;
  const colors = readTrendColors();
  return { up: colors.up, down: colors.down };
});

/** 图表 option（南向正常柱线；北向全空时组件不渲染图表） */
const option = computed<EChartsCoreOption>(() => {
  const list = rows.value;
  return {
    animation: false,
    legend: {
      show: true,
      top: 0,
      right: 0,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: CHART_TEXT_COLOR, fontSize: 10 },
    },
    tooltip: {
      trigger: 'axis',
      formatter: (params: unknown) => {
        const list = params as { axisValue: string; value: number | null; marker: string; seriesName: string }[];
        const date = list[0]?.axisValue ?? '';
        const lines = list
          .filter((item) => item.value !== null)
          .map(
            (item) =>
              `${item.marker}${item.seriesName}：${formatNorthboundAmount({ value: item.value, source: 'yuan' })}`,
          );
        return [date, ...lines].join('<br/>');
      },
    },
    grid: { left: 8, right: 8, top: 26, bottom: 0, containLabel: true },
    xAxis: {
      type: 'category',
      data: list.map((row) => row.date.slice(5)),
      axisLabel: { color: CHART_TEXT_COLOR, fontSize: 10 },
      axisLine: { lineStyle: { color: CHART_AXIS_LINE_COLOR } },
      axisTick: { show: false },
    },
    yAxis: [
      {
        type: 'value',
        scale: true,
        axisLabel: {
          color: CHART_TEXT_COLOR,
          fontSize: 10,
          formatter: (value: number) => formatNorthboundAmount({ value, source: 'yuan' }).replace(' ', ''),
        },
        splitLine: { lineStyle: { color: CHART_SPLIT_LINE_COLOR } },
      },
      {
        type: 'value',
        scale: true,
        axisLabel: {
          color: CHART_TEXT_COLOR,
          fontSize: 10,
          formatter: (value: number) => formatNorthboundAmount({ value, source: 'yuan' }).replace(' ', ''),
        },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: '当日净买额',
        type: 'bar',
        data: list.map((row) =>
          row.netBuyAmount === null
            ? null
            : {
                value: row.netBuyAmount,
                itemStyle: {
                  color: row.netBuyAmount >= 0 ? barColors.value.up : barColors.value.down,
                },
              },
        ),
        barMaxWidth: 10,
      },
      {
        name: '累计净买额',
        type: 'line',
        yAxisIndex: 1,
        data: list.map((row) => row.accNetBuyAmount),
        showSymbol: false,
        lineStyle: { width: 1.5, type: 'dashed', color: CHART_LINE_PURPLE },
        itemStyle: { color: CHART_LINE_PURPLE },
        connectNulls: false,
      },
    ],
  };
});

/** 明细表数据（最近 N 个交易日，倒序展示最新在前） */
const detailRows = computed(() => rows.value.slice(-DETAIL_ROW_COUNT).reverse());

/**
 * 领涨股单击 / 双击（2026-11-02 全站统一口径）：单击 = 右侧个股侧栏，
 * 双击 = 个股详情整页（携带明细表行内出现的领涨股作为来源列表）。
 * 单击 / 双击合并派发窗口与 BaseTable enableDblclickNav 同口径
 */
const { openSidebar, openPage, toContextList } = useStockOpen();

/** 明细行内出现过的领涨股（来源列表口径；代码 600592.SH / 02656.HK → 完整符号） */
const leadStockList = computed(() =>
  rows.value.flatMap((row) =>
    row.topStockCode
      ? [{ symbol: toFullSymbol(row.topStockCode), name: row.topStockName ?? '' }]
      : [],
  ),
);

/** 单击合并窗口（毫秒） */
const DBLCLICK_MERGE_MS = 250;
/** 挂起的单击定时器（null = 无待派发单击） */
let pendingLeadTimer: number | null = null;

/**
 * 领涨股单击：延迟派发开侧栏，窗口内收到双击则取消
 * @param code 领涨股代码（600592.SH / 02656.HK 形态）
 */
const openLeadStock = (code: string | null): void => {
  if (!code) return;
  if (pendingLeadTimer !== null) {
    window.clearTimeout(pendingLeadTimer);
  }
  pendingLeadTimer = window.setTimeout(() => {
    pendingLeadTimer = null;
    openSidebar(
      toFullSymbol(code),
      toContextList(leadStockList.value, (item) => item.symbol),
    );
  }, DBLCLICK_MERGE_MS);
};

/**
 * 领涨股双击：取消未派发的单击，跳详情整页
 * @param code 领涨股代码
 */
const openLeadStockPage = (code: string | null): void => {
  if (!code) return;
  if (pendingLeadTimer !== null) {
    window.clearTimeout(pendingLeadTimer);
    pendingLeadTimer = null;
  }
  openPage(toFullSymbol(code), toContextList(leadStockList.value, (item) => item.symbol));
};
</script>

<template>
  <BaseCard title="南向资金历史">
    <template #extra>
      <div class="flex items-center gap-2">
        <!-- 明细表展开/收起（默认收起，2026-11-06 王总指定） -->
        <button
          type="button"
          class="pressable flex items-center rounded px-1.5 py-0.5 text-xs text-text-tertiary hover:bg-flat-weak hover:text-text"
          :aria-expanded="isDetailExpanded"
          aria-label="每日明细"
          @click="isDetailExpanded = !isDetailExpanded"
        >
          <MenuIcon
            name="chevronDown"
            :size="13"
            class="mr-0.5 transition-transform"
            :class="isDetailExpanded ? 'rotate-180' : ''"
          />
          每日明细
        </button>
        <BaseTabs v-model="range" :options="NORTHBOUND_HISTORY_RANGE_OPTIONS" />
      </div>
    </template>

    <BaseSkeleton v-if="isLoading" class="h-[300px]" />
    <BaseEmpty v-else-if="isError" text="资金历史加载失败，请稍后重试" />
    <template v-else>
      <BaseChart :options="option" :style="{ height: `${CHART_HEIGHT_PX}px` }" />

      <!-- 每日明细表：默认收起，展开开关在范围切换按钮左边（2026-11-06 王总指定） -->
      <div v-if="isDetailExpanded" class="mt-3 overflow-x-auto">
        <table class="w-full min-w-[620px] whitespace-nowrap text-xs">
          <thead>
            <tr class="border-b border-flat-weak text-left text-text-tertiary">
              <th class="py-1.5 pr-3 font-normal">日期</th>
              <th class="py-1.5 pr-3 text-right font-normal">净买额</th>
              <th class="py-1.5 pr-3 text-right font-normal">成交额</th>
              <th class="py-1.5 pr-3 text-right font-normal">累计净买额</th>
              <th class="py-1.5 text-right font-normal">领涨股</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in detailRows"
              :key="row.date"
              class="border-b border-flat-weak/60 last:border-0"
            >
              <td class="py-1.5 pr-3 num text-text">{{ row.date }}</td>
              <td
                class="py-1.5 pr-3 text-right num font-medium"
                :class="(row.netBuyAmount ?? 0) > 0 ? 'text-up' : (row.netBuyAmount ?? 0) < 0 ? 'text-down' : 'text-flat'"
              >
                {{ formatNorthboundAmount({ value: row.netBuyAmount, source: 'yuan' }) }}
              </td>
              <td class="py-1.5 pr-3 text-right num text-text">
                {{ formatNorthboundAmount({ value: row.dealAmount, source: 'yuan' }) }}
              </td>
              <td class="py-1.5 pr-3 text-right num text-text-secondary">
                {{ formatNorthboundAmount({ value: row.accNetBuyAmount, source: 'yuan' }) }}
              </td>
              <td class="py-1.5 text-right">
                <template v-if="row.topStockName">
                  <button
                    type="button"
                    class="pressable text-text-secondary hover:text-primary"
                    title="单击开侧栏 / 双击进详情"
                    @click="openLeadStock(row.topStockCode)"
                    @dblclick="openLeadStockPage(row.topStockCode)"
                  >
                    {{ row.topStockName }}
                  </button>
                  <span
                    class="ml-1 num"
                    :class="(row.topStockChangePercent ?? 0) >= 0 ? 'text-up' : 'text-down'"
                  >
                    {{ `${(row.topStockChangePercent ?? 0) > 0 ? '+' : ''}${(row.topStockChangePercent ?? 0).toFixed(2)}%` }}
                  </span>
                </template>
                <span v-else class="text-flat">--</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </BaseCard>
</template>

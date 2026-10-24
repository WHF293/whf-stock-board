<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import NoticeBar from '../../ui/NoticeBar.vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import { ROUTE_PATH } from '../../../../common/constants/router-meta.constants.ts';
import {
  TZZB_MCP_LIVE,
  getTzzbAccounts,
  getTzzbAssetChange,
  getTzzbClearedPositions,
  getTzzbDayCalendar,
  getTzzbFundHoldingReturns,
  getTzzbFundTrades,
  getTzzbMonthCalendar,
  getTzzbPnlSummary,
  getTzzbPositionSummary,
  getTzzbStockTrades,
  getTzzbSyncMeta,
  getTzzbYearPoints,
} from '../../../../common/api/tzzb.api.ts';
import { useRouter } from 'vue-router';
import type {
  TzzbAccount,
  TzzbAssetChange,
  TzzbClearedPosition,
  TzzbDayCalendar,
  TzzbFundTrade,
  TzzbHoldingReturn,
  TzzbMonthCalendar,
  TzzbPnlSummary,
  TzzbPositionSummary,
  TzzbStockTradePage,
  TzzbSyncMeta,
  TzzbYearPoint,
} from '../../../../common/types/tzzb.types.ts';
import { TZZB_RANGE_LABEL } from '../../../../common/types/tzzb.types.ts';
import TzzbTopbar from './TzzbTopbar.vue';
import TzzbMetricRow from './TzzbMetricRow.vue';
import TzzbAssetPanel from './TzzbAssetPanel.vue';
import TzzbAssetChangeCard from './TzzbAssetChangeCard.vue';
import TzzbProfitCalendar from './TzzbProfitCalendar.vue';
import TzzbClearedPanel from './TzzbClearedPanel.vue';
import TzzbClearedAnalysis from './TzzbClearedAnalysis.vue';
import TzzbKindRank from './TzzbKindRank.vue';
import TzzbTradeRecords from './TzzbTradeRecords.vue';

/**
 * 投资账本数据中心（账户分析页主体）
 *
 * 数据流：tzzb.api（当前 mock 传输）→ 本容器分发六大模块组件；
 * 切换账户 / 翻页 / 日历下钻在此统一重拉。mock 采样只覆盖「whf-东北」，
 * 切换其他账户时展示空态（正式接入后按账户维度重拉）。
 */
const router = useRouter();

/* ---------------- 状态 ---------------- */

const accounts = ref<TzzbAccount[]>([]);
const selectedId = ref('');
const syncMeta = ref<TzzbSyncMeta | null>(null);
const syncing = ref(false);
const loading = ref(true);

/** 交易记录页签（股票流水 / 基金流水；历史导入页签已删） */
const TRADE_TAB_OPTIONS = [
  { label: '股票流水', value: 'stock' },
  { label: '基金流水', value: 'fund' },
];
const tradeTab = ref('stock');

const pnl = ref<TzzbPnlSummary | null>(null);
const position = ref<TzzbPositionSummary | null>(null);

/** 资产曲线区间（父级持有；切换时重拉 queryPnlSummary，指标行区间盈亏 / 对比沪深300 联动） */
const range = ref<string>('m1');
/** 自定义区间起止（range = custom 时生效） */
const customFrom = ref('2026-09-01');
const customTo = ref('2026-10-23');

/** 区间展示名（指标行「区间盈亏」副标题用） */
const rangeLabel = computed(() => TZZB_RANGE_LABEL[range.value] ?? '本月');

/** 区间变化 → 重拉资产曲线汇总（mock 阶段采样不变，正式接入按区间传参） */
watch([range, customFrom, customTo], ([r, from, to]) => {
  if (r !== 'custom' || (from && to)) {
    void getTzzbPnlSummary(r).then((v) => {
      if (v) pnl.value = v;
    });
  }
});

const assetChange = ref<TzzbAssetChange | null>(null);
const dayCal = ref<TzzbDayCalendar | null>(null);
const monthCal = ref<TzzbMonthCalendar | null>(null);
const yearPoints = ref<TzzbYearPoint[]>([]);
const cleared = ref<TzzbClearedPosition[]>([]);
const fundReturns = ref<TzzbHoldingReturn[]>([]);
const stockTrades = ref<TzzbStockTradePage | null>(null);
const fundTrades = ref<TzzbFundTrade[]>([]);

/** 沪深300 区间涨跌幅（指标卡超额对比用） */
const hs300Rate = computed(() => {
  const list = pnl.value?.indexTrend ?? [];
  if (list.length < 2 || list[0].hs300 === 0) return 0;
  return list[list.length - 1].hs300 / list[0].hs300 - 1;
});

/** 当前选中账户名（mock 采样提示用） */
const selectedName = computed(
  () => accounts.value.find((a) => a.id === selectedId.value)?.name ?? '全部账户',
);

/* ---------------- 加载 ---------------- */

/** 拉取全部模块（并行；单模块失败不影响其余，各自落空态） */
const loadAll = async (): Promise<void> => {
  loading.value = true;
  const results = await Promise.allSettled([
    getTzzbAccounts(),
    getTzzbSyncMeta(),
    getTzzbPnlSummary(),
    getTzzbPositionSummary(),
    getTzzbAssetChange(),
    getTzzbDayCalendar('202610'),
    getTzzbMonthCalendar('2026'),
    getTzzbYearPoints(['2026', '2025']),
    getTzzbClearedPositions(),
    getTzzbFundHoldingReturns(),
    getTzzbStockTrades('1'),
    getTzzbFundTrades('2026-09'),
  ]);
  const [acc, meta, pnlR, posR, chgR, dayR, monR, yearR, clrR, fundRetR, tradeR, fundTradeR] =
    results;
  if (acc.status === 'fulfilled') accounts.value = acc.value;
  if (meta.status === 'fulfilled') syncMeta.value = meta.value;
  if (pnlR.status === 'fulfilled') pnl.value = pnlR.value;
  if (posR.status === 'fulfilled') position.value = posR.value;
  if (chgR.status === 'fulfilled') assetChange.value = chgR.value;
  if (dayR.status === 'fulfilled') dayCal.value = dayR.value;
  if (monR.status === 'fulfilled') monthCal.value = monR.value;
  if (yearR.status === 'fulfilled') yearPoints.value = yearR.value;
  if (clrR.status === 'fulfilled') cleared.value = clrR.value;
  if (fundRetR.status === 'fulfilled') fundReturns.value = fundRetR.value;
  if (tradeR.status === 'fulfilled') stockTrades.value = tradeR.value;
  if (fundTradeR.status === 'fulfilled') fundTrades.value = fundTradeR.value;
  loading.value = false;
};

onMounted(() => {
  void loadAll();
});

/* ---------------- 交互 ---------------- */

/**
 * 切换账户（mock 阶段仅更新选中态；正式接入后按账户重拉各模块）
 * @param id 账户 id；'' = 全部账户
 */
const onSelectAccount = (id: string): void => {
  selectedId.value = id;
};

/**
 * 手动同步（mock 阶段模拟一次重拉）
 */
const onSync = async (): Promise<void> => {
  syncing.value = true;
  await loadAll();
  syncing.value = false;
};

/**
 * 盈亏日历切月
 * @param ym 月份 yyyyMM
 */
const onDayMonth = (ym: string): void => {
  void getTzzbDayCalendar(ym).then((v) => {
    if (v) dayCal.value = v;
  });
};

/**
 * 盈亏日历切年（月历 / 年历共用）
 * @param year 年份 yyyy
 */
const onMonthYear = (year: string): void => {
  void getTzzbMonthCalendar(year).then((v) => {
    if (v) monthCal.value = v;
  });
};

/**
 * 股票流水翻页
 * @param page 页码（从 1 起）
 */
const onTradePage = (page: number): void => {
  void getTzzbStockTrades(String(page)).then((v) => {
    if (v) stockTrades.value = v;
  });
};

/**
 * 点击品种打开个股 / 基金详情
 * @param code 证券代码
 */
const openStockDetail = (code: string): void => {
  void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${code}`);
};
</script>

<template>
  <div class="flex flex-col gap-3">
    <NoticeBar
      class="shrink-0"
      :text="
        TZZB_MCP_LIVE
          ? `真实数据：同花顺投资账本 MCP 直连 · 当前 ${selectedName} · 切换账户 / 区间按真实接口重拉`
          : '未配置投资账本 MCP：请在 .env.local 设置 VITE_TZZB_MCP_URL / VITE_TZZB_MCP_PROXY=1 后重启 dev server'
      "
    />

    <!-- 顶栏：账户选择器 + 同步状态 -->
    <div class="rounded-card shrink-0 bg-surface px-4 py-2.5 shadow-card">
      <TzzbTopbar
        :accounts="accounts"
        :selected-id="selectedId"
        :sync-meta="syncMeta"
        :syncing="syncing"
        @select="onSelectAccount"
        @sync="onSync"
      />
    </div>

    <!-- 骨架（首载） -->
    <template v-if="loading">
      <BaseSkeleton class="h-24" />
      <BaseSkeleton class="h-72" />
      <BaseSkeleton class="h-96" />
    </template>

    <template v-else>
      <!-- ① 指标行（区间盈亏 / 对比沪深300 跟随资产曲线区间） -->
      <TzzbMetricRow
        :total-asset="position?.totalAsset ?? 0"
        :market-value="position?.marketValue ?? 0"
        :available-funds="position?.availableFunds ?? 0"
        :position-ratio="position?.positionRatio ?? 0"
        :range-profit="pnl?.totalProfit ?? 0"
        :range-rate="pnl?.totalRate ?? 0"
        :range-label="rangeLabel === '自定义区间' ? `${customFrom} ~ ${customTo}` : rangeLabel"
        :hs300-rate="hs300Rate"
      />

      <!-- ② 资产曲线 + 区间资金变动 -->
      <div class="grid shrink-0 gap-3 xl:grid-cols-3">
        <BaseCard title="资产曲线" class="xl:col-span-2">
          <div class="h-80">
            <TzzbAssetPanel
              :pnl="pnl"
              :range="range"
              @range-change="(r) => (range = r)"
              @custom-change="(f, t) => ((customFrom = f), (customTo = t))"
            />
          </div>
        </BaseCard>
        <BaseCard title="区间资金变动" fill class="min-h-0">
          <TzzbAssetChangeCard :data="assetChange" />
        </BaseCard>
      </div>

      <!-- ③ 盈亏日历（三级下钻） -->
      <BaseCard title="盈亏日历">
        <TzzbProfitCalendar
          :day-cal="dayCal"
          :month-cal="monthCal"
          :year-points="yearPoints"
          @day-month="onDayMonth"
          @month-year="onMonthYear"
        />
      </BaseCard>

      <!-- ④ 建清仓 + ⑤ 品种总盈亏（xl 定高等高，两侧各自内部滚动） -->
      <div class="grid shrink-0 gap-3 xl:h-[30rem] xl:grid-cols-5">
        <BaseCard title="建清仓记录" fill class="min-h-0 xl:col-span-3">
          <TzzbClearedPanel :rows="cleared" fill @open="openStockDetail" />
        </BaseCard>
        <BaseCard title="品种总盈亏" fill class="min-h-0 xl:col-span-2">
          <TzzbKindRank :cleared="cleared" :fund-returns="fundReturns" @open="openStockDetail" />
        </BaseCard>
      </div>

      <!-- ⑥ 清仓分析（逐周期盈亏 / 费用） -->
      <BaseCard title="清仓分析">
        <TzzbClearedAnalysis :cleared="cleared" :fund-returns="fundReturns" @open="openStockDetail" />
      </BaseCard>

      <!-- ⑦ 交易记录（页签在标题行右侧；历史导入页签已删） -->
      <BaseCard title="交易记录">
        <template #extra>
          <BaseTabs v-model="tradeTab" :options="TRADE_TAB_OPTIONS" />
        </template>
        <TzzbTradeRecords
          :tab="tradeTab"
          :stock-trades="stockTrades"
          :fund-trades="fundTrades"
          @page="onTradePage"
        />
      </BaseCard>
    </template>
  </div>
</template>

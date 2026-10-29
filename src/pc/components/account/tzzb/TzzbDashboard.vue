<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import NoticeBar from '../../ui/NoticeBar.vue';
import BaseCard from '../../ui/BaseCard.vue';
import BaseSkeleton from '../../ui/BaseSkeleton.vue';
import BaseTabs from '../../ui/BaseTabs.vue';
import MenuIcon from '../../ui/MenuIcon.vue';
import { ROUTE_PATH } from '../../../../common/constants/router-meta.constants.ts';
import { HOST_HEADER_ITEM } from '../../../../common/constants/header.constants.ts';
import { NOTIFY_TONE } from '../../../../common/constants/notify.constants.ts';
import { useSettingsStore } from '../../../../common/stores/settings';
import { useNotificationsStore } from '../../../../common/stores/notifications';
import { requestAgentAnalysis } from '../../../agent/agent-bridge';
import { buildAssetCurveAnalysisPrompt } from '../../../../common/utils/build-asset-curve-analysis-prompt';
import { buildClearedPositionAnalysisPrompt } from '../../../../common/utils/build-cleared-position-analysis-prompt';
import { findMaxDrawdown } from '../../../../common/utils/find-max-drawdown';
import type { RankDataset } from '../../../../common/types/rank-dataset.types';
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

/* ---------------- 模块级 AI 分析（资产曲线 / 清仓分析，图表头右侧 icon） ---------------- */

const settingsStore = useSettingsStore();
const notifications = useNotificationsStore();

/** 「AI 分析」入口跟随顶栏「Agent 分析」条目的显隐开关（设置 → 布局编排 → 右上角工具编排） */
const agentEntryVisible = computed(
  () => !settingsStore.hiddenHeaderItems.includes(HOST_HEADER_ITEM.AGENT),
);

/** 两个入口各自独立防重入 */
const assetAiRunning = ref(false);
const clearedAiRunning = ref(false);

/**
 * 带符号百分数文案（小数口径 → 「+1.23%」）
 * @param rate 小数口径涨跌幅
 * @returns 百分数文案
 */
const signPct = (rate: number): string => `${rate > 0 ? '+' : ''}${(rate * 100).toFixed(2)}%`;

/**
 * 区间指数涨跌（TzzbIndexPoint 首尾比）
 * @param key 指数字段（sh / hs300）
 * @returns 小数口径涨跌；数据不足返回 null
 */
const indexRangeRate = (key: 'sh' | 'hs300'): number | null => {
  const list = pnl.value?.indexTrend ?? [];
  if (list.length < 2 || list[0][key] === 0) return null;
  return list[list.length - 1][key] / list[0][key] - 1;
};

/** 净值序列抽样上限（行数；超出等距抽，保住首尾点） */
const AI_NAV_SAMPLE_MAX_ROWS = 60;

/**
 * 资产曲线数据段（AI 分析口径）：区间概览 + 最大回撤 + 净值序列抽样
 * @returns 数据段列表；无曲线数据返回空数组
 */
const buildAssetDatasets = (): RankDataset[] => {
  const summary = pnl.value;
  if (!summary || summary.assetTrend.length < 2) {
    return [];
  }
  const navStart = summary.assetTrend[0].navIndex;
  const navEnd = summary.assetTrend[summary.assetTrend.length - 1].navIndex;
  const navRate = navStart > 0 ? navEnd / navStart - 1 : 0;
  const hs300 = indexRangeRate('hs300');
  const sh = indexRangeRate('sh');
  const avgPosition =
    summary.assetTrend.reduce((sum, point) => sum + point.positionRatio, 0) /
    summary.assetTrend.length;
  const drawdown = findMaxDrawdown(
    summary.assetTrend.map((point) => ({ date: point.date, value: point.navIndex })),
  );
  const datasets: RankDataset[] = [
    {
      title: '区间概览',
      columns: [
        { label: '区间盈亏(元)', key: 'profit' },
        { label: '区间收益率', key: 'rate' },
        { label: '净值指数(末值,基点1000)', key: 'navEnd' },
        { label: '上证区间涨跌', key: 'shRate' },
        { label: '沪深300区间涨跌', key: 'hs300Rate' },
        { label: '超额收益(vs沪深300)', key: 'excess' },
        { label: '平均仓位', key: 'position' },
        { label: '最大回撤', key: 'dd' },
      ],
      rows: [
        {
          profit: summary.totalProfit,
          rate: signPct(summary.totalRate),
          navEnd,
          shRate: sh === null ? '—' : signPct(sh),
          hs300Rate: hs300 === null ? '—' : signPct(hs300),
          excess: hs300 === null ? '—' : signPct(navRate - hs300),
          position: `${(avgPosition * 100).toFixed(1)}%`,
          dd: drawdown ? `-${(drawdown.depth * 100).toFixed(2)}%` : '无',
        },
      ],
    },
  ];
  if (drawdown) {
    datasets.push({
      title: '最大回撤窗口（谷底后与指数同窗口对照，可判断市场性/个股性回撤）',
      columns: [
        { label: '峰值日期', key: 'peak' },
        { label: '谷底日期', key: 'trough' },
        { label: '回撤深度', key: 'depth' },
        { label: '是否已收复', key: 'recovered' },
      ],
      rows: [
        {
          peak: drawdown.peakDate,
          trough: drawdown.troughDate,
          depth: `-${(drawdown.depth * 100).toFixed(2)}%`,
          recovered: drawdown.recovered ? '是' : '否',
        },
      ],
    });
  }
  // 净值序列等距抽样（保首尾），给模型看形态而不是逐日全量
  const trend = summary.assetTrend;
  const step = Math.max(1, Math.ceil(trend.length / AI_NAV_SAMPLE_MAX_ROWS));
  const sampled = trend.filter(
    (_, index) => index % step === 0 || index === trend.length - 1,
  );
  const indexByDate = new Map(summary.indexTrend.map((point) => [point.date, point]));
  datasets.push({
    title: '净值序列（抽样，含同日指数点位）',
    columns: [
      { label: '日期', key: 'date' },
      { label: '总资产(元)', key: 'asset' },
      { label: '当日盈亏(元)', key: 'daily' },
      { label: '净值指数', key: 'nav' },
      { label: '仓位', key: 'position' },
      { label: '上证', key: 'sh' },
      { label: '沪深300', key: 'hs300' },
    ],
    rows: sampled.map((point) => {
      const index = indexByDate.get(point.date);
      return {
        date: point.date,
        asset: point.totalAsset,
        daily: point.dailyProfit,
        nav: point.navIndex,
        position: `${(point.positionRatio * 100).toFixed(0)}%`,
        sh: index?.sh ?? null,
        hs300: index?.hs300 ?? null,
      };
    }),
  });
  return datasets;
};

/** 已清仓周期（清仓非空的记录，Top 盈亏单只从这里挑） */
const closedCycles = computed(() => cleared.value.filter((row) => row.closeDate !== null));

/** 持有天数分桶边界（天）：短线 / 波段 / 中线 / 长线 */
const HOLD_BUCKETS: { label: string; min: number; max: number }[] = [
  { label: '短线(≤5天)', min: 0, max: 5 },
  { label: '波段(6-20天)', min: 6, max: 20 },
  { label: '中线(21-60天)', min: 21, max: 60 },
  { label: '长线(>60天)', min: 61, max: Number.MAX_SAFE_INTEGER },
];

/** 明细单挑出条数（最大盈利 / 亏损各取前 N） */
const AI_TOP_TRADES = 5;

/**
 * 清仓分析数据段（AI 分析口径）：周期汇总 + 持有天数分桶 + Top 盈亏单
 * @returns 数据段列表；无清仓记录返回空数组
 */
const buildClearedDatasets = (): RankDataset[] => {
  const closed = closedCycles.value;
  if (closed.length === 0) {
    return [];
  }
  const wins = closed.filter((row) => row.profit > 0);
  const losses = closed.filter((row) => row.profit < 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, r) => s + r.profit, 0) / wins.length : 0;
  const avgLoss =
    losses.length > 0 ? losses.reduce((s, r) => s + r.profit, 0) / losses.length : 0;
  const datasets: RankDataset[] = [
    {
      title: '周期汇总（已清仓）',
      columns: [
        { label: '已清笔数', key: 'count' },
        { label: '胜率', key: 'winRate' },
        { label: '累计盈亏(元)', key: 'profit' },
        { label: '平均盈利单(元)', key: 'avgWin' },
        { label: '平均亏损单(元)', key: 'avgLoss' },
        { label: '盈亏比', key: 'plRatio' },
        { label: '累计费用(元)', key: 'fee' },
        { label: '平均持有天数', key: 'hold' },
      ],
      rows: [
        {
          count: closed.length,
          winRate: `${((wins.length / closed.length) * 100).toFixed(0)}%`,
          profit: closed.reduce((s, r) => s + r.profit, 0),
          avgWin,
          avgLoss,
          plRatio:
            avgLoss === 0 ? '—' : `${(Math.abs(avgWin / avgLoss)).toFixed(2)}`,
          fee: closed.reduce((s, r) => s + r.fee, 0),
          hold: Number(
            (closed.reduce((s, r) => s + r.holdDays, 0) / closed.length).toFixed(1),
          ),
        },
      ],
    },
    {
      title: '持有天数分桶（各桶笔数与盈亏，判断哪段周期在赚钱）',
      columns: [
        { label: '分桶', key: 'bucket' },
        { label: '笔数', key: 'count' },
        { label: '合计盈亏(元)', key: 'profit' },
        { label: '胜率', key: 'winRate' },
      ],
      rows: HOLD_BUCKETS.map((bucket) => {
        const rows = closed.filter((row) => row.holdDays >= bucket.min && row.holdDays <= bucket.max);
        const bucketWins = rows.filter((row) => row.profit > 0).length;
        return {
          bucket: bucket.label,
          count: rows.length,
          profit: rows.reduce((s, r) => s + r.profit, 0),
          winRate: rows.length === 0 ? '—' : `${((bucketWins / rows.length) * 100).toFixed(0)}%`,
        };
      }),
    },
  ];
  const byProfit = [...closed].sort((a, b) => b.profit - a.profit);
  const tradeColumns = [
    { label: '名称', key: 'name' },
    { label: '开仓日', key: 'open' },
    { label: '清仓日', key: 'close' },
    { label: '持有天数', key: 'hold' },
    { label: '回合数', key: 'rounds' },
    { label: '建仓均价', key: 'avgBuy' },
    { label: '清仓均价', key: 'avgSell' },
    { label: '盈亏(元)', key: 'profit' },
    { label: '收益率', key: 'rate' },
  ];
  const toTradeRow = (row: TzzbClearedPosition): Record<string, unknown> => ({
    name: row.name,
    open: row.openDate,
    close: row.closeDate,
    hold: row.holdDays,
    rounds: row.rounds,
    avgBuy: row.avgBuy,
    avgSell: row.avgSell,
    profit: row.profit,
    rate: signPct(row.rate),
  });
  datasets.push({
    title: '最大盈利单 Top5',
    columns: tradeColumns,
    rows: byProfit.slice(0, AI_TOP_TRADES).map(toTradeRow),
  });
  datasets.push({
    title: '最大亏损单 Top5',
    columns: tradeColumns,
    rows: byProfit.slice(-AI_TOP_TRADES).map(toTradeRow),
  });
  return datasets;
};

/**
 * 发起「资产曲线 AI 分析」（指数印证 / 市场风向 / 政策 / 地缘由提示词驱动 Agent 查证）
 */
const runAssetAiAnalysis = async (): Promise<void> => {
  if (assetAiRunning.value) return;
  const label = rangeLabel.value === '自定义区间' ? `${customFrom.value} ~ ${customTo.value}` : rangeLabel.value;
  const prompt = buildAssetCurveAnalysisPrompt(label, buildAssetDatasets());
  if (prompt === '') {
    notifications.push({
      title: '暂无可分析的数据',
      body: '请等待资产曲线数据加载完成后再发起 AI 分析',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  assetAiRunning.value = true;
  try {
    await requestAgentAnalysis(prompt);
  } finally {
    assetAiRunning.value = false;
  }
};

/**
 * 发起「清仓分析 AI 分析」（典型案例 / 行为偏差的行情查证由提示词驱动 Agent 完成）
 */
const runClearedAiAnalysis = async (): Promise<void> => {
  if (clearedAiRunning.value) return;
  const prompt = buildClearedPositionAnalysisPrompt(buildClearedDatasets());
  if (prompt === '') {
    notifications.push({
      title: '暂无可分析的数据',
      body: '请先同步投资账本生成建清仓记录',
      tone: NOTIFY_TONE.FLAT,
    });
    return;
  }
  clearedAiRunning.value = true;
  try {
    await requestAgentAnalysis(prompt);
  } finally {
    clearedAiRunning.value = false;
  }
};

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
          <template #extra>
            <button
              v-if="agentEntryVisible"
              type="button"
              class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="assetAiRunning"
              :title="assetAiRunning ? '分析已发送给 Agent' : 'AI 分析该区间资产表现（结合指数 / 市场风向 / 政策与地缘）'"
              :aria-label="`AI 分析资产曲线（${rangeLabel}）`"
              @click="void runAssetAiAnalysis()"
            >
              <MenuIcon name="agent" :size="14" />
            </button>
          </template>
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
        <template #extra>
          <button
            v-if="agentEntryVisible"
            type="button"
            class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="clearedAiRunning"
            :title="clearedAiRunning ? '分析已发送给 Agent' : 'AI 分析建清仓操作质量（结合行情查证典型案例）'"
            aria-label="AI 分析清仓分析"
            @click="void runClearedAiAnalysis()"
          >
            <MenuIcon name="agent" :size="14" />
          </button>
        </template>
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

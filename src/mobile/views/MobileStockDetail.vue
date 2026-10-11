<script setup lang="ts">
/**
 * 个股 K 线详情（v2 二期二级页，稿：market-modules-v2 K0-K1，版式参考同花顺；规范：design-mobile.md §5.4）
 *
 * 结构：报价头（大字现价 + 4×2 指标网格）→ 周期 chips（分时/日K/周K/月K/5分/五日，
 * 值与 PC CHART_PERIOD_OPTIONS 一致）→ KlineChart（复用 PC 纯展示组件，已迁 common）
 * → 五档盘口（FullQuote.bid/ask）→ 底部 Tab（交易记录 / ETF 持仓，Tauri 库不可用时降级）
 * 全站股票行点击统一落点 /stock/:code
 */
import { computed, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import KlineChart from '../../common/components/charts/KlineChart.vue';
import type { KLineData } from 'klinecharts';
import { fetchFullQuotes } from '../../common/api/quotes.api';
import { fetchKlineCached } from '../../common/api/kline-cache.api';
import type { SinaKlinePeriod } from '../../common/api/sina-kline.api';
import {
  CHART_PERIOD_OPTIONS,
  CHART_PERIOD_DEFAULT,
} from '../../common/constants/stock-detail.constants';
import { listTradeRecordsBySymbol } from '../../common/api/account-records-db.api';
import { getEtfHoldings } from '../../common/api/etf-holdings.api';
import type { AccountTradeRecord } from '../../common/types/account.types';
import type { EtfHoldingItem } from '../../common/types/etf.types';
import type { FullQuote } from 'stock-sdk';
import { pctClass } from '../utils/format';

const route = useRoute();
const router = useRouter();

/** 完整符号（sh600519 形态） */
const symbol = computed(() => String(route.params.code ?? ''));

/* === 报价头 === */
const quote = ref<FullQuote | null>(null);
const quoteLoading = ref(false);
const quoteError = ref(false);

const loadQuote = async (): Promise<void> => {
  if (!symbol.value) return;
  quoteLoading.value = true;
  quoteError.value = false;
  try {
    const list = await fetchFullQuotes([symbol.value]);
    quote.value = list[0] ?? null;
    if (!quote.value) quoteError.value = true;
  } catch {
    quoteError.value = true;
  } finally {
    quoteLoading.value = false;
  }
};

const chgText = computed(() => {
  const q = quote.value;
  if (!q) return '--';
  return `${q.change > 0 ? '+' : ''}${q.change.toFixed(2)}  ${q.changePercent > 0 ? '+' : ''}${q.changePercent.toFixed(2)}%`;
});

/** 3×2 指标网格，置于名称/价格右侧（语义同 PC 报价头；最高/最低按王总 2026-10-10 要求移除） */
const headGrid = computed(() => {
  const q = quote.value;
  const f = (v: number | null | undefined, digits = 2): string =>
    v === null || v === undefined ? '--' : v.toFixed(digits);
  return [
    { t: '今开', v: f(q?.open), cls: pctClass(q && q.open > q.prevClose ? 1 : q && q.open < q.prevClose ? -1 : 0) },
    { t: '昨收', v: f(q?.prevClose), cls: 'm-flat' },
    { t: '成交量', v: q ? `${((q.volume ?? 0) / 1e6).toFixed(1)}万手` : '--', cls: 'm-flat' },
    { t: '成交额', v: q ? `${((q.amount ?? 0) / 1e8).toFixed(2)}亿` : '--', cls: 'm-flat' },
    { t: '换手', v: q?.turnoverRate ? `${q.turnoverRate.toFixed(2)}%` : '--', cls: 'm-flat' },
    { t: '量比', v: f(q?.volumeRatio), cls: 'm-flat' },
  ];
});

/* === K 线 === */
const period = ref<SinaKlinePeriod>(CHART_PERIOD_DEFAULT);
const bars = ref<KLineData[]>([]);
const klineLoading = ref(false);
const klineError = ref(false);

/** PC 口径：分时/五日走 timeline 模式 */
const chartMode = computed<'timeline' | 'candle'>(() =>
  period.value === 'minute' || period.value === 'fiveDay' ? 'timeline' : 'candle',
);

const loadKline = async (): Promise<void> => {
  if (!symbol.value) return;
  klineLoading.value = true;
  klineError.value = false;
  bars.value = [];
  try {
    // 不传 barLimit，与 PC 同口径（分时需全天 ~242 根、五日需 5×242 根，120 会截掉上午盘）
    bars.value = await fetchKlineCached(symbol.value, period.value);
  } catch {
    klineError.value = true;
  } finally {
    klineLoading.value = false;
  }
};

/* === 五档盘口（报价头数据内含） === */
const obRows = computed(() => {
  const q = quote.value;
  const bid = (q?.bid ?? []).slice(0, 5);
  const ask = (q?.ask ?? []).slice(0, 5);
  const rows: Array<{ lbl: string; p: number | null; v: number | null; dir: 'up' | 'down' }> = [];
  for (let i = 4; i >= 0; i -= 1) {
    const a = ask[i];
    rows.push({ lbl: `卖${i + 1}`, p: a?.price ?? null, v: a?.volume ?? null, dir: 'down' });
  }
  for (let i = 0; i < 5; i += 1) {
    const b = bid[i];
    rows.push({ lbl: `买${i + 1}`, p: b?.price ?? null, v: b?.volume ?? null, dir: 'up' });
  }
  return rows;
});
const fmtVol = (v: number | null): string =>
  v === null || v === undefined ? '--' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}万` : String(v);

/* === 底部 Tab：交易记录 / ETF 持仓 === */
const BOTTOM_TABS = [
  { key: 'trade', label: '交易记录' },
  { key: 'etf', label: 'ETF 持仓' },
] as const;
type BottomTab = (typeof BOTTOM_TABS)[number]['key'];
const bottomTab = ref<BottomTab>('trade');

const tradeRecords = ref<AccountTradeRecord[]>([]);
const etfHoldings = ref<EtfHoldingItem[]>([]);
const bottomLoading = ref(false);
const bottomError = ref(false);
/** 已加载过的 tab（切回不重复请求） */
const loadedTabs = new Set<BottomTab>();

const loadBottom = async (tab: BottomTab, force = false): Promise<void> => {
  if (!force && loadedTabs.has(tab)) return;
  loadedTabs.add(tab);
  bottomLoading.value = true;
  bottomError.value = false;
  try {
    if (tab === 'trade') {
      tradeRecords.value = await listTradeRecordsBySymbol(symbol.value);
    } else {
      const record = await getEtfHoldings(symbol.value);
      etfHoldings.value = record?.holdings ?? [];
    }
  } catch {
    // H5 无 Tauri SQLite：静默降级为空态
    if (tab === 'trade') tradeRecords.value = [];
    else etfHoldings.value = [];
  } finally {
    bottomLoading.value = false;
  }
};

const onBottomTab = (tab: BottomTab): void => {
  bottomTab.value = tab;
  void loadBottom(tab);
};

/* === 生命周期联动 === */
watch(symbol, () => {
  quote.value = null;
  bars.value = [];
  loadedTabs.clear();
  void loadQuote();
  void loadKline();
  void loadBottom('trade');
}, { immediate: true });

watch(period, () => void loadKline());

const back = (): void => {
  router.back();
};
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      :title="quote ? `${quote.name} ${symbol}` : symbol"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="back"
    />

    <div class="m-sub-scroll">
      <!-- === 报价头 === -->
      <div v-if="quoteLoading" class="m-card m-skel-fill">
        <div v-for="i in 4" :key="i" class="m-skel-row"></div>
      </div>
      <div v-else-if="quoteError || !quote" class="m-state">
        行情加载失败
        <span class="retry" @click="loadQuote()">重试</span>
      </div>
      <template v-else>
        <div class="m-stk-head m-card" style="border-top: none">
          <div class="m-stk-head__main">
            <div class="m-stk-head__nm">
              {{ quote.name }}<span class="code">{{ symbol }}</span>
            </div>
            <div class="m-stk-head__px" :class="pctClass(quote.changePercent)">
              {{ quote.price?.toFixed(2) ?? '--' }}
            </div>
            <div class="m-stk-head__chg" :class="pctClass(quote.changePercent)">
              {{ chgText }}
            </div>
          </div>
          <div class="m-stk-grid">
            <div v-for="g in headGrid" :key="g.t">
              <div class="m-stk-grid__t">{{ g.t }}</div>
              <div class="m-stk-grid__v" :class="g.cls">{{ g.v }}</div>
            </div>
          </div>
        </div>

        <!-- === 周期 chips + K 线图 === -->
        <div class="m-chips" style="padding-top: 10px">
          <button
            v-for="opt in CHART_PERIOD_OPTIONS"
            :key="opt.value"
            class="m-chip"
            :class="{ 'm-chip--active': period === opt.value }"
            @click="period = opt.value"
          >
            {{ opt.label }}
          </button>
        </div>
        <div class="m-card">
          <div v-if="klineLoading" class="m-state">K 线加载中…</div>
          <div v-else-if="klineError" class="m-state">
            K 线加载失败
            <span class="retry" @click="loadKline()">重试</span>
          </div>
          <div v-else-if="!bars.length" class="m-state">暂无 K 线数据</div>
          <div v-else class="m-stk-chart">
            <KlineChart
              :key="`${symbol}-${period}`"
              :bars="bars"
              :mode="chartMode"
              :pre-close="quote.prevClose ?? null"
              :symbol="symbol"
              :intraday-axis="period === 'minute'"
              auto-height
            />
          </div>
        </div>

        <!-- === 五档盘口 === -->
        <div class="m-sec"><span class="m-sec__t">五档盘口</span></div>
        <div class="m-card">
          <div class="m-stk-ob">
            <div v-for="r in obRows" :key="r.lbl" class="m-stk-ob__row">
              <span class="lbl">{{ r.lbl }}</span>
              <span :class="r.dir">{{ r.p?.toFixed(2) ?? '--' }}</span>
              <span class="lbl">{{ fmtVol(r.v) }}</span>
            </div>
          </div>
        </div>

        <!-- === 交易记录 / ETF 持仓 === -->
        <div class="m-chips" style="padding-top: 10px">
          <button
            v-for="t in BOTTOM_TABS"
            :key="t.key"
            class="m-chip"
            :class="{ 'm-chip--active': bottomTab === t.key }"
            @click="onBottomTab(t.key)"
          >
            {{ t.label }}
          </button>
        </div>
        <div class="m-card">
          <div v-if="bottomLoading" class="m-state">加载中…</div>
          <template v-else-if="bottomTab === 'trade'">
            <div v-if="!tradeRecords.length" class="m-state">暂无交易记录</div>
            <div
              v-for="rec in tradeRecords"
              :key="rec.id"
              class="m-row"
            >
              <div class="m-row__nm">
                {{ rec.action }} {{ rec.quantity }}股 @ {{ rec.price?.toFixed(2) ?? '--' }}
                <span class="sub">{{ rec.tradeDate }} {{ rec.tradeTime || '' }}</span>
              </div>
              <span class="m-row__val" :class="rec.action.includes('买') ? 'm-up' : 'm-down'">
                {{ rec.amount ? `${(rec.amount / 1e4).toFixed(2)}万` : '--' }}
              </span>
            </div>
          </template>
          <template v-else>
            <div v-if="!etfHoldings.length" class="m-state">暂无 ETF 持仓数据</div>
            <div v-for="h in etfHoldings" :key="h.symbol" class="m-row">
              <div class="m-row__nm">
                {{ h.name }}
                <span class="sub">{{ h.symbol }}</span>
              </div>
              <span class="m-row__val sm">
                {{ h.holdShares ? `${h.holdShares.toFixed(2)}万股` : '--' }}
              </span>
              <span class="m-row__val sm">
                {{ h.holdMarketValue ? `${(h.holdMarketValue / 1e4).toFixed(2)}亿` : '--' }}
              </span>
            </div>
          </template>
        </div>
      </template>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>

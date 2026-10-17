<script setup lang="ts">
/**
 * 个股 K 线详情（v2 二期二级页，稿：market-modules-v2 K0-K1，版式参考同花顺；规范：DESIGN-MOBILE.md §5.4）
 *
 * 结构：报价头（大字现价 + 4×2 指标网格）→ 周期 chips（分时/日K/周K/月K/5分/五日，
 * 值与 PC CHART_PERIOD_OPTIONS 一致）→ KlineChart（复用 PC 纯展示组件，已迁 common）
 * → 五档盘口（FullQuote.bid/ask）→ 底部 Tab（交易记录 / ETF 持仓 / 财务 / 基金概况 / 资讯，
 * 按标的类型裁剪，与 PC 详情页口径对齐；交易记录与持仓在 Tauri 库不可用时降级）
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
import { pctClass, formatNewsTime } from '../utils/format';
import { isEtfSymbol } from '../../common/utils/is-etf-symbol';
import MobileFinancialPanel from '../components/MobileFinancialPanel.vue';
import { fetchStockAnnouncements, fetchStockNews } from '../../common/api/stock-news.api';
import { getEtfProfile } from '../../common/api/etf-profile.api';
import type { StockAnnouncement } from '../../common/types/stock-news.types';
import type { HotNewsItem } from '../../common/api/news.api';
import type { EtfProfileRecord } from '../../common/types/etf.types';

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

/* === 底部 Tab：与 PC 详情页页签口径对齐 ===
 * 普通股票：交易记录 / 财务 / 资讯；场内基金：ETF 持仓股 / 交易记录 / 基金概况 / 资讯
 * （场内基金无财务报表概念不加财务页签；基金概况承接披露口径，同 PC）
 * 财务页签的数据装配在 MobileFinancialPanel 内部（随 v-if 惰性拉数），不走 loadBottom */
type BottomTab = 'trade' | 'etf' | 'financial' | 'news' | 'fund';
const bottomTab = ref<BottomTab>('trade');

const isEtf = computed(() => isEtfSymbol(symbol.value));

const BOTTOM_TABS = computed<ReadonlyArray<{ key: BottomTab; label: string }>>(() =>
  isEtf.value
    ? [
        { key: 'etf', label: 'ETF 持仓股' },
        { key: 'trade', label: '交易记录' },
        { key: 'fund', label: '基金概况' },
        { key: 'news', label: '资讯' },
      ]
    : [
        { key: 'trade', label: '交易记录' },
        { key: 'financial', label: '财务' },
        { key: 'news', label: '资讯' },
      ],
);

const tradeRecords = ref<AccountTradeRecord[]>([]);
const etfHoldings = ref<EtfHoldingItem[]>([]);
const bottomLoading = ref(false);
const bottomError = ref(false);
/** 已加载过的 tab（切回不重复请求） */
const loadedTabs = new Set<BottomTab>();

/* === 资讯 / 基金概况页签的数据态（与交易记录共用 bottomLoading 加载口径） === */
const newsAnnouncements = ref<StockAnnouncement[]>([]);
const newsItems = ref<HotNewsItem[]>([]);
/** 资讯页内子页签：公告 / 新闻 */
const newsSubTab = ref<'ann' | 'news'>('ann');
const etfProfile = ref<EtfProfileRecord | null>(null);

const loadBottom = async (tab: BottomTab, force = false): Promise<void> => {
  if (!force && loadedTabs.has(tab)) return;
  loadedTabs.add(tab);
  bottomLoading.value = true;
  bottomError.value = false;
  try {
    if (tab === 'trade') {
      tradeRecords.value = await listTradeRecordsBySymbol(symbol.value);
    } else if (tab === 'etf') {
      const record = await getEtfHoldings(symbol.value);
      etfHoldings.value = record?.holdings ?? [];
    } else if (tab === 'news') {
      // 公告与个股新闻并发拉取，任一失败不影响另一列表（H5 无代理时静默降级为空态）
      const [ann, news] = await Promise.allSettled([
        fetchStockAnnouncements(symbol.value),
        fetchStockNews(symbol.value),
      ]);
      newsAnnouncements.value = ann.status === 'fulfilled' ? ann.value : [];
      newsItems.value = news.status === 'fulfilled' ? news.value : [];
      if (ann.status === 'rejected' && news.status === 'rejected') throw ann.reason;
    } else if (tab === 'fund') {
      etfProfile.value = await getEtfProfile(symbol.value);
    }
    // 'financial'：数据装配在 MobileFinancialPanel 内部，这里只登记已加载
  } catch {
    // H5 无 Tauri SQLite / 接口失败：静默降级为空态
    if (tab === 'trade') tradeRecords.value = [];
    else if (tab === 'etf') etfHoldings.value = [];
    else if (tab === 'news') {
      newsAnnouncements.value = [];
      newsItems.value = [];
    } else if (tab === 'fund') etfProfile.value = null;
  } finally {
    bottomLoading.value = false;
  }
};

const onBottomTab = (tab: BottomTab): void => {
  bottomTab.value = tab;
  void loadBottom(tab);
};

/* === 基金概况键值行（字段与 PC EtfProfileCard 同源，null 字段整行剔除） === */
const fundKvRows = computed<Array<{ k: string; v: string }>>(() => {
  const p = etfProfile.value;
  if (!p) return [];
  const rows: Array<{ k: string; v: string | null }> = [
    { k: '基金全称', v: p.fullName },
    { k: '基金类型', v: p.fundType },
    { k: '成立日期/规模', v: p.setupInfo },
    { k: '净资产规模', v: p.netAssetScale },
    { k: '份额规模', v: p.shareScale },
    { k: '基金经理人', v: p.fundManager },
    { k: '基金管理人', v: p.manager },
    { k: '基金托管人', v: p.custodian },
    { k: '成立来分红', v: p.dividend },
    { k: '管理费率', v: p.mgmtFeeRate },
    { k: '托管费率', v: p.custodyFeeRate },
    { k: '销售服务费率', v: p.salesServiceFeeRate },
    { k: '最高申购费率', v: p.maxPurchaseFeeRate },
    { k: '最高赎回费率', v: p.maxRedeemFeeRate },
    { k: '业绩比较基准', v: p.benchmark },
    { k: '跟踪标的', v: p.trackingTarget },
    { k: '投资目标', v: p.objective },
  ];
  return rows.filter((r): r is { k: string; v: string } => Boolean(r.v));
});

/* === 生命周期联动 === */
watch(symbol, () => {
  quote.value = null;
  bars.value = [];
  loadedTabs.clear();
  // 换股重置回交易记录：页签集合随标的类型（普通股 / 场内基金）变化，避免落在已消失的页签上
  bottomTab.value = 'trade';
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
        <div class="m-stk-head m-card">
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

        <!-- === 底部页签区：交易记录 / ETF 持仓股 / 财务 / 基金概况 / 资讯（按标的类型裁剪，同 PC 口径） === -->
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
          <!-- 财务：四张 datacenter 报表，页签切入才挂载拉数（快照 TTL 内秒出），与 PC 同口径 -->
          <MobileFinancialPanel v-if="bottomTab === 'financial'" :symbol="symbol" />
          <template v-else>
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
            <template v-else-if="bottomTab === 'etf'">
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
            <!-- 资讯：公告 + 个股新闻（东财源；进页签拉一次，不轮询），点行跳原文 -->
            <template v-else-if="bottomTab === 'news'">
              <div class="m-chips" style="padding: 10px 12px 0">
                <button
                  class="m-chip m-chip--sub"
                  :class="{ 'm-chip--active': newsSubTab === 'ann' }"
                  @click="newsSubTab = 'ann'"
                >
                  公告
                </button>
                <button
                  class="m-chip m-chip--sub"
                  :class="{ 'm-chip--active': newsSubTab === 'news' }"
                  @click="newsSubTab = 'news'"
                >
                  新闻
                </button>
              </div>
              <template v-if="newsSubTab === 'ann'">
                <div v-if="!newsAnnouncements.length" class="m-state">暂无公告</div>
                <a
                  v-for="a in newsAnnouncements"
                  :key="a.url"
                  class="m-row m-row--link"
                  :href="a.url"
                  target="_blank"
                  rel="noopener"
                >
                  <div class="m-row__nm">
                    {{ a.title }}
                    <span class="sub">{{ a.date }}</span>
                  </div>
                </a>
              </template>
              <template v-else>
                <div v-if="!newsItems.length" class="m-state">暂无新闻</div>
                <a
                  v-for="n in newsItems"
                  :key="n.oid"
                  class="m-row m-row--link"
                  :href="n.url"
                  target="_blank"
                  rel="noopener"
                >
                  <div class="m-row__nm">
                    {{ n.title }}
                    <span class="sub">{{ n.media }} {{ formatNewsTime(n.ctime) }}</span>
                  </div>
                </a>
              </template>
            </template>
            <!-- 基金概况：披露口径键值行（字段与 PC EtfProfileCard 同源） -->
            <template v-else-if="bottomTab === 'fund'">
              <div v-if="!etfProfile" class="m-state">暂无基金概况数据</div>
              <template v-else>
                <div v-for="kv in fundKvRows" :key="kv.k" class="m-kv">
                  <span class="m-kv__k">{{ kv.k }}</span>
                  <span class="m-kv__v">{{ kv.v }}</span>
                </div>
              </template>
            </template>
          </template>
        </div>
      </template>
      <div class="m-sub-tail"></div>
    </div>
  </div>
</template>

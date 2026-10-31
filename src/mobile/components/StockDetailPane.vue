<script setup lang="ts">
/**
 * 个股详情右栏窗格（lg 档主从布局统一底座，稿：Pad横屏主从布局改造 S10）
 *
 * 一期口径：报价头（名称/现价/涨跌 + 3×2 指标网格）+ 周期 chips（分时/日K/周K/月K）
 * + KlineChart + 五档盘口。数据装配与整页 MobileStockDetail 同源（fetchFullQuotes /
 * fetchKlineCached），一次性加载不轮询（与整页口径一致）；同 symbol 重复传入不重载。
 * 二期再补 F10 页签 / 资金 / 新闻 / 插件扩展区。
 *
 * 宿主约定：页面以 `<StockDetailPane :symbol="paneSymbol" @close="closePane" />`
 * 挂在右栏；占位态（symbol 空串）由页面自己渲染，本组件只在有目标时挂载。
 */
import { computed, ref, watch } from 'vue';
import { fetchFullQuotes } from '../../common/api/quotes.api';
import { fetchKlineCached } from '../../common/api/kline-cache.api';
import type { SinaKlinePeriod } from '../../common/api/sina-kline.api';
import {
  CHART_PERIOD_OPTIONS,
  CHART_PERIOD_DEFAULT,
} from '../../common/constants/stock-detail.constants';
import type { KLineData } from 'klinecharts';
import type { FullQuote } from 'stock-sdk';
import { isHkSymbol } from '../../common/utils/is-hk-symbol';
import KlineChart from '../../common/components/charts/KlineChart.vue';
import { pctClass } from '../utils/format';

const props = defineProps<{
  /** 完整符号（sh600519 形态；空串不加载——宿主约定只在有目标时挂载） */
  symbol: string;
}>();

const emit = defineEmits<{ close: [] }>();

/** 窗格周期 chips（整页 CHART_PERIOD_OPTIONS 去掉 5分/五日：右栏窄幅留核心四档） */
const PERIOD_OPTIONS = CHART_PERIOD_OPTIONS.filter(
  (opt) => opt.value !== 'min5' && opt.value !== 'fiveDay',
);

/** 符号市场（hk 港股 / cn A 股缺省）：K 线分时固定轴按市场取 */
const symbolMarket = computed<'hk' | 'cn'>(() => (isHkSymbol(props.symbol) ? 'hk' : 'cn'));

/* === 报价头 === */
const quote = ref<FullQuote | null>(null);
const quoteLoading = ref(false);
const quoteError = ref(false);

const loadQuote = async (): Promise<void> => {
  if (!props.symbol) return;
  quoteLoading.value = true;
  quoteError.value = false;
  try {
    const list = await fetchFullQuotes([props.symbol]);
    quote.value = list[0] ?? null;
    if (!quote.value) quoteError.value = true;
  } catch (error) {
    // 真机排查入口：报价失败必须留原始报错（含通道信息），否则窗格只剩一个无因错误态
    console.error('[stock-detail-pane] 报价加载失败', error);
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

/** 3×2 指标网格（语义同整页报价头） */
const headGrid = computed(() => {
  const q = quote.value;
  const f = (v: number | null | undefined, digits = 2): string =>
    v === null || v === undefined ? '--' : v.toFixed(digits);
  return [
    {
      t: '今开',
      v: f(q?.open),
      cls: pctClass(q && q.open > q.prevClose ? 1 : q && q.open < q.prevClose ? -1 : 0),
    },
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
  if (!props.symbol) return;
  klineLoading.value = true;
  klineError.value = false;
  bars.value = [];
  try {
    bars.value = await fetchKlineCached(props.symbol, period.value);
  } catch (error) {
    // 真机排查入口：K 线失败留原始报错（含通道 / 缓存层信息），否则窗格无从定位
    console.error('[stock-detail-pane] K 线加载失败', error);
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

/**
 * 五档量格式化（与整页同口径：≥100 万手转万）
 * @param v 手数（可空）
 * @returns 展示文本
 */
const fmtVol = (v: number | null): string =>
  v === null || v === undefined ? '--' : v >= 1e6 ? `${(v / 1e6).toFixed(1)}万` : String(v);

/* === 目标切换：一次性重载（同 symbol 不重复触发） === */
watch(
  () => props.symbol,
  (next, prev) => {
    if (!next || next === prev) return;
    quote.value = null;
    bars.value = [];
    period.value = CHART_PERIOD_DEFAULT;
    void loadQuote();
    void loadKline();
  },
  { immediate: true },
);

/* 切周期重拉 K 线（与整页 watch(period) 同口径） */
watch(period, () => void loadKline());
</script>

<template>
  <div class="m-pane">
    <header class="m-pane__head">
      <div class="m-pane__nm">
        {{ quote?.name ?? '--' }}<span class="code">{{ symbol }}</span>
      </div>
      <button type="button" class="m-pane__close" aria-label="关闭窗格" @click="emit('close')">
        ✕
      </button>
      <template v-if="quote">
        <div class="m-pane__px" :class="pctClass(quote.changePercent)">
          {{ quote.price?.toFixed(2) ?? '--' }}
        </div>
        <div class="m-pane__chg" :class="pctClass(quote.changePercent)">{{ chgText }}</div>
      </template>
    </header>

    <!-- 加载 / 错误 / 主体三态 -->
    <div v-if="quoteLoading" class="m-card m-skel-fill">
      <div v-for="i in 4" :key="i" class="m-skel-row"></div>
    </div>
    <div v-else-if="quoteError || !quote" class="m-state">
      行情加载失败
      <span class="retry" @click="loadQuote()">重试</span>
    </div>
    <template v-else>
      <div class="m-pane__grid">
        <div v-for="g in headGrid" :key="g.t">
          <div class="m-pane__grid-t">{{ g.t }}</div>
          <div class="m-pane__grid-v" :class="g.cls">{{ g.v }}</div>
        </div>
      </div>

      <!-- 周期 chips + K 线 -->
      <div class="m-chips">
        <button
          v-for="opt in PERIOD_OPTIONS"
          :key="opt.value"
          class="m-chip"
          :class="{ 'm-chip--active': period === opt.value }"
          @click="period = opt.value"
        >
          {{ opt.label }}
        </button>
      </div>
      <div class="m-card">
        <div v-if="klineLoading" class="m-skel-chart"></div>
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
            :market="symbolMarket"
            auto-height
          />
        </div>
      </div>

      <!-- 五档盘口 -->
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
    </template>
  </div>
</template>

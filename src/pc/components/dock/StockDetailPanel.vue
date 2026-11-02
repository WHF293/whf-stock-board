<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import dayjs from 'dayjs';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import KlineChart from '../../../common/components/charts/KlineChart.vue';
import StockQuoteHeader from '../business/StockQuoteHeader.vue';
import DockResizer from '../business/DockResizer.vue';
import { fetchFullQuotes } from '../../../common/api/quotes.api.ts';
import { fetchKlineCached } from '../../../common/api/kline-cache.api.ts';
import { listTradeRecordsBySymbol } from '../../../common/api/account-records-db.api.ts';
import type { AccountTradeRecord } from '../../../common/types/account.types.ts';
import {
  buildDailyTradeMarks,
  buildIntradayTradeMarks,
  type TradeMark,
} from '../../../common/utils/trade-marks';
import { CHART_PERIOD_OPTIONS } from '../../../common/constants/stock-detail.constants.ts';
import {
  DOCK_LAYOUT_CANVAS_PADDING,
} from '../../../common/constants/dock-panel.constants.ts';
import { ROUTE_PATH } from '../../../common/constants/router-meta.constants.ts';
import { usePolling } from '../../../common/composables/use-polling';
import { useKlineLive } from '../../../common/composables/use-kline-live';
import { useChartPeriod } from '../../../common/composables/use-chart-period';
import { useCrosshairQuote } from '../../../common/composables/use-crosshair-quote';
import { POLLING_INTERVAL } from '../../../common/constants/polling.constants.ts';
import type { KLineData } from 'klinecharts';
import type { FullQuote } from '../../../common/types/stock-quote.types.ts';
import { toFullSymbol } from '../../../common/utils/to-full-symbol';
import { useDataCacheStore } from '../../../common/stores/data-cache';
import { useDockPanelStore } from '../../../common/stores/dock-panel';
import { DATA_CACHE_KEY } from '../../../common/constants/data-cache.constants.ts';
import { isHkSymbol } from '../../../common/utils/is-hk-symbol';
import { spliceTodayBar } from '../../../common/utils/splice-today-bar';
import { mergeKlineBars } from '../../../common/utils/merge-kline-bars';
import { pluginKernel } from '../../../common/plugin/index';

/**
 * 个股详情面板（右侧停靠面板内容，布局参考同花顺移动端）：
 * 报价头 + 分时/五日/5分/日K/周K/月K 按钮组切换（五档盘口 2026-10-24 王总指定移除，
 * 盘口在详情整页右栏查看）
 *
 * K 线走新浪源（不复权），为重接口，仅在打开面板或切换周期时拉取一次，不参与轮询；
 * 全部数据有内存快照：同标的重复打开先展示快照，接口返回后刷新；
 * 切股 / 切周期图表原地更新（不带 :key 重挂，2026-11-02 王总反馈切换闪烁）：
 * 有旧图先保留旧图轻微变暗，数据就位后原地刷新；骨架屏仅首次无数据时出现；
 * 成交 BS/T 标注与详情整页同口径（分钟级吸附分时/五日、按日聚合到蜡烛），
 * 分时/五日的延伸方向按「成交价 vs 昨收」判定
 */
const props = defineProps<{
  /** 个股符号（sh600519 / 600519 等形态均可，内部归一化） */
  symbol: string;
}>();

const dataCache = useDataCacheStore();
const dockPanel = useDockPanelStore();

/**
 * 归一化符号：600519 / SH600519 / sh600519 等形态统一为 sh600519
 */
const symbol = computed<string>(() => toFullSymbol(String(props.symbol ?? '')));

/** 符号市场（hk 港股 / cn A 股缺省）：K 线分时固定轴与轮询窗口按市场取 */
const symbolMarket = computed<'hk' | 'cn'>(() => (isHkSymbol(symbol.value) ? 'hk' : 'cn'));

// ---------- 「查看更多」：跳转个股详情整页（2026-10-24 王总指定，
//             报价头右上角高光按钮；自选增删由详情页顶栏承接，侧栏不再放） ----------
const router = useRouter();

/** 关闭面板后路由跳转（与 DockPanel 头部展开按钮同款行为） */
const openDetailPage = (): void => {
  const target = symbol.value;
  dockPanel.close();
  void router.push(`${ROUTE_PATH.STOCK_DETAIL}/${target}`);
};

// ---------- 报价头（4s 轮询；快照播种） ----------
const quoteRef = ref<FullQuote | null>(
  dataCache.get<FullQuote>(DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + symbol.value),
);

const fetchQuote = async (): Promise<void> => {
  const quotes = await fetchFullQuotes([symbol.value]);
  quoteRef.value = quotes[0] ?? null;
  if (quoteRef.value) {
    dataCache.set(DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + symbol.value, quoteRef.value);
  }
};

usePolling({
  task: fetchQuote,
  intervalMs: POLLING_INTERVAL.QUOTES_INTRADAY,
  tradingAware: true,
  // getter：面板实例跨标的复用（A 股 ↔ 港股切换不重挂），窗口随符号响应式切换
  market: () => (symbolMarket.value === 'hk' ? 'HK' : 'A'),
});

// ---------- 图表周期（按钮组切换：分时 / 五日 / 5分 / 日K / 周K / 月K，均走新浪源） ----------
// 周期选项与详情页共用（constants/stock-detail.constants.ts），避免两处漂移；
// 选择本身也持久化（composables/use-chart-period.ts），下次打开默认回到上次的周期
const chartPeriod = useChartPeriod();

/** 图表模式：分时 / 五日为分时线，其余为蜡烛图 */
const chartMode = computed<'timeline' | 'candle'>(() =>
  chartPeriod.value === 'minute' || chartPeriod.value === 'fiveDay' ? 'timeline' : 'candle',
);

// ---------- 盘中实时最后一根柱（2026-11-02 王总指定：轮询分时接口构建，
// 经图表 subscribeBar 通道原地更新最后一根柱，不整图重载） ----------
const liveBar = useKlineLive({
  symbol,
  market: () => symbolMarket.value,
  period: () => chartPeriod.value,
});

// 单日分时（全天固定占位轴）无法走 subscribeBar 增量：轴尾占位格时间戳大于实时分钟，
// 图表按「小于最后一根」忽略推送 ⇒ 走父级序列合并 + 整图刷新
// （分时默认铺满全轴，刷新视觉无感，仅十字光标瞬时清除）
watch(liveBar, (bar) => {
  if (!bar || chartPeriod.value !== 'minute') return;
  klines.value = mergeKlineBars(klines.value, [bar]);
});

/** K 线快照键（符号 + 周期，不复权无口径差异） */
const klineCacheKey = computed(
  () => `${DATA_CACHE_KEY.DETAIL_KLINE_PREFIX}${symbol.value}.${chartPeriod.value}`,
);

const klines = ref<KLineData[]>(dataCache.get<KLineData[]>(klineCacheKey.value) ?? []);
const isKlineLoading = ref(klines.value.length === 0);
const klineError = ref(false);

const loadKline = async (): Promise<void> => {
  isKlineLoading.value = true;
  klineError.value = false;
  try {
    // 快照播种：同符号同周期先前拉取过则秒出
    const cachedBars = dataCache.get<KLineData[]>(klineCacheKey.value);
    if (cachedBars) {
      klines.value = cachedBars;
      isKlineLoading.value = false;
    }
    // 日 K 走本地缓存（首次全量落库，之后只补缺口）；分时等周期退回纯网络取数
    const bars = await fetchKlineCached(symbol.value, chartPeriod.value);
    klines.value = bars;
    applyTodayBar();
    dataCache.set(klineCacheKey.value, bars);
  } catch (error) {
    // 失败保留上一次成功数据（首次失败则展示空态）
    klineError.value = klines.value.length === 0;
    console.error('[stock-detail] kline', error);
  } finally {
    isKlineLoading.value = false;
  }
};

/**
 * 用实时报价向日 K 序列拼接当日柱（2026-11-02 王总反馈日K缺当日柱：
 * 新浪日K盘中不含当日未走完的 bar，量纲换算与拼接规则见 spliceTodayBar 注释）。
 * 仅日 K + A 股；拼接结果不写缓存 / 快照（缓存只存上游真数据）
 */
const applyTodayBar = (): void => {
  if (chartPeriod.value !== 'daily' || symbolMarket.value !== 'cn') return;
  const next = spliceTodayBar(klines.value, quoteRef.value);
  if (next !== klines.value) {
    klines.value = next;
  }
};

// 日K先于报价就位（冷启动无快照）⇒ 报价首次到达补拼当日柱；
// 当日柱已在（拼接过 / 收盘后上游已含）时 todayKey == lastKey，守卫使其不再触发，
// 避免盘中每次报价轮询都整图重载（klinecharts v10 无单柱更新 API）
watch(quoteRef, (quote) => {
  if (!quote || klines.value.length === 0) return;
  const lastKey = dayjs(klines.value[klines.value.length - 1].timestamp).format('YYYY-MM-DD');
  if (dayjs(quote.timestamp ?? Date.now()).format('YYYY-MM-DD') > lastKey) {
    applyTodayBar();
  }
});

// ---------- 十字光标联动（K 线悬停 bar -> 行情头临时展示该根 OHLCV） ----------
// 与个股详情整页（StockDetailView）共用同一组合式函数；悬停时价格 / 涨跌幅
// 按该根 close 相对自身昨收重算（量纲换算见 use-crosshair-quote），离开图表回落实时报价
const { onCrosshairBar, displayQuote } = useCrosshairQuote({
  quote: quoteRef,
  bars: klines,
  mode: chartMode,
});

// ---------- 交易记录 BS/T 标注（本地交割单库，按股票；与详情整页同口径） ----------
/** 该股成交记录（跨账户；浏览器 dev 无本地库，恒为空列表） */
const tradeRecords = ref<AccountTradeRecord[]>([]);

/** 拉取该股全部成交记录（本地 SQLite 直读，非网络请求，失败即空列表） */
const loadTradeRecords = async (): Promise<void> => {
  try {
    tradeRecords.value = await listTradeRecordsBySymbol(symbol.value);
  } catch (error) {
    console.error('[stock-detail-panel] trade-records', error);
    tradeRecords.value = [];
  }
};

/** 当前图表模式对应的标注集（分时/五日 = 分钟点；蜡烛 = 按成交日聚合的 B/S/T） */
const chartTradeMarks = computed<TradeMark[]>(() =>
  chartMode.value === 'timeline'
    ? buildIntradayTradeMarks(tradeRecords.value)
    : buildDailyTradeMarks(tradeRecords.value),
);

// 符号变化全量重拉；周期变化只刷 K 线（组件内状态切换，面板不重载）
watch(
  symbol,
  () => {
    // 报价快照播种：该股先前拉过则报价头立即展示正确数据，
    // 避免网络返回前短暂残留上一只股票的报价（无缓存时保留旧值，不发骨架屏）
    const cachedQuote = dataCache.get<FullQuote>(
      DATA_CACHE_KEY.DETAIL_QUOTE_PREFIX + symbol.value,
    );
    if (cachedQuote) quoteRef.value = cachedQuote;
    void loadKline();
    void fetchQuote();
    void loadTradeRecords();
  },
  { immediate: true },
);
watch(chartPeriod, () => {
  void loadKline();
});

/**
 * dock-panel 拖拽：把当前鼠标 X 换算为「面板右缘到视口右缘」的宽度
 * 写入 store（store 内 clamp 到 375 ~ 60vw 并持久化）
 *
 * Islands 布局（2026-10-22）后面板右缘距视口右缘有一份画布留白，换算须扣除
 * @param clientX
 */
const onDockResize = (clientX: number): void => {
  dockPanel.setWidth(window.innerWidth - clientX - DOCK_LAYOUT_CANVAS_PADDING);
};

/** 拖拽结束信号（自增 tick，驱动 K 线图强制重绘适配最终宽度） */
const chartResizeTick = ref(0);
const onDockResizeEnd = (): void => {
  chartResizeTick.value += 1;
};

// ---------- 个股详情扩展区（插件贡献，宿主只承载不参与内容） ----------
/** 已注册的扩展区块（按 order 升序；插件挂载 / 卸载自动增删） */
const detailSections = computed(() => pluginKernel.contributions.stockDetail.sections);
</script>

<template>
  <div class="space-y-3">
    <!-- 报价头：名称左对齐 + 「查看更多」高光按钮（2026-10-24 王总指定改版） -->
    <BaseCard>
      <StockQuoteHeader :quote="displayQuote" @open-detail="openDetailPage" />
    </BaseCard>

    <!-- 主图区（relative 供拖拽手柄定位）：K 线卡片 + 五档盘口卡片 -->
    <div class="relative flex flex-col gap-3">
      <!-- 拖拽手柄：挂在 K 线卡片左缘 -->
      <DockResizer
        v-if="dockPanel.open"
        :on-resize="onDockResize"
        @resize-end="onDockResizeEnd"
      />

      <!-- K 线卡片：无标题，头部右侧为周期切换按钮组 -->
      <BaseCard>
        <template #extra>
          <BaseTabs
            v-model="chartPeriod"
            :options="CHART_PERIOD_OPTIONS"
            aria-label="K 线周期"
          />
        </template>
        <!-- 有数据就始终原地渲染图表（KlineChart 内部 watch displayBars/mode 原地换数据，
             不带 :key 强制重挂——2026-11-02 王总反馈切股闪烁，重挂会导致 canvas 清空重建）；
             切股/切周期加载中只轻微变暗 + 角落 spinner，骨架屏仅留给首次无数据的场景 -->
        <div
          v-if="klines.length > 0"
          class="relative transition-opacity duration-200"
          :class="{ 'opacity-50': isKlineLoading }"
        >
          <KlineChart
            :bars="klines"
            :live-bar="liveBar"
            :mode="chartMode"
            :pre-close="quoteRef?.prevClose ?? null"
            :symbol="symbol"
            :intraday-axis="chartPeriod === 'minute'"
            :market="symbolMarket"
            :trade-marks="chartTradeMarks"
            sub-volume-only
            :resize-tick="chartResizeTick"
            @crosshair-bar="onCrosshairBar"
          />
          <span
            v-if="isKlineLoading"
            class="absolute right-2 top-2 h-3 w-3 animate-spin rounded-full border-2 border-flat-weak border-t-primary"
            role="status"
            aria-label="K 线加载中"
          />
        </div>
        <div v-else-if="klineError" class="py-10">
          <BaseEmpty text="K 线数据加载失败，请稍后重试（上游可能限频，稍后自动恢复）" />
        </div>
        <BaseSkeleton v-else />
      </BaseCard>
    </div>

    <!-- 插件扩展区：内容完全由插件决定，宿主只传入当前股票符号 -->
    <BaseCard v-for="section in detailSections" :key="section.key" :title="section.title">
      <component :is="section.component" v-bind="section.props" :symbol="symbol" />
    </BaseCard>
  </div>
</template>

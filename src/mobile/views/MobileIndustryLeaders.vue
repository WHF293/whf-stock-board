<script setup lang="ts">
/**
 * 行业龙头（2026-10-29 新增二级页，入口在首页金刚区；PC 行情全景-行业龙头模块的移动版）
 *
 * 数据源与 PC 完全同源：清单为 common 层 `industry-leaders.constants.ts` 写死的
 * 板块 / 细分赛道两组固定名单（分组与成员不可改、顺序不持久化），报价走
 * `fetchLeaderQuotes`（A 股腾讯批量 + 港股 sdk 补齐），随前台轮询刷新。
 *
 * 页面编排：维度 chips（板块 / 细分赛道）→ 各分组一张卡（组名 + 成员行：
 * 名称（代码）/ 现价 / 涨跌幅），点击行进个股详情页。PC 的拖拽排序 / 详情整页
 * 为桌面交互，移动端不做。
 */
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  LEADER_KIND,
  LEADER_KIND_OPTIONS,
  getLeaderGroups,
  type LeaderKind,
} from '../../common/constants/industry-leaders.constants.ts';
import { fetchLeaderQuotes, type LeaderQuote } from '../../common/api/industry-leaders.api.ts';
import { useMobilePolling } from '../composables/use-mobile-polling';
import { useBreakpoint } from '../composables/use-breakpoint';
import { useStockPane } from '../composables/use-stock-pane';
import StockDetailPane from '../components/StockDetailPane.vue';
import { pctClass } from '../utils/format';
import { mobileCacheGet, mobileCacheSet } from '../cache';

/* lg 档主从布局（稿：Pad横屏主从布局改造 S5）：点行右栏就地看个股 */
const { lg } = useBreakpoint();
const { paneSymbol, paneOpen, openStock, closePane } = useStockPane();

const router = useRouter();

/** 当前维度（板块 / 细分赛道；会话内状态） */
const kind = ref<LeaderKind>(LEADER_KIND.BOARD);

/** 当前维度的分组列表 */
const groups = computed(() => getLeaderGroups(kind.value));

/** 报价映射（完整符号 → 轻报价；港股以 hk 前缀符号为键） */
const quotesMap = ref<Map<string, LeaderQuote>>(new Map());
const loading = ref(false);
const error = ref(false);

const CACHE_KEY = 'industry-leaders.quotes';

/** 拉取报价（进行中共享任务防重入；成功写 30s TTL 快照） */
let quotesTask: Promise<void> | null = null;
const loadQuotes = async (force = false): Promise<void> => {
  if (!force && quotesMap.value.size > 0) return;
  if (quotesTask) return quotesTask;
  quotesTask = (async () => {
    try {
      const cached = mobileCacheGet<Map<string, LeaderQuote>>(CACHE_KEY, 30_000);
      if (!force && cached) {
        quotesMap.value = new Map(Object.entries(cached.value));
      } else {
        const symbols = groups.value.flatMap((group) => group.stocks.map((stock) => stock.symbol));
        const map = await fetchLeaderQuotes(symbols);
        quotesMap.value = map;
        mobileCacheSet(CACHE_KEY, Object.fromEntries(map));
      }
      error.value = false;
    } catch {
      if (quotesMap.value.size === 0) error.value = true;
    } finally {
      quotesTask = null;
      loading.value = false;
    }
  })();
  return quotesTask;
};

/** 前台轮询（间隔跟随移动端设置档位） */
useMobilePolling(() => loadQuotes(true));

onMounted(() => {
  void loadQuotes();
});

/**
 * 切维度：重新取数（快照先行）
 * @param value 目标维度（板块 / 细分赛道）
 */
const onKindChange = (value: LeaderKind): void => {
  kind.value = value;
  void loadQuotes(true);
};

/**
 * 取某标的报价（未就绪/港股缺价返回 null，模板兜底 --）
 * @param symbol 完整符号
 * @returns 轻报价或 null
 */
const quoteOf = (symbol: string): LeaderQuote | null => quotesMap.value.get(symbol) ?? null;

/**
 * 行点击：lg 档写右栏窗格就地阅读，窄档 / 竖屏进个股详情页
 * （港股 A 股口径详情可能无数据，由详情页 / 窗格自行兜底）
 * @param symbol 完整符号
 */
const goStock = (symbol: string): void => {
  if (lg.value) {
    openStock(symbol);
    return;
  }
  void router.push(`/stock/${symbol}`);
};

/** 下拉刷新 */
const refreshing = ref(false);
const onRefresh = async (): Promise<void> => {
  try {
    await loadQuotes(true);
  } finally {
    refreshing.value = false;
  }
};
</script>

<template>
  <div class="m-page-flex">
    <van-nav-bar
      title="行业龙头"
      class="m-nav"
      safe-area-inset-top
      left-arrow
      @click-left="router.back()"
    />

    <!-- lg 主从布局（稿 S5）：左龙头清单 + 右个股详情窗格 -->
    <div class="m-duo">
      <div class="m-duo__l">
        <!-- 维度 chips（板块 / 细分赛道） -->
        <div class="m-chips" style="padding-top: 8px">
          <button
            v-for="opt in LEADER_KIND_OPTIONS"
            :key="opt.value"
            class="m-chip"
            :class="{ 'm-chip--active': kind === opt.value }"
            @click="onKindChange(opt.value)"
          >
            {{ opt.label }}
          </button>
        </div>

        <div class="m-sub-scroll m-il-scroll">
          <van-pull-refresh v-model="refreshing" @refresh="onRefresh">
            <div v-if="loading && quotesMap.size === 0" class="m-card m-skel-fill">
              <div v-for="i in 8" :key="i" class="m-skel-row"></div>
            </div>
            <div v-else-if="error && quotesMap.size === 0" class="m-state">
              龙头报价加载失败
              <span class="retry" @click="loadQuotes(true)">重试</span>
            </div>
            <template v-else>
              <div class="m-sec"><span class="m-sec__t">点击行进个股页 · 清单固定不可改</span></div>
              <div v-for="group in groups" :key="group.name" class="m-card m-il-group">
                <div class="m-il-group__head">
                  <span class="m-il-group__name">{{ group.name }}</span>
                  <span class="m-il-group__count">{{ group.stocks.length }} 只</span>
                </div>
                <div
                  v-for="stock in group.stocks"
                  :key="stock.symbol"
                  class="m-row"
                  :class="{ 'm-row--pane': paneSymbol === stock.symbol }"
                  @click="goStock(stock.symbol)"
                >
                  <span class="m-row__nm">
                    {{ quoteOf(stock.symbol)?.name ?? stock.name }}
                    <span class="code">{{ stock.symbol.slice(2) }}</span>
                  </span>
                  <span class="m-row__val">{{ quoteOf(stock.symbol)?.price?.toFixed(2) ?? '--' }}</span>
                  <span class="m-row__pct" :class="pctClass(quoteOf(stock.symbol)?.changePercent ?? null)">
                    {{ (quoteOf(stock.symbol)?.changePercent ?? null) === null ? '--' : (quoteOf(stock.symbol)!.changePercent! > 0 ? '+' : '') + quoteOf(stock.symbol)!.changePercent!.toFixed(2) + '%' }}
                  </span>
                </div>
              </div>
            </template>
          </van-pull-refresh>
          <div class="m-sub-tail"></div>
        </div>
      </div>
      <!-- 右窗格仅选中个股时渲染（2026-10-31 王总指定「选中才显示右边栏」），未选中左栏铺满 -->
      <aside v-if="lg && paneOpen" class="m-duo__r">
        <StockDetailPane :symbol="paneSymbol" @close="closePane" />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.m-il-scroll {
  padding-top: 8px;
}
.m-il-group {
  padding: 0 0 4px;
}
.m-il-group__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  padding: 10px 14px 6px;
  border-bottom: 1px solid var(--color-border);
}
.m-il-group__name {
  font-size: 13.5px;
  font-weight: 700;
  color: var(--color-text-1);
}
.m-il-group__count {
  font-size: 10.5px;
  color: var(--color-text-3);
}
.m-il-group .m-row .code {
  margin-left: 6px;
  font-family: var(--font-num, 'SF Mono', Menlo, Consolas, monospace);
  font-size: 10px;
  color: var(--color-text-3);
}
.m-il-group .m-row__val {
  flex-shrink: 0;
  font-size: 13px;
  font-weight: 600;
}
</style>

<script setup lang="ts">
import { computed, onActivated, ref } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseCard from '../ui/BaseCard.vue';
import BaseEmpty from '../ui/BaseEmpty.vue';
import BaseSkeleton from '../ui/BaseSkeleton.vue';
import BaseTable from '../ui/BaseTable.vue';
import BaseTabs from '../ui/BaseTabs.vue';
import { fetchIpoBoard } from '../../api/ipo-board.api';
import type { IpoBoardItem } from '../../types/ipo-board.types';
import { useDataCacheStore } from '../../stores/data-cache';
import { DATA_CACHE_KEY } from '../../constants/data-cache.constants';
import {
  IPO_BOARD_RANGE_DEFAULT,
  IPO_BOARD_RANGE_OPTIONS,
  IPO_BOARD_TABLE_MIN_WIDTH,
  IPO_BOARD_TTL_MS,
} from '../../constants/ipo-board.constants';
import { POLLING_INTERVAL } from '../../constants/polling.constants';
import { usePolling } from '../../composables/use-polling';
import { useStockOpen } from '../../composables/use-stock-open';
import { toFullSymbol } from '../../utils/to-full-symbol';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import type { TableColumn } from '../../types/table.types';

/**
 * 行情全景 · 新股次新股（数据自管）：
 * 同花顺新股频道「新股申购与上市」整页清单（GBK HTML，服务端渲染全量）。
 *
 * - 默认展示申购日期在 30 天内的股票，可切 10 / 30 / 60 天（按 |今天 - 申购日期| 过滤，
 *   含未来几天待申购的新股）；
 * - 每 30 分钟自动更新一次（usePolling，非交易窗口感知——新股清单与盘中无关）；
 * - 内存快照 30 分钟 TTL：期内切回秒出，过期后进入页面自动重拉；
 *   「刷新」按钮无视 TTL 强制重拉；
 * - 工具条标注上次更新时间（HH:mm:ss）
 */

const { openSidebar } = useStockOpen();
const dataCache = useDataCacheStore();

/** 缓存快照结构（dataCache 内存态） */
interface IpoBoardCache {
  items: IpoBoardItem[];
  fetchedAt: number;
}

const cached = dataCache.get<IpoBoardCache>(DATA_CACHE_KEY.PANORAMA_IPO_BOARD);

/** 全量清单（申购日期已补全年份；保持页面顺序：申购日期升序） */
const items = ref<IpoBoardItem[]>(cached?.items ?? []);
/** 快照抓取时间（毫秒；0 = 从未加载） */
const fetchedAt = ref<number>(cached?.fetchedAt ?? 0);
const isLoading = ref(items.value.length === 0);
const isError = ref(false);

/** 上次更新时间文案（HH:mm:ss；未加载为空） */
const lastUpdatedText = computed(() => {
  if (fetchedAt.value === 0) return '';
  const d = new Date(fetchedAt.value);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `上次更新 ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
});

/**
 * 快照是否在 30 分钟有效期内
 * @returns 是否未过期
 */
const isFresh = (): boolean =>
  fetchedAt.value > 0 && Date.now() - fetchedAt.value < IPO_BOARD_TTL_MS;

/**
 * 拉取清单（成功写快照；进行中调用直接跳过防重入）
 * @returns 完成后 resolve
 */
const load = async (): Promise<void> => {
  if (isLoading.value) return;
  isLoading.value = true;
  try {
    items.value = await fetchIpoBoard();
    fetchedAt.value = Date.now();
    isError.value = false;
    dataCache.set(DATA_CACHE_KEY.PANORAMA_IPO_BOARD, {
      items: items.value,
      fetchedAt: fetchedAt.value,
    } satisfies IpoBoardCache);
  } catch (error) {
    isError.value = items.value.length === 0;
    console.error('[panorama-ipo]', error);
  } finally {
    isLoading.value = false;
  }
};

// 首屏：快照缺失或过期时拉取（期内复用快照不请求；立即档交给下方轮询引擎）
if (!isFresh()) {
  void load();
}

// 每 30 分钟自动更新一次（immediate=false：首次请求由上面的 TTL 判定发起，避免重复）
usePolling({
  task: () => load(),
  intervalMs: POLLING_INTERVAL.IPO_BOARD,
  tradingAware: false,
  immediate: false,
});

// KeepAlive 缓存页面：切回时快照已过期则立即重拉（首次 onActivated 跳过，交给首屏）
let ipoActivatedOnce = false;
onActivated(() => {
  if (!ipoActivatedOnce) {
    ipoActivatedOnce = true;
    return;
  }
  if (!isFresh() && !isLoading.value) {
    void load();
  }
});

/** 强制刷新：无视 30 分钟 TTL 立即重拉 */
const forceRefresh = (): void => {
  if (!isLoading.value) void load();
};

// ---------- 申购日期范围过滤 ----------

/** 当前申购日期范围（天） */
const rangeDays = ref<number>(IPO_BOARD_RANGE_DEFAULT);

/** BaseTabs 字符串 v-model 适配 */
const rangeModel = computed<string>({
  get: () => String(rangeDays.value),
  set: (value) => {
    rangeDays.value = Number(value);
  },
});

/**
 * 申购日期距今的天数（按日历日差的绝对值；负数 = 未来申购）
 * @param item 新股条目
 * @returns 天数；日期非法时为 null（过滤时排除）
 */
const daysFromApply = (item: IpoBoardItem): number | null => {
  const apply = new Date(`${item.applyDate}T00:00:00`);
  if (Number.isNaN(apply.getTime())) return null;
  const today = new Date();
  const todayMid = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((apply.getTime() - todayMid.getTime()) / 86_400_000);
};

/** 按申购日期范围过滤后的清单（保持页面顺序） */
const visibleItems = computed(() =>
  items.value.filter((item) => {
    const days = daysFromApply(item);
    return days !== null && Math.abs(days) <= rangeDays.value;
  }),
);

// ---------- 表格 ----------

/** 新股清单列配置（申购日期 / 发行价 / 涨幅 / 收益 / 连板可排序） */
const columns: TableColumn<IpoBoardItem>[] = [
  { key: 'name', label: '股票' },
  { key: 'applyCode', label: '申购代码', align: 'right' },
  {
    key: 'applyDate',
    label: '申购日期',
    align: 'right',
    sortable: true,
    sortValue: (item) => item.applyDate,
  },
  {
    key: 'issuePrice',
    label: '发行价',
    align: 'right',
    sortable: true,
    sortValue: (item) => item.issuePrice,
  },
  { key: 'issuePe', label: '发行市盈率', align: 'right' },
  { key: 'industryPe', label: '行业市盈率', align: 'right' },
  { key: 'totalIssueWan', label: '发行总数(万股)', align: 'right' },
  { key: 'applyCapWan', label: '申购上限(万股)', align: 'right' },
  {
    key: 'lotteryRate',
    label: '中签率(%)',
    align: 'right',
    sortable: true,
    sortValue: (item) => item.lotteryRate,
  },
  { key: 'paymentDate', label: '缴款日期', align: 'right' },
  { key: 'listDate', label: '上市日期', align: 'right' },
  {
    key: 'firstDayMaxRise',
    label: '首日最高涨幅',
    align: 'right',
    sortable: true,
    sortValue: (item) => item.firstDayMaxRise,
  },
  {
    key: 'limitUpDays',
    label: '连板天数',
    align: 'right',
    sortable: true,
    sortValue: (item) => item.limitUpDays,
  },
  {
    key: 'earn',
    label: '打新收益(元)',
    align: 'right',
    sortable: true,
    sortValue: (item) => item.earn,
  },
];

/**
 * 数值占位（null → '--'）
 * @param value 数值
 * @returns 展示文本
 */
const numText = (value: number | null): string => (value === null ? '--' : String(value));

/**
 * 点击行：打开个股详情侧栏（全站统一交互）
 * @param item 新股条目
 */
const onRowClick = (item: IpoBoardItem): void => {
  openSidebar(toFullSymbol(item.code));
};
</script>

<template>
  <BaseCard fill class="flex min-h-0 flex-col">
    <!-- 工具条：范围切换 + 上次更新 + 强制刷新 -->
    <div class="flex shrink-0 flex-wrap items-center justify-between gap-2 px-4 py-2">
      <div class="flex items-center gap-3">
        <BaseTabs v-model="rangeModel" :options="IPO_BOARD_RANGE_OPTIONS" />
        <span class="text-xs text-text-tertiary">
          按申购日期过滤（含未来待申购）· 共 {{ visibleItems.length }} 只
        </span>
      </div>
      <div class="flex items-center gap-3">
        <span class="text-xs text-text-tertiary">{{ lastUpdatedText }}</span>
        <BaseButton variant="ghost" :disabled="isLoading" @click="forceRefresh">刷新</BaseButton>
      </div>
    </div>

    <div class="flex min-h-0 flex-1 flex-col px-4 pb-4">
      <div v-if="isLoading && items.length === 0" class="flex-1"><BaseSkeleton /></div>
      <div v-else-if="isError && items.length === 0" class="flex flex-1 flex-col justify-center py-10">
        <BaseEmpty text="新股清单加载失败，请稍后重试" />
        <div class="flex justify-center">
          <BaseButton variant="ghost" :disabled="isLoading" @click="forceRefresh">重试</BaseButton>
        </div>
      </div>
      <BaseEmpty v-else-if="visibleItems.length === 0" text="该范围内暂无新股申购" />
      <BaseTable
        v-else
        :columns="columns"
        :rows="visibleItems"
        :row-key="(item) => item.code"
        :min-width="IPO_BOARD_TABLE_MIN_WIDTH"
        scroll-class="table-scroll-fill"
        row-clickable
        @row-click="onRowClick"
      >
        <template #name="{ row: item }: { row: IpoBoardItem }">
          <span class="font-medium text-text">{{ item.name }}</span>
          <span class="ml-1 text-xs text-text-tertiary">{{ item.code }}</span>
        </template>
        <template #issuePrice="{ row: item }: { row: IpoBoardItem }">
          <span class="text-text-secondary">{{
            item.issuePrice === null ? '--' : item.issuePrice.toFixed(2)
          }}</span>
        </template>
        <template #firstDayMaxRise="{ row: item }: { row: IpoBoardItem }">
          <span
            v-if="item.firstDayMaxRise !== null"
            class="font-medium"
            :class="
              TREND_TEXT_CLASS[getTrendByChangePercent(item.firstDayMaxRise)]
            "
          >
            +{{ item.firstDayMaxRise.toFixed(2) }}%
          </span>
          <span v-else class="text-text-tertiary">--</span>
        </template>
        <template #earn="{ row: item }: { row: IpoBoardItem }">
          <span
            v-if="item.earn !== null"
            :class="TREND_TEXT_CLASS[getTrendByChangePercent(item.earn)]"
          >
            {{ item.earn > 0 ? '+' : '' }}{{ item.earn.toFixed(0) }}
          </span>
          <span v-else class="text-text-tertiary">--</span>
        </template>
        <template #limitUpDays="{ row: item }: { row: IpoBoardItem }">
          <span>{{ numText(item.limitUpDays) }}</span>
        </template>
      </BaseTable>
    </div>
  </BaseCard>
</template>

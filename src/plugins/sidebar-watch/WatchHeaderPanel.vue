<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseModal from '../../components/ui/BaseModal.vue';
import BaseSkeleton from '../../components/ui/BaseSkeleton.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import AlertEditor from './AlertEditor.vue';
import { useDockPanelStore } from '../../stores/dock-panel';
import { useWatchlistStore } from '../../stores/watchlist';
import { NOTIFY_TONE, NOTIFY_TONE_CLASS } from '../../constants/notify.constants';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatPercent } from '../../utils/format-percent';
import { formatPrice } from '../../utils/format-price';
import { findQuoteBySymbol } from '../../utils/find-quote-by-symbol';
import { describeAlertRule, isAlertConfigured, createEmptyAlertRule } from './alerts';
import { filterCandidatesByWatchlist } from './candidates';
import {
  SIDEBAR_WATCH_EMPTY_HINT,
  SIDEBAR_WATCH_SKELETON_ROWS,
  WATCH_ALERT_BUTTON_ACTIVE_TITLE,
  WATCH_ALERT_BUTTON_TITLE,
  WATCH_ALERT_EDITOR_TITLE,
} from './constants';
import type { WatchMonitor } from './monitor';
import type { WatchAlertPatch, WatchCandidateRepo } from './service';
import type { WatchAlertRule } from './alerts';
import type { FullQuote } from '../../types/stock-quote.types';

/**
 * 自选盯盘面板（插件 dsh-sidebar-watch 的 inline 侧栏面板）
 *
 * 盯的是**候选池**：候选由用户在自选股表格「操作」列逐只点「盯盘」加入，
 * 落库在本插件自己的表里（`ctx.db`，见 service.ts），与自选股是「子集」关系 ——
 * 面板渲染的是「候选池 ∩ 当前自选股」（见 candidates.ts），
 * 因此删自选股只会让对应行消失，不会报错、也不会留下幽灵行。
 *
 * **本组件不取数**：报价与阈值判定都在插件的盯盘引擎里（见 monitor.ts），
 * 面板只读引擎的快照。这样面板被折叠 / 侧栏收起后，阈值提醒照常触发。
 */
const props = defineProps<{
  /** 盯盘候选仓储（插件在 apply 里经 props 注入自己的实现） */
  repo: WatchCandidateRepo;
  /** 盯盘引擎（报价快照 + 阈值判定，与面板挂载状态无关） */
  monitor: WatchMonitor;
}>();

const watchlistStore = useWatchlistStore();
const dockPanel = useDockPanelStore();

/** 正在编辑阈值的候选符号（null = 弹窗关闭；同时只编辑一个） */
const editingSymbol = ref<string | null>(null);

/** 阈值弹窗开关（挂在 editingSymbol 上：有目标即开，置空即关） */
const editorOpen = computed({
  get: () => editingSymbol.value !== null,
  set: (open: boolean) => {
    if (!open) editingSymbol.value = null;
  },
});

/** 面板内渲染的一行盯盘数据 */
interface WatchRow {
  /** 完整符号（sh600519） */
  symbol: string;
  /** 展示名（行情未返回时回退候选记录里的名称） */
  name: string;
  /** 现价文案 */
  price: string;
  /** 涨跌幅文案 */
  change: string;
  /** 涨跌幅文字色类名（红涨绿跌跟随全站涨跌主题） */
  trendClass: string;
  /** 阈值简述（未设时为空串） */
  alertText: string;
  /** 阈值文字 / 铃铛配色类名 */
  alertClass: string;
  /** 是否已设阈值 */
  hasAlert: boolean;
}

/** 仍在自选股里的候选（删掉的票不渲染，记录保留在库里） */
const candidates = computed(() =>
  filterCandidatesByWatchlist(props.repo.list(), watchlistStore.allSymbols),
);

/** 是否首载中（引擎只在第一次拉取时为 true，后续刷新不闪） */
const loading = computed(() => props.monitor.loading.value);

/** 面板内展示的行 */
const rows = computed<WatchRow[]>(() =>
  candidates.value.map((candidate) => {
    // 上游返回的报价 code 是裸代码（300339），本地符号是完整形态（sz300339），
    // 必须走兼容查找，否则永远取不到报价、整列停在占位符
    const quote: FullQuote | undefined = findQuoteBySymbol(
      props.monitor.quotes.value,
      candidate.symbol,
    );
    const changePercent = quote?.changePercent ?? null;
    const hasAlert = isAlertConfigured(candidate.alert);
    // 提醒语气跟随「触发方向」：设了跌到某价，这条标记本身就应该是跌色
    const alertClass = hasAlert
      ? NOTIFY_TONE_CLASS[candidate.alert.above ? NOTIFY_TONE.UP : NOTIFY_TONE.DOWN].label
      : '';
    return {
      symbol: candidate.symbol,
      name: quote?.name || candidate.name || candidate.symbol,
      price: formatPrice(quote?.price ?? null),
      change: formatPercent(changePercent),
      trendClass: TREND_TEXT_CLASS[getTrendByChangePercent(changePercent ?? 0)],
      alertText: describeAlertRule(candidate.alert),
      alertClass,
      hasAlert,
    };
  }),
);

/** 正在编辑的行（弹窗标题要用股票名；理论上恒存在，兜底 null） */
const editingRow = computed(
  () => rows.value.find((row) => row.symbol === editingSymbol.value) ?? null,
);

/**
 * 取某候选的阈值规则（记录已不在池里时回落到空规则）
 * @param symbol 完整符号
 * @returns 阈值规则
 */
const alertRuleOf = (symbol: string): WatchAlertRule =>
  props.repo.get(symbol)?.alert ?? createEmptyAlertRule();

/**
 * 单击一行：打开右侧个股详情面板（打开个股的唯一入口，不走路由）
 * @param symbol 完整符号
 */
const onOpenStock = (symbol: string): void => {
  dockPanel.openStock(symbol);
};

/**
 * 把一只票移出盯盘候选（自选股本身不动，阈值设置一并丢弃）
 * @param symbol 完整符号
 */
const onRemoveCandidate = (symbol: string): void => {
  if (editingSymbol.value === symbol) editingSymbol.value = null;
  props.repo.remove(symbol);
};

/**
 * 打开 / 关闭某行的阈值弹窗
 * @param symbol 完整符号
 */
const onToggleEditor = (symbol: string): void => {
  editingSymbol.value = editingSymbol.value === symbol ? null : symbol;
};

/**
 * 保存阈值（弹窗随之关闭）
 * @param patch 阈值内容
 */
const onSaveAlert = (patch: WatchAlertPatch): void => {
  const symbol = editingSymbol.value;
  if (!symbol) return;
  props.repo.setAlert(symbol, patch);
  editingSymbol.value = null;
};

/**
 * 清除阈值（弹窗随之关闭）
 */
const onClearAlert = (): void => {
  const symbol = editingSymbol.value;
  if (!symbol) return;
  props.repo.clearAlert(symbol);
  editingSymbol.value = null;
};
</script>

<template>
  <div>
    <BaseSkeleton v-if="loading && rows.length > 0">
      <div
        v-for="index in SIDEBAR_WATCH_SKELETON_ROWS"
        :key="index"
        class="h-6 rounded bg-flat-weak"
      />
    </BaseSkeleton>

    <!-- 空态：说清候选从哪来（面板本身没坏，只是还没挑票） -->
    <p v-else-if="rows.length === 0" class="px-2 py-1 text-xs leading-relaxed text-text-tertiary">
      {{ SIDEBAR_WATCH_EMPTY_HINT }}
    </p>

    <ul v-else class="space-y-0.5">
      <li v-for="row in rows" :key="row.symbol" class="rounded-md">
        <div class="group flex items-center gap-0.5 rounded-md hover:bg-flat-weak">
          <button
            type="button"
            class="pressable flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left active:scale-[0.98]"
            :title="`${row.name} ${row.price} ${row.change}`"
            @click="onOpenStock(row.symbol)"
          >
            <span class="min-w-0 flex-1 truncate text-xs text-text">{{ row.name }}</span>
            <span class="shrink-0 text-xs tabular-nums text-text-secondary">{{ row.price }}</span>
            <span class="w-[52px] shrink-0 text-right text-xs tabular-nums" :class="row.trendClass">
              {{ row.change }}
            </span>
          </button>

          <!-- 阈值提醒：已设阈值时铃铛按触发方向上色，一眼能看出这只票在等什么 -->
          <button
            type="button"
            class="pressable shrink-0 rounded p-0.5 transition-opacity hover:bg-flat-weak active:scale-90"
            :class="[
              row.hasAlert
                ? row.alertClass
                : 'text-text-tertiary opacity-0 hover:text-text group-hover:opacity-100',
              editingSymbol === row.symbol ? 'bg-primary-weak text-primary opacity-100' : '',
            ]"
            :aria-label="`${row.hasAlert ? WATCH_ALERT_BUTTON_ACTIVE_TITLE : WATCH_ALERT_BUTTON_TITLE} ${row.name}`"
            :title="row.hasAlert ? `阈值：${row.alertText}` : WATCH_ALERT_BUTTON_TITLE"
            @click.stop="onToggleEditor(row.symbol)"
          >
            <MenuIcon name="bell" :size="12" />
          </button>

          <button
            type="button"
            class="pressable mr-1 shrink-0 rounded p-0.5 text-text-tertiary opacity-0 transition-opacity hover:bg-flat-weak hover:text-text group-hover:opacity-100 active:scale-90"
            :aria-label="`移出盯盘 ${row.name}`"
            :title="`移出盯盘 ${row.name}`"
            @click.stop="onRemoveCandidate(row.symbol)"
          >
            <MenuIcon name="close" :size="12" />
          </button>
        </div>

        <!-- 已设阈值：常显不藏 hover，否则等于没设 -->
        <p v-if="row.alertText" class="px-2 pb-0.5 text-[10px]" :class="row.alertClass">
          {{ row.alertText }}
        </p>
      </li>
    </ul>

    <!-- 阈值弹窗：侧栏 224px 塞不下编辑器，点铃铛统一改为居中弹窗 -->
    <BaseModal
      v-model:open="editorOpen"
      :title="
        editingRow ? `${WATCH_ALERT_EDITOR_TITLE} · ${editingRow.name}` : WATCH_ALERT_EDITOR_TITLE
      "
      max-width-class="max-w-sm"
    >
      <AlertEditor
        v-if="editingSymbol"
        :rule="alertRuleOf(editingSymbol)"
        @save="onSaveAlert"
        @clear="onClearAlert"
      />
    </BaseModal>
  </div>
</template>

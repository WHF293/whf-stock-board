<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseCard from '../../components/ui/BaseCard.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import BaseTable from '../../components/ui/BaseTable.vue';
import BaseTabs from '../../components/ui/BaseTabs.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatPercent } from '../../utils/format-percent';
import { toFullSymbol } from '../../utils/to-full-symbol';
import { useStockOpen } from '../../composables/use-stock-open';
import { runDividendScan } from './scan';
import {
  createDefaultRules,
  createRuleInstance,
  evaluateRules,
  formatRuleText,
  RULE_TYPE_REGISTRY,
} from './rules';
import type { RuleTypeKey } from './rules';
import type { DividendRepo, DividendWatchItem } from './storage';
import type { RuleConfig, RuleGroup, RuleMatchResult } from './types';
import type { DividendScanProgress, DividendScreenRow } from './types';
import {
  DIVIDEND_COLUMN_LABEL,
  DIVIDEND_DETAIL_LABEL,
  DIVIDEND_DETAIL_TITLE,
  DIVIDEND_DISCLAIMER,
  DIVIDEND_EMPTY_TEXT,
  DIVIDEND_FILTER_CLEAR,
  DIVIDEND_FILTER_GROWING,
  DIVIDEND_FILTER_PUBLISHED,
  DIVIDEND_FILTER_PROJECTABLE,
  DIVIDEND_FILTER_SUMMARY,
  DIVIDEND_FORMULA_TEXT,
  DIVIDEND_HEADER_LABEL,
  DIVIDEND_MENU_ICON,
  DIVIDEND_PAGE_SUBTITLE,
  DIVIDEND_PAGE_TITLE,
  DIVIDEND_PLACEHOLDER,
  DIVIDEND_PAYOUT_OVERDUE_BADGE,
  DIVIDEND_PROJECT_STATUS,
  DIVIDEND_PROJECT_STATUS_BADGE_CLASS,
  DIVIDEND_PROJECT_STATUS_LABEL,
  DIVIDEND_SCAN_BUTTON,
  DIVIDEND_SCAN_FAILED,
  DIVIDEND_SCAN_RUNNING,
  DIVIDEND_TAB_OPTIONS,
  DIVIDEND_TAB_SCREEN,
  DIVIDEND_TAB_WATCHLIST,
  DIVIDEND_UNIVERSE_DEFAULT,
  DIVIDEND_UNIVERSE_LABEL,
  DIVIDEND_UNIVERSE_OPTIONS,
  GROWTH_BREAK_EVEN,
  PAYOUT_OVERDUE_THRESHOLD,
  RULE_ADD_BUTTON,
  RULE_ADD_PLACEHOLDER,
  RULE_EXCLUDE_BADGE,
  RULE_FAIL_BADGE,
  RULE_GROUP_TITLE_EXCLUDE,
  RULE_GROUP_TITLE_FILTER,
  RULE_NO_ACTIVE_HINT,
  RULE_PANEL_TITLE,
  RULE_PASS_BADGE,
  RULE_REMOVE_LABEL,
  RULE_RESET_DEFAULT,
  RULE_SAVE_FAILED,
  RULE_SHOW_FAILED,
  WATCH_ADD_LABEL,
  WATCH_ALL_MISSING_TEXT,
  WATCH_BULK_ADD,
  WATCH_CARD_TITLE,
  WATCH_COUNT_TEXT,
  WATCH_EMPTY_TEXT,
  WATCH_REMOVE_LABEL,
  WATCH_SAVE_FAILED,
  YI_UNIT,
  YUAN_PER_YI,
  YUAN_UNIT,
} from './constants';
import type { TableColumn } from '../../types/table.types';

/**
 * 股息筛选看板（插件 dsh-dividend-screen 的页面）
 *
 * 页面只读插件库快照渲染（零联网）；点「扫描排行」才发起上游请求
 * （排行 + 三期业绩 + 多期分红 + 负债率，样本池 200 时约 12 次串行请求）。
 * 筛选与规则评估都是纯客户端的（快照行数 ≤ 样本池上限），改规则不触发网络请求，
 * 规则配置持久化在插件库 config 表。
 */
const props = defineProps<{
  /** 股息筛选仓储（由插件注入，已建表并水合快照与规则配置） */
  repo: DividendRepo;
}>();

const { openSidebar, toContextList } = useStockOpen();

/** 是否正在扫描 */
const scanning = ref(false);
/** 扫描进度（null = 未进行中） */
const progress = ref<DividendScanProgress | null>(null);
/** 扫描告警文案（空串 = 无告警） */
const scanNotice = ref('');
/** 规则保存失败提示（空串 = 无提示） */
const ruleNotice = ref('');
/** 样本池档位（仅决定下一次扫描的范围） */
const universeLimit = ref<number>(DIVIDEND_UNIVERSE_DEFAULT);
/** 快捷筛选：仅已披露中报 */
const publishedOnly = ref(false);
/** 快捷筛选：仅净利同比增长 */
const growingOnly = ref(false);
/** 快捷筛选：仅可推算行 */
const projectableOnly = ref(false);
/** 未通过规则的行默认隐藏（剔除/未过不占列表），开启后连同原因一起显示 */
const showFailing = ref(false);
/** 当前展开的行（受控展开行） */
const expandedKeys = ref<string[]>([]);
/** 添加规则下拉的选中类型（空串 = 未选） */
const selectedRuleType = ref<RuleTypeKey | ''>('');
/** 页面顶部 tab：筛选 / 自选 */
const activeTab = ref<string>(DIVIDEND_TAB_SCREEN);
/** 自选保存失败提示（空串 = 无提示） */
const watchNotice = ref('');

/** 快照（响应式：扫描落库后自动刷新） */
const snapshot = computed(() => props.repo.snapshot());

/** 全部行（扫描时的默认序） */
const allRows = computed(() => snapshot.value.rows);

/** 扫描元信息 */
const meta = computed(() => snapshot.value.meta);

/** 当前规则配置（响应式：保存后自动更新） */
const ruleConfigs = computed(() => props.repo.ruleConfig());

/** 启用中的规则 */
const enabledRules = computed(() => ruleConfigs.value.filter((config) => config.enabled));

/** 规则按组分桶（面板两列各渲染一组，保持配置顺序） */
const ruleGroups = computed<Record<RuleGroup, RuleConfig[]>>(() => {
  const buckets: Record<RuleGroup, RuleConfig[]> = { filter: [], exclude: [] };
  for (const config of ruleConfigs.value) buckets[config.group].push(config);
  return buckets;
});

/** 是否有启用中的规则 */
const hasEnabledRules = computed(() => enabledRules.value.length > 0);

/**
 * 逐行评估规则（缓存：行与规则引用不变就不重算）
 * @returns 代码 → 匹配结果
 */
const ruleMatches = computed<Map<string, RuleMatchResult>>(() => {
  const map = new Map<string, RuleMatchResult>();
  for (const row of allRows.value) {
    map.set(row.code, evaluateRules(row, ruleConfigs.value));
  }
  return map;
});

/** 通过规则的行数 */
const rulePassCount = computed(
  () => allRows.value.filter((row) => ruleMatches.value.get(row.code)?.pass).length,
);

/** 被规则挡下的行数（剔除 + 未过） */
const ruleFailCount = computed(() => allRows.value.length - rulePassCount.value);

// ---------- 股息自选 ----------

/** 自选条目（响应式；加入 / 移出后自动更新） */
const watchedItems = computed<DividendWatchItem[]>(() => props.repo.watchlist());

/** 自选代码集合（行内星标态判定用） */
const watchSet = computed(() => new Set(watchedItems.value.map((item) => item.code)));

/** 快照行按代码索引（自选 join 快照用） */
const rowsByCode = computed(() => new Map(allRows.value.map((row) => [row.code, row])));

/** 自选 ∩ 最新快照：有指标数据的自选行 */
const watchRows = computed<DividendScreenRow[]>(() =>
  watchedItems.value
    .map((item) => rowsByCode.value.get(item.code))
    .filter((row): row is DividendScreenRow => row !== undefined),
);

/** 自选里已不在最新快照的条目（扫描覆盖范围变化导致，列表外单独提示） */
const watchMissing = computed(() =>
  watchedItems.value.filter((item) => !rowsByCode.value.has(item.code)),
);

/**
 * 切换某行的自选态（星标列；加入 / 移出都即时持久化）
 * @param row 展示行
 */
const onToggleWatch = (row: DividendScreenRow): void => {
  watchNotice.value = '';
  const action = watchSet.value.has(row.code)
    ? props.repo.removeWatch([row.code])
    : props.repo.addWatch([{ code: row.code, name: row.name }]);
  action.catch((error: unknown) => {
    watchNotice.value = `${WATCH_SAVE_FAILED}：${error instanceof Error ? error.message : String(error)}`;
  });
};

/** 把当前筛选列表（筛选 tab 的可见行）全部加入自选 */
const onAddAllToWatch = (): void => {
  watchNotice.value = '';
  props.repo
    .addWatch(rows.value.map((row) => ({ code: row.code, name: row.name })))
    .catch((error: unknown) => {
      watchNotice.value = `${WATCH_SAVE_FAILED}：${error instanceof Error ? error.message : String(error)}`;
    });
};

/** 当前筛选列表里尚未加入自选的行数（整表加入按钮的可用性判定） */
const bulkAddableCount = computed(
  () => rows.value.filter((row) => !watchSet.value.has(row.code)).length,
);

/**
 * 按代码移出自选（自选 tab 缺失条目的清理入口）
 * @param code 6 位裸代码
 */
const onRemoveWatchByCode = (code: string): void => {
  watchNotice.value = '';
  props.repo.removeWatch([code]).catch((error: unknown) => {
    watchNotice.value = `${WATCH_SAVE_FAILED}：${error instanceof Error ? error.message : String(error)}`;
  });
};

/** 是否有任一筛选生效 */
const filterActive = computed(
  () => publishedOnly.value || growingOnly.value || projectableOnly.value || showFailing.value,
);

/** 筛选后的行 */
const rows = computed<DividendScreenRow[]>(() =>
  allRows.value.filter((row) => {
    if (publishedOnly.value && row.netProfitH1 === null) return false;
    if (growingOnly.value && !(row.growthH1 !== null && row.growthH1 > GROWTH_BREAK_EVEN)) return false;
    if (projectableOnly.value && row.status !== DIVIDEND_PROJECT_STATUS.OK) return false;
    // 剔除/未过的行默认不进列表（用户口径：剔除 = 从列表消失）；「显示未通过」翻开才可见
    if (!showFailing.value && hasEnabledRules.value && !ruleMatches.value.get(row.code)?.pass) return false;
    return true;
  }),
);

/**
 * 推算较去年的变化值（百分点；任一侧缺失为 null）
 * @param row 展示行
 * @returns 变化值（百分点）
 */
const deltaValue = (row: DividendScreenRow): number | null =>
  row.projectedYield !== null && row.yieldLast !== null
    ? row.projectedYield - row.yieldLast
    : null;

/** 表格基础列（两个 tab 共用；星标列在行尾做加入/移出自选） */
const baseColumns: TableColumn<DividendScreenRow>[] = [
  { key: 'name', label: DIVIDEND_COLUMN_LABEL.name },
  { key: 'industry', label: DIVIDEND_COLUMN_LABEL.industry },
  { key: 'price', label: DIVIDEND_COLUMN_LABEL.price, align: 'right', sortable: true, sortValue: (row) => row.price },
  { key: 'ttmYield', label: DIVIDEND_COLUMN_LABEL.ttmYield, align: 'right', sortable: true, sortValue: (row) => row.ttmYield },
  { key: 'projectedYield', label: DIVIDEND_COLUMN_LABEL.projectedYield, align: 'right', sortable: true, sortValue: (row) => row.projectedYield },
  { key: 'projectedDelta', label: DIVIDEND_COLUMN_LABEL.projectedDelta, align: 'right', sortable: true, sortValue: (row) => deltaValue(row) },
  { key: 'yieldLast', label: DIVIDEND_COLUMN_LABEL.yieldLast, align: 'right', sortable: true, sortValue: (row) => row.yieldLast },
  { key: 'payoutLast', label: DIVIDEND_COLUMN_LABEL.payoutLast, align: 'right', sortable: true, sortValue: (row) => row.payoutLast },
  { key: 'dividendYears', label: DIVIDEND_COLUMN_LABEL.dividendYears, align: 'right', sortable: true, sortValue: (row) => row.dividendYears },
  { key: 'netProfitH1', label: DIVIDEND_COLUMN_LABEL.netProfitH1, align: 'right', sortable: true, sortValue: (row) => row.netProfitH1 },
  { key: 'netProfitYoY', label: DIVIDEND_COLUMN_LABEL.netProfitYoY, align: 'right', sortable: true, sortValue: (row) => row.netProfitYoY },
  { key: 'debtRatio', label: DIVIDEND_COLUMN_LABEL.debtRatio, align: 'right', sortable: true, sortValue: (row) => row.debtRatio },
  { key: 'peTtm', label: DIVIDEND_COLUMN_LABEL.peTtm, align: 'right', sortable: true, sortValue: (row) => row.peTtm },
];

/** 自选星标列 */
const watchColumn: TableColumn<DividendScreenRow> = { key: 'watch', label: DIVIDEND_COLUMN_LABEL.watch };

/** 当前 tab 的表格列（自选 tab 不展示规则列——自选本身已是筛选的结果） */
const tableColumns = computed<TableColumn<DividendScreenRow>[]>(() =>
  activeTab.value === DIVIDEND_TAB_WATCHLIST
    ? [...baseColumns, watchColumn]
    : [
        ...baseColumns,
        { key: 'ruleResult', label: DIVIDEND_COLUMN_LABEL.ruleResult },
        watchColumn,
      ],
);

/** 当前 tab 的表格行 */
const tableRows = computed<DividendScreenRow[]>(() =>
  activeTab.value === DIVIDEND_TAB_WATCHLIST ? watchRows.value : rows.value,
);

/** 当前 tab 的空态文案 */
const emptyText = computed(() => {
  if (activeTab.value === DIVIDEND_TAB_WATCHLIST) {
    return watchedItems.value.length === 0 ? WATCH_EMPTY_TEXT : WATCH_ALL_MISSING_TEXT;
  }
  return allRows.value.length === 0 ? DIVIDEND_EMPTY_TEXT : '';
});

/**
 * 行 key
 * @param row 展示行
 * @returns 行 key（裸代码，快照内唯一）
 */
const rowKey = (row: DividendScreenRow): string => row.code;

/**
 * 持久化规则配置（每次增删改后调用；失败给行内提示）
 * @param configs 新规则配置
 */
const persistRules = (configs: readonly RuleConfig[]): void => {
  ruleNotice.value = '';
  props.repo.saveRuleConfig(configs).catch((error: unknown) => {
    ruleNotice.value = `${RULE_SAVE_FAILED}：${error instanceof Error ? error.message : String(error)}`;
  });
};

/** 规则参数变更（输入框 change 即保存；参数已由 v-model 写回实例） */
const onRuleParamChange = (): void => {
  persistRules(ruleConfigs.value);
};

/**
 * 删除规则
 * @param config 规则实例
 */
const onRemoveRule = (config: RuleConfig): void => {
  persistRules(ruleConfigs.value.filter((item) => item.id !== config.id));
};

/**
 * 添加规则（按下拉选中的类型；参数取类型默认值）
 */
const onAddRule = (): void => {
  if (selectedRuleType.value === '') return;
  const def = RULE_TYPE_REGISTRY[selectedRuleType.value];
  if (!def) return;
  persistRules([...ruleConfigs.value, createRuleInstance(def.key)]);
  selectedRuleType.value = '';
};

/** 恢复默认预置规则 */
const onResetRules = (): void => {
  persistRules(createDefaultRules());
};

/**
 * 去年分红率是否超额（>100% 的特别分红年份，推算照算但明示异常）
 * @param row 展示行
 * @returns 是否超额
 */
const isPayoutOverdue = (row: DividendScreenRow): boolean =>
  row.payoutLast !== null && row.payoutLast > PAYOUT_OVERDUE_THRESHOLD;

/**
 * 涨跌文案样式
 * @param value 数值
 * @returns 文本色类名
 */
const changeClass = (value: number): string => TREND_TEXT_CLASS[getTrendByChangePercent(value)];

/**
 * 格式化价格（元）
 * @param value 价格
 * @returns 文案
 */
const formatPrice = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : value.toFixed(2);

/**
 * 格式化股息率（%，两位）
 * @param value 股息率
 * @returns 文案
 */
const formatYield = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${value.toFixed(2)}%`;

/**
 * 格式化分红率（0-1 → %，一位）
 * @param value 分红率
 * @returns 文案
 */
const formatPayout = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${(value * 100).toFixed(1)}%`;

/**
 * 格式化负债率（%，一位）
 * @param value 负债率
 * @returns 文案
 */
const formatDebtRatio = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${value.toFixed(1)}%`;

/**
 * 格式化覆盖倍数（×，两位）
 * @param value 倍数
 * @returns 文案
 */
const formatCover = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${value.toFixed(2)}×`;

/**
 * 格式化每股金额（元，两位）
 * @param value 金额
 * @returns 文案
 */
const formatPerShare = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${value.toFixed(2)}${YUAN_UNIT}`;

/**
 * 格式化金额（元 → 亿元）
 * @param value 金额（元）
 * @returns 文案
 */
const formatYuanToYi = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${(value / YUAN_PER_YI).toFixed(2)}${YI_UNIT}`;

/**
 * 格式化每股分红（元，最多 3 位，兼容茅台级的 28 元派息）
 * @param value 每股分红
 * @returns 文案
 */
const formatDps = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${value.toFixed(3)}${YUAN_UNIT}`;

/**
 * 格式化中报净利比（倍数）
 * @param value 净利比
 * @returns 文案
 */
const formatGrowth = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${value.toFixed(2)}×`;

/**
 * 格式化连续分红年数
 * @param value 年数（null = 未采集）
 * @returns 文案
 */
const formatDividendYears = (value: number | null): string =>
  value === null ? DIVIDEND_PLACEHOLDER : `${value}年`;

/**
 * 推算较去年的变化文案
 * @param row 展示行
 * @returns 文案
 */
const formatDelta = (row: DividendScreenRow): string => {
  const delta = deltaValue(row);
  if (delta === null) return DIVIDEND_PLACEHOLDER;
  return `${delta > 0 ? '+' : ''}${delta.toFixed(2)}pp`;
};

/**
 * 规则列的完整原因文案（title 提示用）
 * @param row 展示行
 * @returns 原因串（通过为空串）
 */
const ruleReasonText = (row: DividendScreenRow): string => {
  const match = ruleMatches.value.get(row.code);
  if (!match) return '';
  return [...match.excludeReasons, ...match.failedFilters].join('；');
};

/**
 * 规则列的短徽标文案（剔除优先展示）
 * @param row 展示行
 * @returns 徽标文案
 */
const ruleBadgeText = (row: DividendScreenRow): string => {
  const match = ruleMatches.value.get(row.code);
  if (!match) return RULE_NO_ACTIVE_HINT;
  if (match.pass) return RULE_PASS_BADGE;
  const first = match.excludeReasons[0] ?? match.failedFilters[0] ?? '';
  const prefix = match.excludeReasons.length > 0 ? RULE_EXCLUDE_BADGE : RULE_FAIL_BADGE;
  return first === '' ? prefix : `${prefix}·${first}`;
};

/**
 * 规则列徽标样式类
 * @param row 展示行
 * @returns 类名
 */
const ruleBadgeClass = (row: DividendScreenRow): string => {
  const match = ruleMatches.value.get(row.code);
  if (!match || match.pass) return 'bg-primary-weak text-primary';
  return match.excludeReasons.length > 0 ? 'bg-up-weak text-up' : 'bg-flat-weak text-text-tertiary';
};

/**
 * 扫描时间文案
 * @param value 毫秒时间戳
 * @returns 本地时间文案
 */
const formatScannedAt = (value: number): string => new Date(value).toLocaleString('zh-CN');

/**
 * 切换某行的展开态
 * @param row 展示行
 */
const onToggleExpand = (row: DividendScreenRow): void => {
  expandedKeys.value = expandedKeys.value.includes(row.code)
    ? expandedKeys.value.filter((item) => item !== row.code)
    : [row.code];
};

/**
 * 双击行：打开个股详情侧栏（携带本页快照为上下文，侧栏内可逐只切换）
 * @param row 展示行
 */
const onRowDblclick = (row: DividendScreenRow): void => {
  openSidebar(toFullSymbol(row.code), toContextList(rows.value, (item) => item.code));
};

/** 清除全部快捷筛选 */
const onClearFilters = (): void => {
  publishedOnly.value = false;
  growingOnly.value = false;
  projectableOnly.value = false;
  showFailing.value = false;
};

/**
 * 触发一次扫描（点击触发，不轮询；结果落库）
 */
const onScan = async (): Promise<void> => {
  if (scanning.value) return;
  scanning.value = true;
  scanNotice.value = '';
  progress.value = null;
  try {
    await runDividendScan(props.repo, universeLimit.value, (next) => {
      progress.value = next;
    });
  } catch (error) {
    scanNotice.value = `${DIVIDEND_SCAN_FAILED}：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    scanning.value = false;
    progress.value = null;
  }
};
</script>

<template>
  <div class="space-y-4">
    <!-- 页面级视图切换：与龙虎榜 / 行情情绪页一致的 underline 风格，置于卡片之上 -->
    <div class="flex shrink-0 items-center gap-1">
      <BaseTabs v-model="activeTab" :options="DIVIDEND_TAB_OPTIONS" variant="underline" />
    </div>

    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h1 class="flex items-center gap-1.5 text-base font-semibold text-text">
            <MenuIcon :name="DIVIDEND_MENU_ICON" :size="16" />
            {{ DIVIDEND_PAGE_TITLE }}
          </h1>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">{{ DIVIDEND_PAGE_SUBTITLE }}</p>
        </div>
        <template v-if="activeTab === DIVIDEND_TAB_SCREEN">
          <div class="flex shrink-0 items-center gap-2">
            <label class="flex items-center gap-1.5 text-xs text-text-secondary">
              {{ DIVIDEND_UNIVERSE_LABEL }}
              <select
                v-model.number="universeLimit"
                class="rounded-lg bg-flat-weak px-2 py-1 text-xs text-text outline-none"
                :disabled="scanning"
              >
                <option v-for="option in DIVIDEND_UNIVERSE_OPTIONS" :key="option" :value="option">
                  {{ option }}
                </option>
              </select>
            </label>
            <span v-if="progress" class="text-xs tabular-nums text-text-tertiary">
              {{ DIVIDEND_SCAN_RUNNING }} {{ progress.done }}/{{ progress.total }}
            </span>
            <BaseButton :disabled="scanning" @click="onScan">
              <MenuIcon :name="DIVIDEND_MENU_ICON" :size="14" />
              {{ DIVIDEND_SCAN_BUTTON }}
            </BaseButton>
          </div>
        </template>
      </div>

      <!-- 扫描与口径信息只属于「股息筛选」tab；自选 tab 只读本地库 -->
      <template v-if="activeTab === DIVIDEND_TAB_SCREEN">
        <!-- 口径信息：报告期、覆盖与披露进度一并如实给出 -->
        <div
          v-if="meta"
          class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary"
        >
          <span>{{ DIVIDEND_HEADER_LABEL.scannedAt }}：{{ formatScannedAt(meta.scannedAt) }}</span>
          <span>{{ DIVIDEND_HEADER_LABEL.universe }}：{{ meta.universeLimit }}</span>
          <span v-if="meta.universeTotal !== null">
            {{ DIVIDEND_HEADER_LABEL.marketTotal }}：{{ meta.universeTotal }}
          </span>
          <span>
            {{ DIVIDEND_HEADER_LABEL.published }}：{{ meta.publishedCount }}/{{ meta.rowCount }}
          </span>
          <span>
            {{ DIVIDEND_HEADER_LABEL.projectable }}：{{ meta.projectableCount }}/{{ meta.rowCount }}
          </span>
          <span>{{ DIVIDEND_HEADER_LABEL.periodH1 }}：{{ meta.periods.h1 }}</span>
          <span>{{ DIVIDEND_HEADER_LABEL.periodFyLast }}：{{ meta.periods.fyLast }}</span>
        </div>

        <p
          v-if="scanNotice"
          class="mt-2 rounded-lg bg-primary-weak px-2 py-1.5 text-xs leading-relaxed text-primary"
        >
          {{ scanNotice }}
        </p>

        <!-- 快捷筛选开关（纯客户端，快照行内过滤） -->
        <div v-if="allRows.length > 0" class="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            class="pressable rounded-md px-1.5 py-0.5 text-[11px] active:scale-95"
            :class="publishedOnly ? 'bg-primary-weak text-primary' : 'bg-flat-weak text-text-secondary'"
            :aria-pressed="publishedOnly"
            @click="publishedOnly = !publishedOnly"
          >
            {{ DIVIDEND_FILTER_PUBLISHED }}
          </button>
          <button
            type="button"
            class="pressable rounded-md px-1.5 py-0.5 text-[11px] active:scale-95"
            :class="growingOnly ? 'bg-primary-weak text-primary' : 'bg-flat-weak text-text-secondary'"
            :aria-pressed="growingOnly"
            @click="growingOnly = !growingOnly"
          >
            {{ DIVIDEND_FILTER_GROWING }}
          </button>
          <button
            type="button"
            class="pressable rounded-md px-1.5 py-0.5 text-[11px] active:scale-95"
            :class="projectableOnly ? 'bg-primary-weak text-primary' : 'bg-flat-weak text-text-secondary'"
            :aria-pressed="projectableOnly"
            @click="projectableOnly = !projectableOnly"
          >
            {{ DIVIDEND_FILTER_PROJECTABLE }}
          </button>
          <button
            type="button"
            class="pressable rounded-md px-1.5 py-0.5 text-[11px] active:scale-95"
            :class="showFailing ? 'bg-primary-weak text-primary' : 'bg-flat-weak text-text-secondary'"
            :aria-pressed="showFailing"
            @click="showFailing = !showFailing"
          >
            {{ RULE_SHOW_FAILED }}
            <span v-if="ruleFailCount > 0" class="tabular-nums">（{{ ruleFailCount }}）</span>
          </button>
          <span v-if="filterActive" class="ml-1 text-[11px] tabular-nums text-text-tertiary">
            {{ DIVIDEND_FILTER_SUMMARY(rows.length, allRows.length) }}
            <button
              type="button"
              class="pressable ml-1 rounded px-1 py-0.5 text-primary active:scale-95"
              @click="onClearFilters"
            >
              {{ DIVIDEND_FILTER_CLEAR }}
            </button>
          </span>
        </div>
      </template>
    </BaseCard>

    <!-- 可配置规则面板：增删改全部即时持久化，评估纯客户端（仅筛选 tab） -->
    <BaseCard v-if="activeTab === DIVIDEND_TAB_SCREEN" :title="RULE_PANEL_TITLE">
      <template #extra>
        <span class="text-xs tabular-nums text-text-tertiary">
          通过 {{ rulePassCount }}/{{ allRows.length }}
        </span>
      </template>

      <div class="grid gap-4 md:grid-cols-2">
        <div v-for="group in (['filter', 'exclude'] as RuleGroup[])" :key="group">
          <p class="mb-2 flex items-center gap-1.5 text-xs font-medium text-text-secondary">
            <span
              class="inline-block h-1.5 w-1.5 rounded-full"
              :class="group === 'filter' ? 'bg-primary' : 'bg-up'"
            />
            {{ group === 'filter' ? RULE_GROUP_TITLE_FILTER : RULE_GROUP_TITLE_EXCLUDE }}
            <span class="tabular-nums text-text-tertiary">{{ ruleGroups[group].length }}</span>
          </p>
          <div class="space-y-1.5">
            <div
              v-for="config in ruleGroups[group]"
              :key="config.id"
              class="group flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-flat-weak px-2.5 py-1.5 transition-colors"
            >
              <span
                class="text-xs font-medium text-text"
                :title="RULE_TYPE_REGISTRY[config.type as RuleTypeKey]?.description"
              >
                {{ formatRuleText(config) }}
              </span>
              <template v-for="field in (RULE_TYPE_REGISTRY[config.type as RuleTypeKey]?.params ?? [])" :key="field.key">
                <label v-if="field.kind === 'number'" class="flex items-center gap-1 text-[11px] text-text-tertiary">
                  {{ field.label }}
                  <input
                    type="number"
                    class="w-16 rounded-md bg-surface px-1.5 py-0.5 text-xs tabular-nums text-text outline-none focus:ring-1 focus:ring-primary"
                    :step="field.unit === '×' ? '0.1' : '1'"
                    v-model.number="config.params[field.key]"
                    @change="onRuleParamChange()"
                  />
                  {{ field.unit }}
                </label>
                <label v-else class="flex items-center gap-1 text-[11px] text-text-tertiary">
                  {{ field.label }}
                  <input
                    type="text"
                    class="w-64 rounded-md bg-surface px-1.5 py-0.5 text-xs text-text outline-none focus:ring-1 focus:ring-primary"
                    v-model="config.params[field.key]"
                    @change="onRuleParamChange()"
                  />
                </label>
              </template>
              <button
                type="button"
                class="pressable ml-auto rounded px-1 text-xs text-text-tertiary opacity-0 transition-opacity hover:text-up group-hover:opacity-100 active:scale-95"
                :aria-label="RULE_REMOVE_LABEL"
                @click="onRemoveRule(config)"
              >
                ✕
              </button>
            </div>
            <p v-if="ruleGroups[group].length === 0" class="px-2.5 py-1 text-[11px] text-text-tertiary">
              （本组暂无规则）
            </p>
          </div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-2">
        <select
          v-model="selectedRuleType"
          class="rounded-lg bg-flat-weak px-2 py-1.5 text-xs text-text outline-none"
          :aria-label="RULE_ADD_PLACEHOLDER"
        >
          <option value="">{{ RULE_ADD_PLACEHOLDER }}</option>
          <option v-for="(def, key) in RULE_TYPE_REGISTRY" :key="key" :value="key">
            {{ def.label }}（{{ def.defaultGroup === 'filter' ? '筛选' : '剔除' }}）
          </option>
        </select>
        <BaseButton :disabled="selectedRuleType === ''" @click="onAddRule">＋ {{ RULE_ADD_BUTTON }}</BaseButton>
        <BaseButton variant="ghost" @click="onResetRules">{{ RULE_RESET_DEFAULT }}</BaseButton>
        <span class="text-[11px] text-text-tertiary">未通过的行默认不在列表，用上方「显示未通过」查看原因</span>
      </div>

      <p
        v-if="ruleNotice"
        class="mt-2 rounded-lg bg-down-weak px-2 py-1.5 text-xs leading-relaxed text-down"
      >
        {{ ruleNotice }}
      </p>
    </BaseCard>

    <BaseCard :title="activeTab === DIVIDEND_TAB_WATCHLIST ? WATCH_CARD_TITLE : DIVIDEND_DETAIL_TITLE">
      <template #extra>
        <span
          v-if="activeTab === DIVIDEND_TAB_WATCHLIST"
          class="text-xs tabular-nums text-text-tertiary"
        >
          {{ WATCH_COUNT_TEXT(watchRows.length) }}
        </span>
        <template v-else>
          <button
            v-if="bulkAddableCount > 0"
            type="button"
            class="pressable rounded-md bg-flat-weak px-1.5 py-0.5 text-[11px] text-text-secondary hover:text-text active:scale-95"
            @click="onAddAllToWatch"
          >
            {{ WATCH_BULK_ADD }}（{{ bulkAddableCount }}）
          </button>
          <span class="text-xs text-text-tertiary">点行看推算明细，双击打开个股详情</span>
        </template>
      </template>

      <!-- 自选中已不在最新扫描快照的条目：名单提示 + 逐个清理 -->
      <div
        v-if="activeTab === DIVIDEND_TAB_WATCHLIST && watchMissing.length > 0"
        class="mb-3 flex flex-wrap items-center gap-1.5"
      >
        <span class="text-xs text-text-tertiary">以下 {{ watchMissing.length }} 只不在最新扫描快照里：</span>
        <span
          v-for="item in watchMissing"
          :key="item.code"
          class="flex items-center gap-1 rounded-full bg-flat-weak px-2 py-0.5 text-[11px] text-text-secondary"
        >
          {{ item.name || item.code }}
          <button
            type="button"
            class="pressable text-text-tertiary hover:text-up active:scale-90"
            :aria-label="WATCH_REMOVE_LABEL"
            @click="onRemoveWatchByCode(item.code)"
          >
            ✕
          </button>
        </span>
      </div>

      <!-- 空态分三种原因：还没扫描 / 被规则全挡了 / 快捷筛选筛没了 -->
      <div v-if="tableRows.length === 0">
        <BaseEmpty :text="emptyText" />
        <p
          v-if="activeTab === DIVIDEND_TAB_SCREEN && allRows.length > 0 && ruleFailCount > 0 && !showFailing"
          class="pb-4 text-center"
        >
          <button
            type="button"
            class="pressable rounded-md bg-primary-weak px-2 py-1 text-xs text-primary active:scale-95"
            @click="showFailing = true"
          >
            {{ RULE_SHOW_FAILED }}（{{ ruleFailCount }}）
          </button>
        </p>
        <p
          v-else-if="activeTab === DIVIDEND_TAB_SCREEN && allRows.length > 0 && filterActive"
          class="pb-4 text-center"
        >
          <button
            type="button"
            class="pressable rounded-md bg-primary-weak px-2 py-1 text-xs text-primary active:scale-95"
            @click="onClearFilters"
          >
            {{ DIVIDEND_FILTER_CLEAR }}
          </button>
        </p>
      </div>

      <BaseTable
        v-else
        :columns="tableColumns"
        :rows="tableRows"
        :row-key="rowKey"
        :row-clickable="true"
        :enable-dblclick-nav="true"
        :expandable="true"
        :expanded-keys="expandedKeys"
        min-width="1320px"
        @row-click="onToggleExpand"
        @row-dblclick="onRowDblclick"
        @toggle-expand="onToggleExpand"
      >
        <template #name="{ row }">
          <span class="flex items-center gap-1.5">
            <span class="text-text">{{ row.name }}</span>
            <span class="tabular-nums text-[11px] text-text-tertiary">{{ row.code }}</span>
            <span
              v-if="row.status !== DIVIDEND_PROJECT_STATUS.OK"
              class="rounded px-1 py-0.5 text-[10px]"
              :class="DIVIDEND_PROJECT_STATUS_BADGE_CLASS[row.status]"
            >
              {{ DIVIDEND_PROJECT_STATUS_LABEL[row.status] }}
            </span>
            <span
              v-if="isPayoutOverdue(row)"
              class="rounded bg-primary-weak px-1 py-0.5 text-[10px] text-primary"
            >
              {{ DIVIDEND_PAYOUT_OVERDUE_BADGE }}
            </span>
          </span>
        </template>

        <template #industry="{ row }">
          <span class="text-text-secondary">{{ row.industry || DIVIDEND_PLACEHOLDER }}</span>
        </template>

        <template #price="{ row }">
          <span class="tabular-nums text-text">{{ formatPrice(row.price) }}</span>
        </template>

        <template #ttmYield="{ row }">{{ formatYield(row.ttmYield) }}</template>
        <template #yieldLast="{ row }">{{ formatYield(row.yieldLast) }}</template>
        <template #payoutLast="{ row }">{{ formatPayout(row.payoutLast) }}</template>
        <template #dividendYears="{ row }">{{ formatDividendYears(row.dividendYears) }}</template>
        <template #netProfitH1="{ row }">{{ formatYuanToYi(row.netProfitH1) }}</template>

        <template #netProfitYoY="{ row }">
          <span v-if="row.netProfitYoY !== null" :class="changeClass(row.netProfitYoY)">
            {{ formatPercent(row.netProfitYoY) }}
          </span>
          <span v-else>{{ DIVIDEND_PLACEHOLDER }}</span>
        </template>

        <template #projectedYield="{ row }">
          <span v-if="row.projectedYield !== null" class="font-medium tabular-nums text-up">
            {{ formatYield(row.projectedYield) }}
          </span>
          <span v-else class="text-text-tertiary">{{ DIVIDEND_PLACEHOLDER }}</span>
        </template>

        <template #projectedDelta="{ row }">
          <span v-if="deltaValue(row) !== null" :class="changeClass(deltaValue(row) ?? 0)">
            {{ formatDelta(row) }}
          </span>
          <span v-else class="text-text-tertiary">{{ DIVIDEND_PLACEHOLDER }}</span>
        </template>

        <template #debtRatio="{ row }">{{ formatDebtRatio(row.debtRatio) }}</template>
        <template #peTtm="{ row }">{{ row.peTtm === null ? DIVIDEND_PLACEHOLDER : row.peTtm.toFixed(1) }}</template>

        <template #ruleResult="{ row }">
          <span
            class="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] leading-none"
            :class="ruleBadgeClass(row)"
            :title="ruleReasonText(row)"
          >
            {{ hasEnabledRules ? ruleBadgeText(row) : RULE_NO_ACTIVE_HINT }}
          </span>
        </template>

        <template #watch="{ row }">
          <button
            type="button"
            class="pressable text-base leading-none active:scale-90"
            :class="watchSet.has(row.code) ? 'text-primary' : 'text-text-tertiary hover:text-primary'"
            :title="watchSet.has(row.code) ? WATCH_REMOVE_LABEL : WATCH_ADD_LABEL"
            :aria-label="watchSet.has(row.code) ? WATCH_REMOVE_LABEL : WATCH_ADD_LABEL"
            @click.stop="onToggleWatch(row)"
            @dblclick.stop
          >
            {{ watchSet.has(row.code) ? '★' : '☆' }}
          </button>
        </template>

        <template #expanded="{ row }">
          <div class="space-y-3">
            <p class="text-xs leading-relaxed text-text-secondary">{{ DIVIDEND_FORMULA_TEXT }}</p>

            <div v-if="!ruleMatches.get(row.code)?.pass" class="rounded-lg bg-flat-weak px-2 py-1.5">
              <p class="text-xs font-medium text-text-secondary">
                {{ DIVIDEND_DETAIL_LABEL.ruleMatch }}
              </p>
              <p
                v-for="reason in ruleMatches.get(row.code)?.excludeReasons"
                :key="`e-${reason}`"
                class="mt-1 text-xs text-down"
              >
                剔除：{{ reason }}
              </p>
              <p
                v-for="reason in ruleMatches.get(row.code)?.failedFilters"
                :key="`f-${reason}`"
                class="mt-1 text-xs text-text-tertiary"
              >
                未过：{{ reason }}
              </p>
            </div>

            <dl class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3 md:grid-cols-4">
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.status }}</dt>
                <dd>
                  <span
                    class="rounded px-1 py-0.5 text-[10px]"
                    :class="DIVIDEND_PROJECT_STATUS_BADGE_CLASS[row.status]"
                  >
                    {{ DIVIDEND_PROJECT_STATUS_LABEL[row.status] }}
                  </span>
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.dpsLast }}</dt>
                <dd class="tabular-nums text-text">{{ formatDps(row.dpsLast) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.dividendTotalLast }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.dividendTotalLast) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.netProfitFyLast }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.netProfitFyLast) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.payoutLast }}</dt>
                <dd class="tabular-nums text-text">{{ formatPayout(row.payoutLast) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.dividendYears }}</dt>
                <dd class="tabular-nums text-text">{{ formatDividendYears(row.dividendYears) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.ocfPerShareLast }}</dt>
                <dd class="tabular-nums text-text">{{ formatPerShare(row.ocfPerShareLast) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.cashCoverLast }}</dt>
                <dd class="tabular-nums text-text">{{ formatCover(row.cashCoverLast) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.debtRatio }}</dt>
                <dd class="tabular-nums text-text">{{ formatDebtRatio(row.debtRatio) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.netProfitH1 }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.netProfitH1) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.netProfitH1Last }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.netProfitH1Last) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.growthH1 }}</dt>
                <dd class="tabular-nums text-text">{{ formatGrowth(row.growthH1) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.projectedNetProfit }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.projectedNetProfit) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.projectedDps }}</dt>
                <dd class="tabular-nums text-text">{{ formatDps(row.projectedDps) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.projectedYield }}</dt>
                <dd class="tabular-nums font-medium text-up">{{ formatYield(row.projectedYield) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.interimDps }}</dt>
                <dd class="tabular-nums text-text">{{ formatDps(row.interimDps) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.ttmYield }}</dt>
                <dd class="tabular-nums text-text">{{ formatYield(row.ttmYield) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.marketCap }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.marketCap) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.peTtm }}</dt>
                <dd class="tabular-nums text-text">
                  {{ row.peTtm === null ? DIVIDEND_PLACEHOLDER : row.peTtm.toFixed(1) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ DIVIDEND_DETAIL_LABEL.pb }}</dt>
                <dd class="tabular-nums text-text">
                  {{ row.pb === null ? DIVIDEND_PLACEHOLDER : row.pb.toFixed(2) }}
                </dd>
              </div>
            </dl>
          </div>
        </template>
      </BaseTable>
    </BaseCard>

    <BaseCard>
      <p class="text-xs leading-relaxed text-text-tertiary">{{ DIVIDEND_DISCLAIMER }}</p>
    </BaseCard>
  </div>
</template>

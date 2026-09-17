<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseCard from '../../components/ui/BaseCard.vue';
import BaseButton from '../../components/ui/BaseButton.vue';
import BaseEmpty from '../../components/ui/BaseEmpty.vue';
import BaseTable from '../../components/ui/BaseTable.vue';
import MenuIcon from '../../components/ui/MenuIcon.vue';
import { getTrendByChangePercent } from '../../constants/trend.constants';
import { TREND_TEXT_CLASS } from '../../constants/stock-colors.constants';
import { formatPercent } from '../../utils/format-percent';
import { judgeAll } from './judge';
import { runMainlineScan, type MainlineScanProgress } from './scan';
import {
  MAINLINE_CANDIDATE_BADGE,
  MAINLINE_COLUMN_LABEL,
  MAINLINE_CONFIDENCE_LABEL,
  MAINLINE_DETAIL_LABEL,
  MAINLINE_DETAIL_TITLE,
  MAINLINE_DETAIL_UNIT,
  MAINLINE_DISCLAIMER,
  MAINLINE_EMPTY_TEXT,
  MAINLINE_MENU_ICON,
  MAINLINE_METRIC_PLACEHOLDER,
  MAINLINE_MISSING_INPUTS,
  MAINLINE_MISSING_TITLE,
  MAINLINE_NO_SAMPLE_TEXT,
  MAINLINE_PAGE_SUBTITLE,
  MAINLINE_PAGE_TITLE,
  MAINLINE_PHASE_BADGE_CLASS,
  MAINLINE_PHASE_LABEL,
  MAINLINE_ROW_KEY_PREFIX,
  MAINLINE_SCAN_BUTTON,
  MAINLINE_SCAN_FAILED,
  MAINLINE_SCAN_PROGRESS_SUFFIX,
  MAINLINE_SCAN_RUNNING,
  MAINLINE_WARNING_TITLE,
  YI_UNIT,
  YUAN_PER_YI,
} from './constants';
import type { MainlineRepo } from './storage';
import type { MainlineVerdict } from './types';
import type { TableColumn } from '../../types/table.types';

/**
 * 股票主线看板（插件 dsh-mainline 的页面）
 *
 * 界面按技能要求**分成两块**（不让用户盲信自动判定）：
 * ① 原始指标面板：成交占比分位 / 量能倍数 / 价格分位 / 成交额等；
 * ② 自动阶段标签 + 风险提示 + 本期未接入的输入清单。
 *
 * 取数是**点击触发**的重接口（约 90 次请求，并发 3 + 同上游 500ms 间隔），
 * 结果落插件表；再次进入页面直接读库重算标签，不联网。
 */
const props = defineProps<{
  /** 主线快照仓储（由插件注入，已建表并水合） */
  repo: MainlineRepo;
}>();

/** 是否正在扫描 */
const scanning = ref(false);
/** 扫描进度（null = 未进行中） */
const progress = ref<MainlineScanProgress | null>(null);
/** 取数告警文案（空串 = 无告警） */
const scanNotice = ref('');
/** 是否只看主线候选 */
const candidateOnly = ref(false);
/** 当前展开的板块代码（受控展开行） */
const expandedKeys = ref<string[]>([]);

/** 全部板块判定结论（读快照重算，无网络请求） */
const verdicts = computed<MainlineVerdict[]>(() => {
  const snapshot = props.repo.snapshot();
  return judgeAll(snapshot.boards, snapshot.market);
});

/** 表格行（按候选过滤后） */
const rows = computed<MainlineVerdict[]>(() =>
  candidateOnly.value ? verdicts.value.filter((verdict) => verdict.candidate) : verdicts.value,
);

/** 扫描元信息 */
const meta = computed(() => props.repo.snapshot().meta);

/** 各阶段数量统计（看板顶部速览） */
const phaseSummary = computed(() =>
  (Object.keys(MAINLINE_PHASE_LABEL) as MainlineVerdict['phase'][]).map((phase) => ({
    phase,
    label: MAINLINE_PHASE_LABEL[phase],
    badgeClass: MAINLINE_PHASE_BADGE_CLASS[phase],
    count: verdicts.value.filter((verdict) => verdict.phase === phase).length,
  })),
);

/** 表格列配置 */
const columns: TableColumn<MainlineVerdict>[] = [
  { key: 'name', label: MAINLINE_COLUMN_LABEL.name },
  { key: 'phase', label: MAINLINE_COLUMN_LABEL.phase },
  { key: 'change', label: MAINLINE_COLUMN_LABEL.change, align: 'right', sortable: true, sortValue: (row) => row.metrics.latestChange },
  { key: 'change5', label: MAINLINE_COLUMN_LABEL.change5, align: 'right', sortable: true, sortValue: (row) => row.metrics.change5 },
  { key: 'share', label: MAINLINE_COLUMN_LABEL.share, align: 'right', sortable: true, sortValue: (row) => row.metrics.turnoverShare },
  { key: 'sharePercentile', label: MAINLINE_COLUMN_LABEL.sharePercentile, align: 'right', sortable: true, sortValue: (row) => row.metrics.sharePercentile },
  { key: 'amountRatio', label: MAINLINE_COLUMN_LABEL.amountRatio, align: 'right', sortable: true, sortValue: (row) => row.metrics.amountRatio },
  { key: 'pricePercentile', label: MAINLINE_COLUMN_LABEL.pricePercentile, align: 'right', sortable: true, sortValue: (row) => row.metrics.pricePercentile },
];

/**
 * 行 key（展开行与排序都用它）
 * @param row 判定结论
 * @returns 行 key
 */
const rowKey = (row: MainlineVerdict): string => `${MAINLINE_ROW_KEY_PREFIX}${row.code}`;

/**
 * 涨跌幅文案样式（跟全站涨跌色一致）
 * @param value 涨跌幅（%）
 * @returns 文本色类名
 */
const changeClass = (value: number): string => TREND_TEXT_CLASS[getTrendByChangePercent(value)];

/**
 * 格式化分位（分位不可得时给「无样本」而不是 0）
 * @param value 分位（0-100）
 * @returns 文案
 */
const formatPercentile = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return MAINLINE_NO_SAMPLE_TEXT;
  return `${value.toFixed(1)}%`;
};

/**
 * 格式化成交占比（%）
 * @param value 成交占比
 * @returns 文案
 */
const formatShare = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? MAINLINE_METRIC_PLACEHOLDER : `${value.toFixed(2)}%`;

/**
 * 格式化倍数
 * @param value 倍数
 * @returns 文案
 */
const formatRatio = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? MAINLINE_METRIC_PLACEHOLDER
    : `${value.toFixed(2)}${MAINLINE_DETAIL_UNIT.times}`;

/**
 * 格式化成交额（元 → 亿元）
 * @param value 成交额（元）
 * @returns 文案
 */
const formatYuanToYi = (value: number | null): string =>
  value === null || !Number.isFinite(value)
    ? MAINLINE_METRIC_PLACEHOLDER
    : `${(value / YUAN_PER_YI).toFixed(0)}${YI_UNIT}`;

/**
 * 扫描时间文案
 * @param value 毫秒时间戳
 * @returns 本地时间文案
 */
const formatScannedAt = (value: number): string => new Date(value).toLocaleString('zh-CN');

/**
 * 切换某行的展开态
 * @param row 判定结论
 */
const onToggleExpand = (row: MainlineVerdict): void => {
  const key = rowKey(row);
  expandedKeys.value = expandedKeys.value.includes(key)
    ? expandedKeys.value.filter((item) => item !== key)
    : [key];
};

/**
 * 触发一次主线扫描（点击触发，不轮询）
 */
const onScan = async (): Promise<void> => {
  if (scanning.value) return;
  scanning.value = true;
  scanNotice.value = '';
  progress.value = { done: 0, total: 0 };
  try {
    const snapshot = props.repo.snapshot();
    const result = await runMainlineScan(
      props.repo,
      snapshot.boards,
      (next) => {
        progress.value = next;
      },
    );
    if (result.failures.length > 0) {
      scanNotice.value = `有 ${result.failures.length} 个板块取数失败（已保留本地旧数据）：${result.failures.join('、')}`;
    }
  } catch (error) {
    scanNotice.value = `${MAINLINE_SCAN_FAILED}：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    scanning.value = false;
    progress.value = null;
  }
};
</script>

<template>
  <div class="space-y-4">
    <BaseCard>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0 flex-1">
          <h1 class="flex items-center gap-1.5 text-base font-semibold text-text">
            <MenuIcon :name="MAINLINE_MENU_ICON" :size="16" />
            {{ MAINLINE_PAGE_TITLE }}
          </h1>
          <p class="mt-1 text-xs leading-relaxed text-text-secondary">{{ MAINLINE_PAGE_SUBTITLE }}</p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span v-if="progress" class="text-xs tabular-nums text-text-tertiary">
            {{ MAINLINE_SCAN_RUNNING }} {{ progress.done }}/{{ progress.total }}
            {{ MAINLINE_SCAN_PROGRESS_SUFFIX }}
          </span>
          <BaseButton :disabled="scanning" @click="onScan">
            <MenuIcon name="flame" :size="14" />
            {{ MAINLINE_SCAN_BUTTON }}
          </BaseButton>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-text-tertiary">
        <span>数据截止：{{ meta?.asOf || MAINLINE_METRIC_PLACEHOLDER }}</span>
        <span>板块数：{{ meta?.boardCount ?? 0 }}</span>
        <span>全市场成交额：{{ formatYuanToYi(meta?.marketAmount ?? null) }}</span>
        <span v-if="meta">上次扫描：{{ formatScannedAt(meta.scannedAt) }}</span>
      </div>

      <p v-if="scanNotice" class="mt-2 rounded-lg bg-primary-weak px-2 py-1.5 text-xs text-primary">
        {{ scanNotice }}
      </p>

      <div v-if="verdicts.length > 0" class="mt-3 flex flex-wrap items-center gap-1.5">
        <span
          v-for="item in phaseSummary"
          :key="item.phase"
          class="rounded-md px-1.5 py-0.5 text-[11px] tabular-nums"
          :class="item.badgeClass"
        >
          {{ item.label }} {{ item.count }}
        </span>
        <button
          type="button"
          class="pressable ml-1 rounded-md px-1.5 py-0.5 text-[11px] active:scale-95"
          :class="candidateOnly ? 'bg-primary-weak text-primary' : 'bg-flat-weak text-text-secondary'"
          @click="candidateOnly = !candidateOnly"
        >
          {{ MAINLINE_CANDIDATE_BADGE }}{{ candidateOnly ? '（已筛选）' : ` ${verdicts.filter((item) => item.candidate).length}` }}
        </button>
      </div>
    </BaseCard>

    <BaseCard :title="MAINLINE_DETAIL_TITLE">
      <template #extra>
        <span class="text-xs text-text-tertiary">点行首箭头看原始指标与风险提示</span>
      </template>

      <BaseEmpty v-if="rows.length === 0" :text="MAINLINE_EMPTY_TEXT" />

      <BaseTable
        v-else
        :columns="columns"
        :rows="rows"
        :row-key="rowKey"
        :row-clickable="true"
        :expandable="true"
        :expanded-keys="expandedKeys"
        min-width="720px"
        @row-click="onToggleExpand"
        @toggle-expand="onToggleExpand"
      >
        <template #name="{ row }">
          <span class="flex items-center gap-1.5">
            <span class="text-text">{{ row.name }}</span>
            <span
              v-if="row.candidate"
              class="rounded bg-primary-weak px-1 py-0.5 text-[10px] text-primary"
            >
              {{ MAINLINE_CANDIDATE_BADGE }}
            </span>
          </span>
        </template>

        <template #phase="{ row }">
          <span
            class="rounded-md px-1.5 py-0.5 text-[11px] font-medium"
            :class="MAINLINE_PHASE_BADGE_CLASS[row.phase]"
          >
            {{ row.phaseLabel }}
          </span>
        </template>

        <template #change="{ row }">
          <span :class="changeClass(row.metrics.latestChange)">
            {{ formatPercent(row.metrics.latestChange) }}
          </span>
        </template>

        <template #change5="{ row }">
          <span :class="changeClass(row.metrics.change5)">
            {{ formatPercent(row.metrics.change5) }}
          </span>
        </template>

        <template #share="{ row }">{{ formatShare(row.metrics.turnoverShare) }}</template>
        <template #sharePercentile="{ row }">
          {{ formatPercentile(row.metrics.sharePercentile) }}
        </template>
        <template #amountRatio="{ row }">{{ formatRatio(row.metrics.amountRatio) }}</template>
        <template #pricePercentile="{ row }">
          {{ formatPercentile(row.metrics.pricePercentile) }}
        </template>

        <template #expanded="{ row }">
          <div class="space-y-3">
            <p class="text-xs leading-relaxed text-text-secondary">{{ row.phaseDesc }}</p>

            <dl class="grid grid-cols-2 gap-x-6 gap-y-1.5 text-xs sm:grid-cols-3 md:grid-cols-4">
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.asOf }}</dt>
                <dd class="tabular-nums text-text">{{ row.metrics.asOf || '—' }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.historyDays }}</dt>
                <dd class="tabular-nums text-text">
                  {{ row.metrics.historyDays }}{{ MAINLINE_DETAIL_UNIT.days }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.amount }}</dt>
                <dd class="tabular-nums text-text">{{ formatYuanToYi(row.metrics.amount) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.turnoverShare }}</dt>
                <dd class="tabular-nums text-text">{{ formatShare(row.metrics.turnoverShare) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.sharePercentile }}</dt>
                <dd class="tabular-nums text-text">
                  {{ formatPercentile(row.metrics.sharePercentile) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.amountRatio }}</dt>
                <dd class="tabular-nums text-text">{{ formatRatio(row.metrics.amountRatio) }}</dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.pricePercentile }}</dt>
                <dd class="tabular-nums text-text">
                  {{ formatPercentile(row.metrics.pricePercentile) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.change20 }}</dt>
                <dd class="tabular-nums" :class="changeClass(row.metrics.change20)">
                  {{ formatPercent(row.metrics.change20) }}
                </dd>
              </div>
              <div>
                <dt class="text-text-tertiary">{{ MAINLINE_DETAIL_LABEL.confidence }}</dt>
                <dd class="text-text">{{ MAINLINE_CONFIDENCE_LABEL[row.confidence] }}</dd>
              </div>
            </dl>

            <div v-if="row.warnings.length > 0">
              <p class="mb-1 text-xs font-medium text-text-secondary">{{ MAINLINE_WARNING_TITLE }}</p>
              <ul class="space-y-1">
                <li
                  v-for="(warning, index) in row.warnings"
                  :key="index"
                  class="flex gap-1.5 text-xs leading-relaxed text-text-secondary"
                >
                  <span class="text-text-tertiary">•</span>
                  <span>{{ warning }}</span>
                </li>
              </ul>
            </div>
          </div>
        </template>
      </BaseTable>
    </BaseCard>

    <BaseCard :title="MAINLINE_MISSING_TITLE">
      <ul class="space-y-1">
        <li
          v-for="(item, index) in MAINLINE_MISSING_INPUTS"
          :key="index"
          class="flex gap-1.5 text-xs leading-relaxed text-text-secondary"
        >
          <span class="text-text-tertiary">•</span>
          <span>{{ item }}</span>
        </li>
      </ul>
      <p class="mt-2 text-xs leading-relaxed text-text-tertiary">{{ MAINLINE_DISCLAIMER }}</p>
    </BaseCard>
  </div>
</template>

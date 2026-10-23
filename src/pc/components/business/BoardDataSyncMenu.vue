<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import BaseButton from '../ui/BaseButton.vue';
import BaseModal from '../ui/BaseModal.vue';
import MenuIcon from '../ui/MenuIcon.vue';
import { getLocalDateString } from '../../../common/api/board-calendar.api.ts';
import { isBoardDbAvailable, listBoardDailyByDates, readPoolBoundaryDate } from '../../../common/api/board-calendar-db.api.ts';
import {
  applyBoardFetchResult,
  fetchTodayBoardSnapshot,
  getTradingDates,
  upgradeBoardDailyFromKline,
  type BoardUpgradeProgress,
} from '../../../common/composables/use-board-calendar-sync';
import {
  BOARD_DATA_LEVEL,
  BOARD_SYNC_DATE_PICK_MAX,
} from '../../../common/constants/board-calendar.constants.ts';
import type { BoardFetchDayResult } from '../../../common/types/board-calendar.types.ts';

/**
 * 板块日历 · 表头数据维护入口（图标 + 气泡菜单 + 补数弹窗）
 *
 * 2026-10-17 王总定稿交互：**弹窗打开后先选日期，选中后才发请求**——
 * 补数走「成分股日 K 聚合」通道（腾讯逐票取数，全池约 5200 请求、首次 3~5 分钟），
 * 必须让用户显式勾选日期、看清请求量再动手，避免请求量过大被封 IP。
 *
 * 两个菜单项：
 * - 「获取板块数据」：勾选历史交易日（仅涨跌停日升级 / 缺失日补全），日 K 聚合涨跌家数
 * - 「刷新板块数据」：勾选今天，强制重采当日完整快照
 *
 * 全程只抓不落库；底部【取消 / 应用】，点「应用」才写本地库并通知父级刷新表格。
 * 序列为会话内存缓存（board-detail.api seriesMemo）：同一会话内补其它日期零新增请求；
 * 跨会话持久化（接入 kline-db 体系）待王总拍板后另做。
 * 浏览器端无本地库，整个入口不渲染。
 */

const emit = defineEmits<{
  /** 应用完成（数据已落库），父级应重读本地库刷新表格 */
  applied: [];
}>();

/** 菜单项 / 弹窗模式标识 */
const SYNC_MODE = {
  FETCH: 'fetch',
  REFRESH: 'refresh',
} as const;

type SyncMode = (typeof SYNC_MODE)[keyof typeof SYNC_MODE];

/** 弹窗阶段：选日期 → 执行中 → 完成 */
const PHASE = {
  SELECT: 'select',
  RUNNING: 'running',
  DONE: 'done',
} as const;

type Phase = (typeof PHASE)[keyof typeof PHASE];

/** 日期可补状态（fetch 模式） */
const DATE_STATUS = {
  FULL: 'full',
  PARTIAL: 'partial',
  MISSING: 'missing',
  BEYOND: 'beyond',
} as const;

type DateStatus = (typeof DATE_STATUS)[keyof typeof DATE_STATUS];

/** 日期选择行 */
interface DateOption {
  /** 交易日（`YYYY-MM-DD`） */
  date: string;
  /** 可补状态 */
  status: DateStatus;
  /** 是否可勾选 */
  selectable: boolean;
  /** 状态文案 */
  statusLabel: string;
}

/** 菜单项与弹窗文案（fetch / refresh 两态共用一张表） */
const SYNC_MODE_VIEW = {
  [SYNC_MODE.FETCH]: {
    menuLabel: '获取板块数据',
    menuDesc: '勾选日期，按成分股日 K 聚合补数',
    modalTitle: '获取板块数据',
    selectDesc:
      '勾选要补数的交易日（可多选），点「开始获取」后才发请求。补数通道 = 成分股日 K 聚合' +
      '（腾讯逐票取数、无批量）：首次全池约 5200 个请求、并发 6、约 3~5 分钟；' +
      '单票一次拉 140 根序列，选 1 天与选多天请求量相同，同一会话内再补其它日期零新增请求。' +
      '涨跌家数来自日 K 聚合、涨停 / 跌停沿用涨跌停池；板块涨跌幅无官方历史值（留空）。' +
      '「超出回溯窗口」的日子拿不到涨停 / 跌停数据，不可补。',
    runningHint: '正在拉取成分股日 K（腾讯逐票，首次较慢），可随时中断',
    emptyDoneText: '没有可获取的数据',
  },
  [SYNC_MODE.REFRESH]: {
    menuLabel: '刷新板块数据',
    menuDesc: '强制重采当日快照（无视定稿）',
    modalTitle: '刷新板块数据',
    selectDesc:
      '勾选今天后点「开始刷新」，重新拉取当日板块快照与涨跌停池并覆盖本地当日数据' +
      '（无视定稿与节流标记），用于修正异常数据。仅 3 个请求。' +
      '非交易日或盘前（09:25 前）无可刷新对象。点「应用」写入本地数据库并刷新表格。',
    runningHint: '正在采集当日快照…',
    emptyDoneText: '没有可刷新的数据',
  },
} as const;

/** 单日状态 → 列表行展示 */
const DAY_STATUS_VIEW: Record<BoardFetchDayResult['status'], { icon: string; label: string; class: string }> = {
  ok: { icon: 'check', label: '已获取', class: 'text-primary' },
  empty: { icon: 'info', label: '无数据', class: 'text-text-tertiary' },
  failed: { icon: 'close', label: '失败', class: 'text-down' },
};

/** 浏览器端无本地库：整个入口不渲染（页面另有降级提示） */
const isDbAvailable = isBoardDbAvailable();

/** 气泡菜单开关 */
const menuOpen = ref(false);
/** 弹窗开关 */
const modalOpen = ref(false);
/** 当前模式（菜单点击时确定） */
const mode = ref<SyncMode>(SYNC_MODE.FETCH);
/** 弹窗阶段 */
const phase = ref<Phase>(PHASE.SELECT);

/** 日期选择清单（fetch 模式；refresh 模式只有今天一行） */
const dateOptions = ref<DateOption[]>([]);
/** 已勾选的交易日 */
const selectedDates = ref<string[]>([]);
/** 选项清单加载中 */
const isLoadingOptions = ref(false);
/** 选项加载失败（重开弹窗重试） */
const optionError = ref<string | null>(null);

/** 执行进度 */
const progress = ref<BoardUpgradeProgress | null>(null);
/** 执行结果的单日列表 */
const days = ref<BoardFetchDayResult[]>([]);
/** 致命错误（连第一步都没走通 / 用户中断） */
const fatalText = ref<string | null>(null);
/** 正在写库（应用按钮转圈） */
const isApplying = ref(false);

/** 中断控制器（关弹窗 / 点中断时 abort） */
let abortController: AbortController | null = null;
/** 防迟到写入的运行代号 */
let runId = 0;

/** 当前模式的文案表 */
const view = computed(() => SYNC_MODE_VIEW[mode.value]);

/** 可勾选的日期数 */
const selectableCount = computed(() => dateOptions.value.filter((item) => item.selectable).length);

/** 展示顺序：交易日降序（与日历矩阵列序一致，最近在上） */
const sortedDays = computed(() =>
  [...days.value].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate)),
);

/** 可应用的天数（仅 ok 日携带数据） */
const applyCount = computed(() => days.value.filter((day) => day.status === 'ok').length);

/** fetch 模式的汇总行 */
const fetchSummary = computed<string>(() => {
  const ok = applyCount.value;
  const failed = days.value.filter((day) => day.status === 'failed').length;
  const parts: string[] = [`已获取 ${ok} 个交易日`];
  if (failed > 0) parts.push(`${failed} 日失败`);
  return parts.join(' · ');
});

/**
 * 打开弹窗（气泡菜单点击）
 * @param next 目标模式
 */
const openModal = (next: SyncMode): void => {
  mode.value = next;
  menuOpen.value = false;
  modalOpen.value = true;
};

/**
 * 加载日期选择清单（fetch 模式）：交易日轴 × 库内数据状态
 *
 * 状态判定：库内有行 → 全 FULL = 已完整（禁选）、含 PARTIAL = 仅涨跌停可升级；
 * 无行 → 晚于池边界 = 缺失可补、不晚于边界 = 超出回溯窗口（禁选）。
 */
const loadDateOptions = async (): Promise<void> => {
  isLoadingOptions.value = true;
  optionError.value = null;
  try {
    const axis = await getTradingDates(false);
    const today = getLocalDateString();
    const recent = axis.filter((date) => date !== today).slice(-BOARD_SYNC_DATE_PICK_MAX).reverse();
    const rows = await listBoardDailyByDates(recent);
    const boundary = await readPoolBoundaryDate();
    dateOptions.value = recent.map((date) => {
      const dayRows = rows.filter((row) => row.tradeDate === date);
      if (dayRows.length > 0) {
        const allFull = dayRows.every((row) => row.dataLevel === BOARD_DATA_LEVEL.FULL);
        return allFull
          ? { date, status: DATE_STATUS.FULL, selectable: false, statusLabel: '已完整' }
          : { date, status: DATE_STATUS.PARTIAL, selectable: true, statusLabel: '仅涨跌停 · 可升级' };
      }
      const reachable = boundary === null || date > boundary;
      return reachable
        ? { date, status: DATE_STATUS.MISSING, selectable: true, statusLabel: '缺失 · 可补' }
        : { date, status: DATE_STATUS.BEYOND, selectable: false, statusLabel: '超出回溯窗口' };
    });
    // 默认勾选全部可选项（用户按需取消，减小请求面）
    selectedDates.value = dateOptions.value
      .filter((item) => item.selectable)
      .map((item) => item.date);
  } catch (error) {
    optionError.value = error instanceof Error && error.message ? error.message : '交易日轴获取失败';
  } finally {
    isLoadingOptions.value = false;
  }
};

/**
 * 加载 refresh 模式的「今天」选项（非交易日 / 盘前也可打开，执行侧会拒绝并说明）
 */
const loadTodayOption = async (): Promise<void> => {
  isLoadingOptions.value = true;
  optionError.value = null;
  try {
    const axis = await getTradingDates(false);
    const today = getLocalDateString();
    const isTradingDay = axis[axis.length - 1] === today;
    dateOptions.value = [
      {
        date: today,
        status: DATE_STATUS.FULL,
        selectable: isTradingDay,
        statusLabel: isTradingDay ? '当日快照' : '今日非交易日',
      },
    ];
    selectedDates.value = isTradingDay ? [today] : [];
  } catch (error) {
    optionError.value = error instanceof Error && error.message ? error.message : '交易日轴获取失败';
  } finally {
    isLoadingOptions.value = false;
  }
};

// 每次打开弹窗都重置到选日期阶段（上次的结果不残留，取消过的改动不悄悄生效）
watch(modalOpen, (isOpen) => {
  if (!isOpen) {
    // 关闭即中断执行中的请求（runId 同时让迟到回调失效）
    abortController?.abort();
    return;
  }
  runId += 1;
  phase.value = PHASE.SELECT;
  days.value = [];
  fatalText.value = null;
  progress.value = null;
  if (mode.value === SYNC_MODE.FETCH) {
    void loadDateOptions();
  } else {
    void loadTodayOption();
  }
});

/**
 * 勾选 / 取消一个日期
 * @param option 日期行
 * @param event 复选框 change 事件
 */
const onToggleDate = (option: DateOption, event: Event): void => {
  const checked = (event.target as HTMLInputElement).checked;
  const next = new Set(selectedDates.value);
  if (checked) {
    next.add(option.date);
  } else {
    next.delete(option.date);
  }
  selectedDates.value = dateOptions.value
    .map((item) => item.date)
    .filter((date) => next.has(date));
};

/** 执行采集（fetch = 日 K 聚合升级；refresh = 当日快照重采） */
const run = async (): Promise<void> => {
  const id = runId;
  abortController = new AbortController();
  phase.value = PHASE.RUNNING;
  days.value = [];
  fatalText.value = null;
  progress.value = { stage: 'pool', completed: 0, total: 0, detail: '' };

  let result: { days: BoardFetchDayResult[]; error: string | null };
  if (mode.value === SYNC_MODE.FETCH) {
    result = await upgradeBoardDailyFromKline(
      [...selectedDates.value],
      (value) => {
        if (runId !== id) return;
        progress.value = value;
      },
      abortController.signal,
    );
  } else {
    result = await fetchTodayBoardSnapshot();
  }
  if (runId !== id) return;
  // 用户中断 → 回到选日期阶段（勾选保留，可调整后重跑）
  if (result.error === '已取消' || result.error === '分析已取消') {
    phase.value = PHASE.SELECT;
    fatalText.value = null;
    return;
  }
  days.value = [...result.days].sort((a, b) => b.tradeDate.localeCompare(a.tradeDate));
  fatalText.value = result.error;
  phase.value = PHASE.DONE;
};

/** 中断执行（RUNNING 阶段的取消按钮） */
const onAbort = (): void => {
  abortController?.abort();
};

/** 点击「应用」：把内存数据写入本地库并通知父级刷新 */
const onApply = async (): Promise<void> => {
  if (phase.value !== PHASE.DONE || applyCount.value === 0 || isApplying.value) return;
  isApplying.value = true;
  try {
    await applyBoardFetchResult({
      mode: mode.value,
      days: days.value,
      boundaryDate: null,
      missingTotal: 0,
      beyondBoundaryCount: 0,
      error: fatalText.value,
    });
    emit('applied');
    modalOpen.value = false;
  } finally {
    isApplying.value = false;
  }
};

/**
 * 单日行的日期展示（MM-DD）
 * @param tradeDate 交易日（`YYYY-MM-DD`）
 * @returns `MM-DD`
 */
const shortDate = (tradeDate: string): string => tradeDate.slice(5);
</script>

<template>
  <div v-if="isDbAvailable" class="relative shrink-0">
    <!-- 表头入口图标 -->
    <button
      type="button"
      class="pressable rounded p-1 text-text-tertiary hover:bg-flat-weak hover:text-text active:scale-90"
      aria-label="板块数据维护"
      title="获取 / 刷新板块数据"
      @click="menuOpen = !menuOpen"
    >
      <MenuIcon name="database" :size="14" />
    </button>

    <!-- 透明遮罩：点外部收起气泡菜单 -->
    <div v-if="menuOpen" class="fixed inset-0 z-30" @click="menuOpen = false" />

    <!-- 气泡菜单 -->
    <div
      v-if="menuOpen"
      class="absolute right-0 top-full z-40 mt-1 w-60 rounded-lg border border-flat-weak bg-surface py-1 shadow-xl"
      role="menu"
    >
      <button
        v-for="(item, key) in SYNC_MODE_VIEW"
        :key="key"
        type="button"
        class="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-flat-weak"
        role="menuitem"
        @click="openModal(key as SyncMode)"
      >
        <MenuIcon
          :name="key === SYNC_MODE.FETCH ? 'database' : 'refresh'"
          :size="15"
          class="mt-0.5 shrink-0 text-text-tertiary"
        />
        <span class="min-w-0">
          <span class="block text-sm text-text">{{ item.menuLabel }}</span>
          <span class="block text-xs text-text-tertiary">{{ item.menuDesc }}</span>
        </span>
      </button>
    </div>

    <!-- 补数弹窗：先选日期 → 开始执行 → 应用落库 -->
    <BaseModal
      v-model:open="modalOpen"
      :title="view.modalTitle"
      max-width-class="max-w-md"
    >
      <!-- 阶段一：选日期 -->
      <template v-if="phase === PHASE.SELECT">
        <p class="mb-3 text-xs leading-5 text-text-tertiary">{{ view.selectDesc }}</p>

        <p v-if="optionError" class="mb-3 text-sm text-down" role="alert">{{ optionError }}</p>

        <p v-if="isLoadingOptions" class="flex items-center gap-2 py-6 text-sm text-text-tertiary">
          <span
            class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-flat-weak border-t-primary"
          />
          正在读取交易日与本地数据状态…
        </p>

        <template v-else-if="dateOptions.length > 0">
          <div class="mb-2 flex items-center justify-between text-xs text-text-tertiary">
            <span>已选 {{ selectedDates.length }} / {{ selectableCount }} 个可补日</span>
            <button
              type="button"
              class="pressable text-primary hover:underline"
              @click="
                selectedDates =
                  selectedDates.length === selectableCount
                    ? []
                    : dateOptions.filter((item) => item.selectable).map((item) => item.date)
              "
            >
              {{ selectedDates.length === selectableCount ? '清空' : '全选可补日' }}
            </button>
          </div>
          <ul class="max-h-72 space-y-1 overflow-y-auto pr-1">
            <li
              v-for="option in dateOptions"
              :key="option.date"
              class="flex select-none items-center gap-2.5 rounded-lg border border-flat-weak px-2.5 py-1.5 text-sm"
              :class="option.selectable ? '' : 'opacity-55'"
            >
              <input
                :checked="selectedDates.includes(option.date)"
                type="checkbox"
                class="h-4 w-4 shrink-0 cursor-pointer rounded border-flat-weak accent-primary"
                :disabled="!option.selectable"
                @change="onToggleDate(option, $event)"
              />
              <span class="w-14 shrink-0 tabular-nums text-text">{{ shortDate(option.date) }}</span>
              <span
                class="shrink-0 text-xs"
                :class="option.selectable ? 'text-primary' : 'text-text-tertiary'"
              >
                {{ option.statusLabel }}
              </span>
            </li>
          </ul>
        </template>
        <p v-else class="py-6 text-sm text-text-tertiary">{{ view.emptyDoneText }}</p>
      </template>

      <!-- 阶段二：执行中 -->
      <template v-else-if="phase === PHASE.RUNNING">
        <p class="mb-2 flex items-center gap-2 text-sm text-text">
          <span
            class="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-flat-weak border-t-primary"
          />
          {{ progress?.stage === 'pool' ? '正在探测缺失日涨跌停池…' : view.runningHint }}
        </p>
        <p
          v-if="progress && progress.total > 0"
          class="mb-2 text-xs tabular-nums text-text-tertiary"
        >
          {{ progress.stage === 'kline' ? `当前板块：${progress.detail} · ` : '' }}
          {{ progress.completed }}/{{ progress.total }}
          <span v-if="progress.stage === 'kline'">
            （{{ Math.round((progress.completed / progress.total) * 100) }}%）
          </span>
        </p>
        <div class="h-1.5 overflow-hidden rounded-full bg-flat-weak">
          <div
            class="h-full rounded-full bg-primary transition-all duration-300"
            :style="{
              width:
                progress && progress.total > 0
                  ? `${Math.min(100, (progress.completed / progress.total) * 100)}%`
                  : '0%',
            }"
          />
        </div>
        <p class="mt-3 text-xs leading-5 text-text-tertiary">
          中断后已拉到的序列仍在本会话缓存中，下次继续时已完成的票不会重复请求。
        </p>
      </template>

      <!-- 阶段三：完成，等待应用 -->
      <template v-else>
        <p v-if="fatalText" class="mb-3 text-sm text-down" role="alert">{{ fatalText }}</p>
        <div class="mb-2 space-y-1 text-sm text-text">
          <template v-if="mode === SYNC_MODE.FETCH">
            <p v-if="days.length === 0">{{ view.emptyDoneText }}</p>
            <p v-else>{{ fetchSummary }}</p>
          </template>
          <template v-else>
            <p v-if="applyCount === 0">{{ view.emptyDoneText }}</p>
            <p v-else>
              {{ sortedDays[0]?.tradeDate }} 快照：
              板块 {{ sortedDays[0]?.rows.length }} 个 ·
              涨停 {{ sortedDays[0]?.limitUpCnt }} ·
              跌停 {{ sortedDays[0]?.limitDownCnt }}
            </p>
          </template>
        </div>
        <ul v-if="sortedDays.length > 0" class="max-h-56 space-y-1 overflow-y-auto text-xs">
          <li
            v-for="day in sortedDays"
            :key="day.tradeDate"
            class="flex items-center gap-2 rounded px-1 py-0.5"
          >
            <span class="w-12 shrink-0 tabular-nums text-text">{{ shortDate(day.tradeDate) }}</span>
            <span :class="DAY_STATUS_VIEW[day.status].class">
              {{ DAY_STATUS_VIEW[day.status].label }}
            </span>
            <span v-if="day.status === 'ok'" class="tabular-nums text-text-tertiary">
              涨停 {{ day.limitUpCnt }} · 跌停 {{ day.limitDownCnt }}
            </span>
            <span class="truncate text-text-tertiary">{{ day.message }}</span>
          </li>
        </ul>
      </template>

      <template #footer>
        <BaseButton v-if="phase !== PHASE.RUNNING" variant="ghost" @click="modalOpen = false">
          取消
        </BaseButton>
        <BaseButton v-else variant="ghost" @click="onAbort">中断</BaseButton>

        <BaseButton
          v-if="phase === PHASE.SELECT"
          :disabled="selectedDates.length === 0 || isLoadingOptions"
          @click="run"
        >
          {{ mode === SYNC_MODE.FETCH ? '开始获取' : '开始刷新' }}
        </BaseButton>
        <BaseButton
          v-else-if="phase === PHASE.DONE"
          :disabled="applyCount === 0 || isApplying"
          @click="onApply"
        >
          {{ isApplying ? '写入中…' : '应用' }}
        </BaseButton>
      </template>
    </BaseModal>
  </div>
</template>

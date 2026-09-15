<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useIntervalFn } from "@vueuse/core";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseConfirmModal from "../components/ui/BaseConfirmModal.vue";
import BaseEmpty from "../components/ui/BaseEmpty.vue";
import BaseInput from "../components/ui/BaseInput.vue";
import BaseTable from "../components/ui/BaseTable.vue";
import BaseTabs from "../components/ui/BaseTabs.vue";
import BaseTag from "../components/ui/BaseTag.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import NoticeBar from "../components/ui/NoticeBar.vue";
import { useLazyRows } from "../composables/use-lazy-rows";
import { WEBLOG_CATEGORY_LABEL } from "../weblog/weblogActions.enum";
import {
  clearWeblogLogs,
  flushWeblog,
  isWeblogPersisted,
  queryActionLogs,
  queryErrorLogs,
  queryLogStats,
  trackAction,
} from "../weblog";
import { exportRowsToExcel } from "../utils/export-excel";
import {
  WEBLOG_ERROR_KIND_LABEL,
  WEBLOG_EXPORT_FILE_PREFIX,
  WEBLOG_LEVEL_LABEL,
  WEBLOG_PAGE_AUTO_REFRESH_MS,
  WEBLOG_PAGE_CHUNK_SIZE,
  WEBLOG_QUERY_LIMIT,
  WEBLOG_RANGE_DEFAULT,
  WEBLOG_RANGE_OPTIONS,
  WEBLOG_RETENTION_DAYS,
  WEBLOG_STATUS_LABEL,
  WEBLOG_TIME_FORMAT,
} from "../constants/weblog.constants";
import { formatDateTime } from "../utils/format-datetime";
import type { TableColumn } from "../types/table.types";
import type {
  WeblogActionLog,
  WeblogCategory,
  WeblogErrorKind,
  WeblogErrorLog,
  WeblogLevel,
  WeblogLogStats,
} from "../types/weblog.types";

/**
 * 系统日志：报错日志 / 行为日志两个页签，表格查看
 *
 * 数据来自 weblog.db（独立日志库，保留最近 3 天）：
 * - 报错日志：运行异常 / 资源加载 / Promise 拒绝 / Vue 异常 / 业务 console.error / 接口失败
 * - 行为日志：页面显示 / 导航按钮 / 接口请求 / 业务操作 / 系统事件
 *
 * 每条记录都带触发时间（YYYY-MM-DD HH:mm:ss）、系统版本、WebView 内核与 UA；
 * 行首展开箭头可看完整堆栈、链路号与运行环境快照。
 */

/** 行为日志行（附表格行 key） */
interface ActionRow extends WeblogActionLog {
  /** 表格行 key（内存兜底记录主键可能重复，拼序号保证唯一） */
  rowId: string;
}

/** 报错日志行（附表格行 key） */
interface ErrorRow extends WeblogErrorLog {
  /** 表格行 key */
  rowId: string;
}

/** 页签选项 */
const TAB_OPTIONS = [
  { label: "报错日志", value: "error" },
  { label: "行为日志", value: "action" },
] as const;

/** 时间范围选项（BaseTabs 要求字符串 value，这里映射一次） */
const RANGE_TABS = WEBLOG_RANGE_OPTIONS.map((option) => ({
  label: option.label,
  value: String(option.value),
}));

/** 等级选项 */
const LEVEL_TABS = [
  { label: "全部等级", value: "" },
  { label: WEBLOG_LEVEL_LABEL.warn, value: "warn" },
  { label: WEBLOG_LEVEL_LABEL.error, value: "error" },
  { label: WEBLOG_LEVEL_LABEL.fatal, value: "fatal" },
];

/** 分类选项 */
const CATEGORY_TABS = [
  { label: "全部分类", value: "" },
  { label: WEBLOG_CATEGORY_LABEL.page, value: "page" },
  { label: WEBLOG_CATEGORY_LABEL.navbar, value: "navbar" },
  { label: WEBLOG_CATEGORY_LABEL.api, value: "api" },
  { label: WEBLOG_CATEGORY_LABEL.business, value: "business" },
  { label: WEBLOG_CATEGORY_LABEL.system, value: "system" },
];

/** 报错日志列配置 */
const ERROR_COLUMNS: TableColumn<ErrorRow>[] = [
  { key: "timeText", label: "触发时间", sortable: true, sortValue: (row) => row.occurredAt },
  { key: "level", label: "等级", sortable: true, sortValue: (row) => row.level },
  { key: "kind", label: "来源", sortable: true, sortValue: (row) => row.kind },
  { key: "message", label: "报错信息" },
  { key: "systemText", label: "系统 / 内核" },
  { key: "pagePath", label: "触发页面" },
  { key: "appVersion", label: "版本", sortable: true, sortValue: (row) => row.appVersion },
];

/** 行为日志列配置 */
const ACTION_COLUMNS: TableColumn<ActionRow>[] = [
  { key: "timeText", label: "触发时间", sortable: true, sortValue: (row) => row.occurredAt },
  { key: "categoryLabel", label: "分类", sortable: true, sortValue: (row) => row.category },
  { key: "label", label: "行为", sortable: true, sortValue: (row) => row.label },
  { key: "target", label: "操作目标" },
  { key: "pagePath", label: "所在页面" },
  { key: "durationText", label: "耗时", sortable: true, sortValue: (row) => row.durationMs ?? -1 },
  { key: "status", label: "状态", sortable: true, sortValue: (row) => row.status ?? "" },
  { key: "appVersion", label: "版本", sortable: true, sortValue: (row) => row.appVersion },
];

/** 当前页签：error 报错日志 / action 行为日志 */
const activeTab = ref<string>("error");

/** 时间范围（毫秒，取当前时刻往前推） */
const rangeMs = ref<number>(WEBLOG_RANGE_DEFAULT);

/** 关键字（在文案 / 页面 / 接口地址中模糊匹配） */
const keyword = ref("");

/** 行为日志分类筛选（空串 = 全部） */
const category = ref<WeblogCategory | "">("");

/** 报错日志等级筛选（空串 = 全部） */
const level = ref<WeblogLevel | "">("");

/** 加载中 */
const loading = ref(false);

/** 报错日志数据 */
const errorRows = ref<ErrorRow[]>([]);

/** 行为日志数据 */
const actionRows = ref<ActionRow[]>([]);

/** 条数统计 */
const stats = ref<WeblogLogStats>({ errorCount: 0, actionCount: 0, retentionFrom: 0 });

/** 清空确认弹窗 */
const clearModalOpen = ref(false);

/** 展开的报错行 key */
const expandedErrorKeys = ref<string[]>([]);

/** 展开的行为行 key */
const expandedActionKeys = ref<string[]>([]);

/** 最近一次刷新时刻文案 */
const lastRefreshText = ref("");

/** 当前环境是否落库（浏览器 dev 只有内存，页面需说明差异） */
const persisted = isWeblogPersisted();

/** 等级底色（警告走中性色；错误与致命走危险语义色） */
const LEVEL_TONE: Record<WeblogLevel, "flat" | "up"> = {
  warn: "flat",
  error: "up",
  fatal: "up",
};

/** 时间范围 v-model 适配（数值 ↔ 字符串） */
const rangeProxy = computed({
  get: () => String(rangeMs.value),
  set: (value: string) => {
    rangeMs.value = Number(value);
  },
});

/** 等级 v-model 适配（联合类型 ↔ 字符串） */
const levelProxy = computed({
  get: () => level.value,
  set: (value: string) => {
    level.value = value as WeblogLevel | "";
  },
});

/** 分类 v-model 适配（联合类型 ↔ 字符串） */
const categoryProxy = computed({
  get: () => category.value,
  set: (value: string) => {
    category.value = value as WeblogCategory | "";
  },
});

/** 报错表懒加载 */
const {
  rows: errorLazyRows,
  hasMore: errorHasMore,
  total: errorTotal,
  onScroll: onErrorTableScroll,
} = useLazyRows<ErrorRow>(() => errorRows.value, WEBLOG_PAGE_CHUNK_SIZE);

/** 行为表懒加载 */
const {
  rows: actionLazyRows,
  hasMore: actionHasMore,
  total: actionTotal,
  onScroll: onActionTableScroll,
} = useLazyRows<ActionRow>(() => actionRows.value, WEBLOG_PAGE_CHUNK_SIZE);

/** 概览文案 */
const summaryText = computed(
  () =>
    `本地保留最近 ${WEBLOG_RETENTION_DAYS} 天日志：报错 ${stats.value.errorCount} 条 · 行为 ${stats.value.actionCount} 条${
      lastRefreshText.value ? `（${lastRefreshText.value} 刷新）` : ""
    }`,
);

/** 未落库提示（浏览器环境才展示） */
const persistNotice = computed(() =>
  persisted
    ? ""
    : "浏览器环境没有本地数据库：当前只显示本次会话内存里的记录，桌面端（Tauri）会落库持久化",
);

/** 报错表底部提示 */
const errorFooterText = computed(() =>
  errorHasMore.value
    ? `已展示 ${errorLazyRows.value.length} / ${errorTotal.value} 条，滚动加载更多`
    : `共 ${errorTotal.value} 条`,
);

/** 行为表底部提示 */
const actionFooterText = computed(() =>
  actionHasMore.value
    ? `已展示 ${actionLazyRows.value.length} / ${actionTotal.value} 条，滚动加载更多`
    : `共 ${actionTotal.value} 条`,
);

/**
 * 取系统 / 内核展示串
 * @param row 报错记录
 * @returns 形如 `Windows 11 13.0.0 · WebView2 140.0` 的文案
 */
const systemText = (row: WeblogErrorLog): string => {
  const os = [row.osName, row.osVersion].filter(Boolean).join(" ");
  return [os, row.webview].filter(Boolean).join(" · ") || "—";
};

/**
 * 取接口展示串（含状态码）
 * @param row 报错记录
 * @returns 接口地址与状态码
 */
const apiText = (row: WeblogErrorLog): string => {
  if (!row.apiUrl) return "—";
  return row.apiStatus ? `${row.apiUrl}（HTTP ${row.apiStatus}）` : row.apiUrl;
};

/**
 * 取耗时展示串
 * @param row 行为记录
 * @returns 形如 `123ms` 的文案
 */
const durationText = (row: WeblogActionLog): string =>
  row.durationMs === null || row.durationMs === undefined ? "—" : `${row.durationMs}ms`;

/**
 * 分类中文名
 * @param value 分类键
 * @returns 中文名；未知键原样返回
 */
const categoryLabel = (value: string): string =>
  WEBLOG_CATEGORY_LABEL[value as WeblogCategory] ?? value;

/**
 * 报错来源中文名
 * @param value 来源键
 * @returns 中文名；未知键原样返回
 */
const kindLabel = (value: string): string =>
  WEBLOG_ERROR_KIND_LABEL[value as WeblogErrorKind] ?? value;

/**
 * 报告行 key
 * @param row 报错行
 * @returns 行 key
 */
const errorRowKey = (row: ErrorRow): string => row.rowId;

/**
 * 行为行 key
 * @param row 行为行
 * @returns 行 key
 */
const actionRowKey = (row: ActionRow): string => row.rowId;

/**
 * 拉取日志（先落库再查询，保证刚发生的操作立刻可见）
 * @returns 加载完成 Promise
 */
const reload = async (): Promise<void> => {
  loading.value = true;
  try {
    await flushWeblog();
    const sinceMs = Math.max(0, Date.now() - rangeMs.value);
    const trimmedKeyword = keyword.value.trim();
    const [errors, actions, logStats] = await Promise.all([
      queryErrorLogs({
        sinceMs,
        keyword: trimmedKeyword,
        level: level.value,
        limit: WEBLOG_QUERY_LIMIT,
      }),
      queryActionLogs({
        sinceMs,
        keyword: trimmedKeyword,
        category: category.value,
        limit: WEBLOG_QUERY_LIMIT,
      }),
      queryLogStats(sinceMs),
    ]);
    errorRows.value = errors.map((row, index) => ({ ...row, rowId: `${index}-${row.id}` }));
    actionRows.value = actions.map((row, index) => ({ ...row, rowId: `${index}-${row.id}` }));
    stats.value = logStats;
    lastRefreshText.value = formatDateTime(Date.now());
    expandedErrorKeys.value = [];
    expandedActionKeys.value = [];
  } finally {
    loading.value = false;
  }
};

/**
 * 报错行展开态切换
 * @param row 报错行
 */
const toggleErrorExpand = (row: ErrorRow): void => {
  const index = expandedErrorKeys.value.indexOf(row.rowId);
  if (index >= 0) {
    expandedErrorKeys.value.splice(index, 1);
  } else {
    expandedErrorKeys.value.push(row.rowId);
  }
};

/**
 * 行为行展开态切换
 * @param row 行为行
 */
const toggleActionExpand = (row: ActionRow): void => {
  const index = expandedActionKeys.value.indexOf(row.rowId);
  if (index >= 0) {
    expandedActionKeys.value.splice(index, 1);
  } else {
    expandedActionKeys.value.push(row.rowId);
  }
};

/** 当前页签的中文名（埋点说明用） */
const activeTabLabel = computed(() => (activeTab.value === "error" ? "报错日志" : "行为日志"));

/** 手动刷新 */
const onRefresh = (): void => {
  void reload();
};

/** 关键字回车触发查询 */
const onKeywordEnter = (): void => {
  void reload();
};

/** 切换页签 */
watch(activeTab, () => {
  trackAction("LOG_TAB_SWITCH", { target: activeTabLabel.value });
});

// 筛选条件变化即重查（关键字由回车触发，避免每敲一个字符查一次库）
watch([rangeMs, category, level], () => {
  trackAction("LOG_FILTER", {
    target: `范围 ${Math.round(rangeMs.value / 3600000)}h`,
    detail: JSON.stringify({ level: level.value, category: category.value }),
  });
  void reload();
});

/** 导出当前页签数据 */
const onExport = async (): Promise<void> => {
  const stamp = formatDateTime(Date.now()).replace(/[-: ]/g, "");
  if (activeTab.value === "error") {
    const rows = errorRows.value.map((row) => ({
      触发时间: row.timeText,
      等级: WEBLOG_LEVEL_LABEL[row.level] ?? row.level,
      来源: kindLabel(row.kind),
      报错信息: row.message,
      系统: systemText(row),
      触发页面: row.pagePath,
      版本: row.appVersion,
      接口: apiText(row),
      堆栈: row.stack ?? "",
      详情: row.detail ?? "",
    }));
    const columns = [
      { label: "触发时间", key: "触发时间" },
      { label: "等级", key: "等级" },
      { label: "来源", key: "来源" },
      { label: "报错信息", key: "报错信息" },
      { label: "系统", key: "系统" },
      { label: "触发页面", key: "触发页面" },
      { label: "版本", key: "版本" },
      { label: "接口", key: "接口" },
      { label: "堆栈", key: "堆栈" },
      { label: "详情", key: "详情" },
    ];
    await exportRowsToExcel(
      rows as unknown as Record<string, unknown>[],
      columns,
      `${WEBLOG_EXPORT_FILE_PREFIX}-报错日志-${stamp}`,
    );
    return;
  }
  const rows = actionRows.value.map((row) => ({
    触发时间: row.timeText,
    分类: categoryLabel(row.category),
    行为: row.label,
    操作目标: row.target ?? "",
    所在页面: row.pagePath,
    耗时ms: row.durationMs ?? "",
    状态: row.status ? WEBLOG_STATUS_LABEL[row.status] : "",
    版本: row.appVersion,
    动作标识: row.action,
    详情: row.detail ?? "",
  }));
  const columns = [
    { label: "触发时间", key: "触发时间" },
    { label: "分类", key: "分类" },
    { label: "行为", key: "行为" },
    { label: "操作目标", key: "操作目标" },
    { label: "所在页面", key: "所在页面" },
    { label: "耗时ms", key: "耗时ms" },
    { label: "状态", key: "状态" },
    { label: "版本", key: "版本" },
    { label: "动作标识", key: "动作标识" },
    { label: "详情", key: "详情" },
  ];
  await exportRowsToExcel(
    rows as unknown as Record<string, unknown>[],
    columns,
    `${WEBLOG_EXPORT_FILE_PREFIX}-行为日志-${stamp}`,
  );
};

/** 确认清空全部日志（确认按钮在弹窗内，无法用 data-track 标注，这里显式上报） */
const onConfirmClear = async (): Promise<void> => {
  const result = await clearWeblogLogs();
  trackAction("LOG_CLEAR", { target: "全部日志", detail: JSON.stringify(result) });
  await reload();
};

onMounted(() => {
  void reload();
});

// 日志页自动刷新：排错时盯屏用，10 秒拉一次最新记录（手动「刷新」随时可用）
useIntervalFn(() => {
  void reload();
}, WEBLOG_PAGE_AUTO_REFRESH_MS);
</script>

<template>
  <div class="space-y-4">
    <NoticeBar :text="summaryText" />
    <NoticeBar v-if="persistNotice" :text="persistNotice" />

    <BaseCard title="系统日志">
      <template #extra>
        <div class="flex items-center gap-1.5">
          <!-- 埋点走 data-track（无独立 @click 埋点），避免同一操作记两条 -->
          <BaseButton
            variant="ghost"
            :disabled="loading"
            data-track="LOG_REFRESH"
            :data-track-detail="activeTabLabel"
            @click="onRefresh"
          >
            {{ loading ? "加载中..." : "刷新" }}
          </BaseButton>
          <BaseButton
            variant="ghost"
            data-track="LOG_EXPORT"
            :data-track-detail="activeTabLabel"
            @click="onExport"
          >
            导出
          </BaseButton>
          <BaseButton variant="danger" @click="clearModalOpen = true">清空</BaseButton>
        </div>
      </template>

      <!-- 页签 + 关键字 + 时间范围 -->
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <BaseTabs v-model="activeTab" :options="TAB_OPTIONS" variant="underline" />
        <div class="flex min-w-[200px] flex-1 items-center gap-2">
          <MenuIcon name="search" :size="14" class="shrink-0 text-text-tertiary" />
          <BaseInput
            v-model="keyword"
            placeholder="搜索报错信息 / 行为 / 页面 / 接口地址（回车生效）"
            @keyup.enter="onKeywordEnter"
          />
        </div>
        <BaseTabs v-model="rangeProxy" :options="RANGE_TABS" />
      </div>

      <!-- 等级 / 分类筛选 -->
      <div class="mb-3 flex flex-wrap items-center gap-2">
        <BaseTabs v-if="activeTab === 'error'" v-model="levelProxy" :options="LEVEL_TABS" />
        <BaseTabs v-else v-model="categoryProxy" :options="CATEGORY_TABS" />
      </div>

      <!-- 报错日志表 -->
      <template v-if="activeTab === 'error'">
        <BaseTable
          v-if="errorRows.length > 0"
          :columns="ERROR_COLUMNS"
          :rows="errorLazyRows"
          :row-key="errorRowKey"
          min-width="1180px"
          expandable
          :expanded-keys="expandedErrorKeys"
          :footer-text="errorFooterText"
          @scroll="onErrorTableScroll"
          @toggle-expand="toggleErrorExpand"
        >
          <template #timeText="{ row }">
            <span class="tabular-nums">{{ row.timeText }}</span>
          </template>
          <template #level="{ row }">
            <BaseTag :tone="LEVEL_TONE[row.level]">
              {{ WEBLOG_LEVEL_LABEL[row.level] ?? row.level }}
            </BaseTag>
          </template>
          <template #kind="{ row }">{{ kindLabel(row.kind) }}</template>
          <template #message="{ row }">
            <span class="block max-w-[420px] truncate" :title="row.message">{{ row.message }}</span>
          </template>
          <template #systemText="{ row }">{{ systemText(row) }}</template>
          <template #pagePath="{ row }">
            <span class="text-text-secondary">{{ row.pageTitle || row.pagePath || "—" }}</span>
          </template>
          <template #expanded="{ row }">
            <div class="space-y-2 text-xs">
              <div class="flex flex-wrap gap-x-6 gap-y-1 text-text-tertiary">
                <span>链路 {{ row.traceId ?? "—" }}</span>
                <span>运行环境 {{ row.runtime }}</span>
                <span>接口 {{ apiText(row) }}</span>
                <span>耗时 {{ row.durationMs === null ? "—" : `${row.durationMs}ms` }}</span>
                <span>屏幕 {{ row.screen ?? "—" }}</span>
              </div>
              <p v-if="row.detail" class="break-all text-text-secondary">
                上下文：{{ row.detail }}
              </p>
              <pre
                v-if="row.stack"
                class="max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-flat-weak p-3 text-[11px] leading-5 text-text-secondary"
              >{{ row.stack }}</pre>
              <p class="break-all text-text-tertiary">UA：{{ row.ua ?? "—" }}</p>
            </div>
          </template>
        </BaseTable>
        <BaseEmpty v-else :text="loading ? '正在加载日志...' : '该时间范围内没有报错记录'" />
      </template>

      <!-- 行为日志表 -->
      <template v-else>
        <BaseTable
          v-if="actionRows.length > 0"
          :columns="ACTION_COLUMNS"
          :rows="actionLazyRows"
          :row-key="actionRowKey"
          min-width="1120px"
          expandable
          :expanded-keys="expandedActionKeys"
          :footer-text="actionFooterText"
          @scroll="onActionTableScroll"
          @toggle-expand="toggleActionExpand"
        >
          <template #timeText="{ row }">
            <span class="tabular-nums">{{ row.timeText }}</span>
          </template>
          <template #categoryLabel="{ row }">
            <BaseTag :tone="row.category === 'api' ? 'primary' : 'flat'">
              {{ categoryLabel(row.category) }}
            </BaseTag>
          </template>
          <template #target="{ row }">
            <span class="block max-w-[380px] truncate text-text-secondary" :title="row.target ?? ''">
              {{ row.target ?? "—" }}
            </span>
          </template>
          <template #pagePath="{ row }">
            <span class="text-text-secondary">{{ row.pageTitle || row.pagePath || "—" }}</span>
          </template>
          <template #durationText="{ row }">{{ durationText(row) }}</template>
          <template #status="{ row }">
            <BaseTag v-if="row.status" :tone="row.status === 'fail' ? 'up' : 'flat'">
              {{ WEBLOG_STATUS_LABEL[row.status] }}
            </BaseTag>
            <span v-else class="text-text-tertiary">—</span>
          </template>
          <template #expanded="{ row }">
            <div class="space-y-2 text-xs">
              <div class="flex flex-wrap gap-x-6 gap-y-1 text-text-tertiary">
                <span>动作标识 {{ row.action }}</span>
                <span>链路 {{ row.traceId ?? "—" }}</span>
                <span>会话 {{ row.sessionId ?? "—" }}</span>
                <span>系统 {{ row.osName ?? "—" }}</span>
              </div>
              <p v-if="row.detail" class="break-all text-text-secondary">
                详情：{{ row.detail }}
              </p>
            </div>
          </template>
        </BaseTable>
        <BaseEmpty v-else :text="loading ? '正在加载日志...' : '该时间范围内没有行为记录'" />
      </template>

      <p class="mt-2 text-xs text-text-tertiary">
        时间格式 {{ WEBLOG_TIME_FORMAT }}；页面每 10 秒自动刷新一次，行首箭头展开可看完整堆栈、链路号与运行环境
      </p>
    </BaseCard>

    <BaseConfirmModal
      v-model:open="clearModalOpen"
      title="清空日志"
      ok-text="确认清空"
      cancel-text="取消"
      @ok="onConfirmClear"
    >
      <p class="text-sm text-text">将删除全部报错日志与行为日志（含内存缓冲），此操作不可撤销。</p>
    </BaseConfirmModal>
  </div>
</template>

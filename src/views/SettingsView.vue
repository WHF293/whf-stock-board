<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { VueDraggable } from "vue-draggable-plus";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseConfirmModal from "../components/ui/BaseConfirmModal.vue";
import BaseSwitch from "../components/ui/BaseSwitch.vue";
import BaseTable from "../components/ui/BaseTable.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import NoticeBar from "../components/ui/NoticeBar.vue";
import BaseTag from "../components/ui/BaseTag.vue";
import FirstRunSetupModal from "../components/business/FirstRunSetupModal.vue";
import DataExportModal from "../components/business/DataExportModal.vue";
import DataImportModal from "../components/business/DataImportModal.vue";
import { isDataPortAvailable } from "../api/data-port.api";
import { isAutoStartEnabled } from "../api/autostart.api";
import { pluginKernel } from "../plugin";
import { sdk } from "../api/sdk";
import { MENU_DEFAULT_ORDER, MENU_ITEMS, ROUTE_PATH } from "../constants/router-meta.constants";
import { HEADER_DEFAULT_ORDER, HOST_HEADER_ITEMS } from "../constants/header.constants";
import { STOCK_PROXY_PATH } from "../constants/proxy.constants";
import {
  POLLING_INTERVAL,
  REFRESH_INTERVAL_OPTIONS,
} from "../constants/polling.constants";
import type { TableColumn } from "../types/table.types";
import { WEBLOG_RETENTION_DAYS } from "../constants/weblog.constants";
import { APP_VERSION, PLUGIN_REPO_URL, REPO_URL } from "../constants/app-info.constants";
import { getCurrentAppVersion } from "../api/app-update.api";
import { useAppUpdate } from "../composables/use-app-update";
import type { AppUpdateStatus } from "../types/app-update.types";
import type { WeblogActionKey } from "../weblog/weblogActions.enum";
import { useSettingsStore } from "../stores/settings";
import { setWeblogEnabled, trackAction } from "../weblog";
import {
  DATA_SOURCE_LABEL,
  DATA_SOURCE_URL,
} from "@/constants/data-source.constants";

/**
 * 设置页：轮询规则公告 + 数据来源 + 代理自检 + 轮询总开关 + 刷新间隔 + 主题配置 + 系统日志 + 缓存管理
 * （偏好 localStorage 持久化）
 */

/**
 * 页面事件
 * - close：请求关闭所在抽屉（设置页嵌在 MainLayout 的右侧抽屉里，
 *   跳转到系统日志等独立页面时需先收起抽屉）
 */
const emit = defineEmits<{
  close: [];
}>();

/** 路由（设置抽屉内跳转独立页面用） */
const router = useRouter();

/** 轮询规则公告文案（与 use-polling 交易窗口治理逻辑一致） */
const POLLING_RULE_NOTICE =
  "行情自动刷新仅在交易时段内按所选间隔轮询：A 股为交易日 09:15–15:00，美股为 21:30–24:00 与 00:00–04:00；非交易日与其他时段仅在进入页面时请求一次，不重复轮询。";
const settingsStore = useSettingsStore();

/** 当前刷新间隔的展示标签（如 '5s' / '1min'） */
const activeIntervalLabel = computed(
  () =>
    REFRESH_INTERVAL_OPTIONS.find(
      (option) => option.value === settingsStore.refreshIntervalMs,
    )?.label ?? String(settingsStore.refreshIntervalMs),
);

/** 清空 stock-sdk 实例级缓存（代码表 / 交易日历 / 板块映射） */
const onClearCaches = (): void => {
  sdk.clearCaches();
  window.alert("SDK 缓存已清空，下次请求将重新拉取");
};

// ---------- 主题设置（外观） ----------

/** 主题设置弹窗显隐（复用首次启动引导版式；mode=settings 只换文案，不写「引导已完成」标记） */
const themeSetupOpen = ref(false);

// ---------- 侧栏导航顺序编排 ----------

/** 编排弹窗显隐 */
const menuOrderModalOpen = ref(false);

// ---------- 插件管理 ----------

// 插件的安装 / 启停 / 卸载 / 设置入口统一在「插件工坊」页（PluginLabView），
// 设置页不再重复承载（含任务栏盯盘小组件的配置项，随插件自带的设置面板走）。

/** 编排弹窗里单条菜单的草稿形态（插件来源的项带标记，显隐开关跟着走） */
interface MenuOrderDraftItem {
  /** 路由 path */
  path: string;
  /** 菜单标题 */
  title: string;
  /** 图标 key */
  icon: string;
  /** 是否插件贡献的菜单 */
  plugin: boolean;
  /** 是否在侧栏显示 */
  visible: boolean;
}

/** 编排草稿（打开弹窗时按当前顺序初始化；未点「确认」前仅本地改动，不落盘） */
const menuOrderDraft = ref<MenuOrderDraftItem[]>([]);

/**
 * 全部可编排的菜单项（宿主 + 已挂载插件贡献的），按当前持久化顺序排好
 *
 * 插件菜单订阅内核版本号实时刷新；未在顺序里的新页面（升级新增 / 新装插件）追加末尾。
 * @returns 有序菜单项（path / title / icon / plugin 标记）
 */
const orderedMenuItems = computed<MenuOrderDraftItem[]>(() => {
  void pluginKernel.revision.value;
  const host: MenuOrderDraftItem[] = MENU_ITEMS.map((item) => ({
    path: item.path,
    title: item.title,
    icon: item.icon,
    plugin: false,
    visible: true,
  }));
  const plugin: MenuOrderDraftItem[] = pluginKernel.contributions.menu.items.map(
    (item) => ({
      path: item.path,
      title: item.title,
      icon: item.icon,
      plugin: true,
      visible: true,
    }),
  );
  const byPath = new Map<string, MenuOrderDraftItem>();
  for (const item of [...host, ...plugin]) {
    byPath.set(item.path, item);
  }
  const ordered: MenuOrderDraftItem[] = [];
  for (const path of settingsStore.menuOrder) {
    const item = byPath.get(path);
    if (item) {
      ordered.push(item);
      byPath.delete(path);
    }
  }
  for (const item of [...host, ...plugin]) {
    if (byPath.has(item.path)) ordered.push(item);
  }
  return ordered;
});

/**
 * 默认顺序的草稿（宿主项按 MENU_DEFAULT_ORDER 排、插件项追加末尾，且全部显示）
 *
 * 供弹窗内「恢复默认」使用：只重排草稿，是否落盘仍由「确认」决定。
 */
const defaultMenuDraft = computed<MenuOrderDraftItem[]>(() => {
  const byPath = new Map(orderedMenuItems.value.map((item) => [item.path, item]));
  const ordered: MenuOrderDraftItem[] = [];
  for (const path of MENU_DEFAULT_ORDER) {
    const item = byPath.get(path);
    if (item) {
      ordered.push({ ...item, visible: true });
      byPath.delete(path);
    }
  }
  for (const item of orderedMenuItems.value) {
    if (byPath.has(item.path)) ordered.push({ ...item, visible: true });
  }
  return ordered;
});

/**
 * 草稿是否已是默认（顺序一致 + 全部显示；用于禁用弹窗内「恢复默认」）
 *
 * 逐项比对而非只比宿主项：插件项被拖到中间同样算「已改动」，
 * 否则按钮会被误判为不可用、点了没反应。
 */
const isDefaultMenuDraft = computed(() => {
  const draft = menuOrderDraft.value;
  const target = defaultMenuDraft.value;
  if (draft.length !== target.length) return false;
  return draft.every(
    (item, index) => item.visible && item.path === target[index].path,
  );
});

/** 打开编排弹窗：以当前顺序 + 显隐状态初始化草稿 */
const openMenuOrderModal = (): void => {
  const hidden = new Set(settingsStore.hiddenMenus);
  menuOrderDraft.value = orderedMenuItems.value.map((item) => ({
    ...item,
    visible: !hidden.has(item.path),
  }));
  menuOrderModalOpen.value = true;
};

/** 确认编排：持久化新顺序与显隐集合，侧栏即时刷新（下次进入仍生效） */
const onConfirmMenuOrder = (): void => {
  settingsStore.setMenuOrder(menuOrderDraft.value.map((item) => item.path));
  settingsStore.setHiddenMenus(
    menuOrderDraft.value.filter((item) => !item.visible).map((item) => item.path),
  );
};

/** 恢复默认：仅重排草稿（顺序复原 + 全部页面重新显示），点「确认」才写回 */
const resetMenuOrderDraft = (): void => {
  menuOrderDraft.value = defaultMenuDraft.value.map((item) => ({ ...item }));
};

// ---------- 顶栏工具顺序编排 ----------

/** 编排弹窗显隐 */
const headerOrderModalOpen = ref(false);

/** 编排弹窗里单条顶栏条目的草稿形态（插件来源的项带标记，显隐开关跟着走） */
interface HeaderOrderDraftItem {
  /** 条目键（宿主项 id / 插件条目 `<pluginId>#<id>`） */
  key: string;
  /** 条目名 */
  title: string;
  /** 图标 key */
  icon: string;
  /** 是否插件贡献的条目 */
  plugin: boolean;
  /** 是否在顶栏显示 */
  visible: boolean;
}

/** 编排草稿（打开弹窗时按当前顺序初始化；未点「确认」前仅本地改动，不落盘） */
const headerOrderDraft = ref<HeaderOrderDraftItem[]>([]);

/**
 * 全部可编排的顶栏条目（宿主自带 + 已挂载插件贡献的），按当前持久化顺序排好
 *
 * 与「侧栏导航」同一套口径：插件条目订阅内核版本号实时刷新；未在顺序里的
 * 新条目（升级新增 / 新装插件）追加末尾，保证入口不丢。
 * @returns 有序顶栏条目（key / title / icon / plugin 标记）
 */
const orderedHeaderItems = computed<HeaderOrderDraftItem[]>(() => {
  void pluginKernel.revision.value;
  const host: HeaderOrderDraftItem[] = HOST_HEADER_ITEMS.map((item) => ({
    key: item.id,
    title: item.title,
    icon: item.icon,
    plugin: false,
    visible: true,
  }));
  const plugin: HeaderOrderDraftItem[] = pluginKernel.contributions.header.items.map(
    (item) => ({
      key: item.key,
      title: item.title,
      icon: item.icon,
      plugin: true,
      visible: true,
    }),
  );
  const byKey = new Map<string, HeaderOrderDraftItem>();
  for (const item of [...host, ...plugin]) {
    byKey.set(item.key, item);
  }
  const ordered: HeaderOrderDraftItem[] = [];
  for (const key of settingsStore.headerOrder) {
    const item = byKey.get(key);
    if (item) {
      ordered.push(item);
      byKey.delete(key);
    }
  }
  for (const item of [...host, ...plugin]) {
    if (byKey.has(item.key)) ordered.push(item);
  }
  return ordered;
});

/**
 * 默认顺序的草稿（宿主条目按 HEADER_DEFAULT_ORDER 排、插件条目追加末尾，且全部显示）
 *
 * 供弹窗内「恢复默认」使用：只重排草稿，是否落盘仍由「确认」决定。
 */
const defaultHeaderDraft = computed<HeaderOrderDraftItem[]>(() => {
  const byKey = new Map(orderedHeaderItems.value.map((item) => [item.key, item]));
  const ordered: HeaderOrderDraftItem[] = [];
  for (const key of HEADER_DEFAULT_ORDER) {
    const item = byKey.get(key);
    if (item) {
      ordered.push({ ...item, visible: true });
      byKey.delete(key);
    }
  }
  for (const item of orderedHeaderItems.value) {
    if (byKey.has(item.key)) ordered.push({ ...item, visible: true });
  }
  return ordered;
});

/**
 * 草稿是否已是默认（顺序一致 + 全部显示；用于禁用弹窗内「恢复默认」）
 *
 * 逐项比对而非只比宿主条目：插件条目被拖到中间同样算「已改动」，
 * 否则按钮会被误判为不可用、点了没反应。
 */
const isDefaultHeaderDraft = computed(() => {
  const draft = headerOrderDraft.value;
  const target = defaultHeaderDraft.value;
  if (draft.length !== target.length) return false;
  return draft.every(
    (item, index) => item.visible && item.key === target[index].key,
  );
});

/** 打开编排弹窗：以当前顺序 + 显隐状态初始化草稿 */
const openHeaderOrderModal = (): void => {
  const hidden = new Set(settingsStore.hiddenHeaderItems);
  headerOrderDraft.value = orderedHeaderItems.value.map((item) => ({
    ...item,
    visible: !hidden.has(item.key),
  }));
  headerOrderModalOpen.value = true;
};

/** 确认编排：持久化新顺序与显隐集合，顶栏即时刷新（下次进入仍生效） */
const onConfirmHeaderOrder = (): void => {
  settingsStore.setHeaderOrder(headerOrderDraft.value.map((item) => item.key));
  settingsStore.setHiddenHeaderItems(
    headerOrderDraft.value.filter((item) => !item.visible).map((item) => item.key),
  );
};

/** 恢复默认：仅重排草稿（顺序复原 + 全部条目重新显示），点「确认」才写回 */
const resetHeaderOrderDraft = (): void => {
  headerOrderDraft.value = defaultHeaderDraft.value.map((item) => ({ ...item }));
};

// ---------- 检查更新（与 TitleBar 更新徽标共享同一状态机，见 composables/use-app-update） ----------
const {
  status: updateStatus,
  latestVersion,
  progressPercent,
  lastMessage: updateMessage,
  check: checkUpdate,
  startDownload: startUpdateDownload,
  cancelDownload: cancelUpdateDownload,
  installNow: installUpdateNow,
} = useAppUpdate();

/** 当前运行版本（Tauri 下读 tauri.conf.json 的 version，浏览器端回退 APP_VERSION 常量） */
const currentVersion = ref(APP_VERSION);

/** 检查更新按钮的埋点键（随状态分流：检查 / 下载 / 取消下载 / 安装） */
const UPDATE_TRACK_BY_STATUS: Record<AppUpdateStatus, WeblogActionKey> = {
  idle: "CHECK_UPDATE",
  checking: "CHECK_UPDATE",
  "up-to-date": "CHECK_UPDATE",
  available: "UPDATE_DOWNLOAD",
  downloading: "UPDATE_CANCEL_DOWNLOAD",
  ready: "UPDATE_INSTALL",
  installing: "UPDATE_INSTALL",
};

/** 快捷键说明弹窗 */
const shortcutsModalOpen = ref(false);

/** 数据迁移功能是否可用（SQLite 是 Tauri 专属，浏览器端禁用） */
const dataPortAvailable = isDataPortAvailable();

/** 数据导出弹窗 */
const dataExportOpen = ref(false);

/** 数据导入弹窗 */
const dataImportOpen = ref(false);

/**
 * 快捷键清单（供「快捷键说明」弹窗展示）
 *
 * 全局键在 `layouts/MainLayout.vue` 的 capture 阶段监听；弹窗内键见对应组件
 * （`StockSearchModal` / `BaseConfirmModal` / `DockPanel`）
 */
const SHORTCUTS = [
  {
    key: 'Ctrl + Shift + B',
    action: '收起 / 展开左侧导航栏（仅桌面端生效）',
  },
  { key: 'Shift + Tab', action: '切换页面（按侧栏顺序循环，不含设置页）' },
  { key: 'Ctrl + ↑ / ↓', action: '股票详情页：左侧来源列表内切换上一只 / 下一只（列表仅一只时不动作）' },
  { key: 'Esc', action: '关闭股票详情面板 / 搜索弹窗 / 对话框' },
  { key: '↑ ↓', action: '搜索弹窗内切换标的' },
  { key: 'Enter', action: '搜索弹窗内确认选中标的' },
] as const;

/**
 * 插件命令的快捷键清单（已挂载插件贡献的带快捷键命令）
 *
 * 命令注册表只含当前挂载插件的贡献（禁用即撤销），订阅内核版本号保持同步。
 */
const pluginShortcuts = computed(() => {
  void pluginKernel.revision.value;
  const nameById = new Map(pluginKernel.list().map((info) => [info.id, info.name]));
  return pluginKernel.contributions.commands.commands
    .filter((command) => (command.keys ?? '').length > 0)
    .map((command) => ({
      key: command.keys ?? '',
      action: `${command.title}（插件「${nameById.get(command.pluginId) ?? command.pluginId}」）`,
    }));
});

/** 轮询详情弹窗显隐（「查看轮询详情」按钮） */
const pollingDetailModalOpen = ref(false);

/** 轮询间隔秒数（展示文案用：从常量换算，避免与 polling.constants 双处维护） */
const QUOTES_SEC = POLLING_INTERVAL.QUOTES_INTRADAY / 1000;
const BREADTH_SEC = POLLING_INTERVAL.MARKET_BREADTH / 1000;
const US_SEC = POLLING_INTERVAL.US_BOARDS / 1000;

/** 轮询明细行（弹窗表格展示用） */
interface PollingDetailRow {
  /** 页面 / 位置 */
  page: string;
  /** 轮询内容 */
  target: string;
  /** 间隔下限文案 */
  interval: string;
  /** 交易窗口约束 */
  window: string;
}

/**
 * 轮询任务清单（与各页面 usePolling 调用点一一对应，改轮询时同步维护）
 */
const POLLING_DETAIL_ROWS: PollingDetailRow[] = [
  { page: "市场总览", target: "全球指数报价", interval: `${QUOTES_SEC} 秒`, window: "不限（全天）" },
  { page: "市场总览", target: "指数卡片行情", interval: `${QUOTES_SEC} 秒`, window: "A 股交易时段" },
  { page: "市场总览", target: "市场宽度（全市场快照 / 行业板块 / 资金流）", interval: `${BREADTH_SEC} 秒`, window: "A 股交易时段" },
  { page: "自选股", target: "当前分组自选行情", interval: `${QUOTES_SEC} 秒`, window: "A 股交易时段" },
  { page: "行情全景 · A 股", target: "行业 / 概念板块排行", interval: `${BREADTH_SEC} 秒`, window: "A 股交易时段" },
  { page: "行情全景 · 美股", target: "美股板块行情", interval: `${US_SEC} 秒`, window: "美股交易时段" },
  { page: "资金动向", target: "全市场榜单（涨幅 / 成交额 / 换手率）", interval: `${BREADTH_SEC} 秒`, window: "A 股交易时段" },
  { page: "涨停与异动", target: "涨停池 + 盘口 / 板块异动", interval: `${BREADTH_SEC} 秒`, window: "A 股交易时段" },
  { page: "板块日历", target: "当日数据采集 + 重读", interval: `${BREADTH_SEC} 秒`, window: "A 股交易时段" },
  { page: "个股详情（页面 / 停靠面板）", target: "单票报价", interval: `${QUOTES_SEC} 秒`, window: "A 股交易时段" },
  { page: "侧栏自选面板", target: "自选行情", interval: `${QUOTES_SEC} 秒`, window: "A 股交易时段" },
];

/** 轮询明细表列配置 */
const pollingDetailColumns: TableColumn<PollingDetailRow>[] = [
  { key: "page", label: "页面 / 位置" },
  { key: "target", label: "轮询内容" },
  { key: "interval", label: "间隔下限", align: "right" },
  { key: "window", label: "交易窗口" },
];

/**
 * 轮询明细行 key（页面 + 内容唯一）
 * @param row 轮询明细行
 * @returns 行 key
 */
const pollingDetailRowKey = (row: PollingDetailRow): string => `${row.page}|${row.target}`;

/**
 * 更新按钮文案（随共享状态机变化；idle 也提示可再次检查）
 */
const updateButtonText = computed(() => {
  switch (updateStatus.value) {
    case "checking":
      return "检查中...";
    case "up-to-date":
      return "已是最新，再查一次";
    case "available":
      return `发现新版 v${latestVersion.value}，点击下载`;
    case "downloading":
      return `取消下载（${progressPercent.value}%）`;
    case "ready":
      return "立即更新";
    case "installing":
      return "更新中...";
    default:
      return "检查更新";
  }
});

/**
 * 更新按钮点击（按状态机状态分流）
 */
const onUpdateAction = (): void => {
  if (updateStatus.value === "downloading") {
    cancelUpdateDownload();
    return;
  }
  if (updateStatus.value === "available") {
    void startUpdateDownload();
    return;
  }
  if (updateStatus.value === "ready") {
    void installUpdateNow();
    return;
  }
  if (updateStatus.value !== "checking" && updateStatus.value !== "installing") {
    void checkUpdate(false);
  }
};

onMounted(() => {
  void getCurrentAppVersion().then((version) => {
    currentVersion.value = version;
  });
  // 校准「开机自动启动」开关显示：注册表是事实源，用户可能在任务管理器里手动改过；
  // 直接写 store 字段（不经 action），避免校准触发 enable / disable 回写
  void isAutoStartEnabled().then((enabled) => {
    settingsStore.launchAtStartup = enabled;
  });
});

/** 仓库地址展示文案（去掉协议头，短一些不挤行） */
const repoDisplayUrl = computed(() => REPO_URL.replace(/^https?:\/\//, ""));

/** 插件仓库地址展示文案（同上去协议头） */
const pluginRepoDisplayUrl = computed(() => PLUGIN_REPO_URL.replace(/^https?:\/\//, ""));

/** 「打开」仓库：与「前往下载」同口径开新窗口（不再用裸 <a>，按钮风格与同卡片其他按钮统一） */
const onOpenRepo = (): void => {
  window.open(REPO_URL, "_blank", "noopener");
};

/** 「打开」插件仓库（同 onOpenRepo 口径） */
const onOpenPluginRepo = (): void => {
  window.open(PLUGIN_REPO_URL, "_blank", "noopener");
};

/** 自检探测地址：腾讯指数轻量行情（与真实数据链路一致，走同源代理） */
const PROBE_TARGET_URL = "https://qt.gtimg.cn/q=sh000001";

/** 自检状态：idle 未检测 / running 检测中 / ok 通畅 / fail 失败 */
type ProbeStatus = "idle" | "running" | "ok" | "fail";

/** 代理自检状态 */
const probeStatus = ref<ProbeStatus>("idle");

/** 自检耗时（毫秒） */
const probeCostMs = ref<number | null>(null);

/** 自检失败原因 */
const probeError = ref<string | null>(null);

/** 自检按钮文案 */
const probeButtonText = computed(() =>
  probeStatus.value === "running" ? "检测中..." : "代理自检",
);

/** 自检结果提示（Tag 文案） */
const probeResultText = computed(() => {
  if (probeStatus.value === "ok") {
    return `通畅 · ${probeCostMs.value ?? 0}ms`;
  }
  if (probeStatus.value === "fail") {
    return `失败 · ${probeError.value ?? "未知错误"}`;
  }
  return "";
});

// ---------- 系统日志 ----------

/** 日志保留天数文案（与 WEBLOG_RETENTION_DAYS 同源，改常量即同步） */
const weblogRetentionText = `本地保留最近 ${WEBLOG_RETENTION_DAYS} 天，超期自动清理`;

/**
 * 切换日志采集开关：写持久化 + 同步运行期采集开关 + 记一条系统事件
 * （系统类事件不受开关影响，关掉也能看到「谁关的」）
 * @param enabled 是否开启采集
 */
const onToggleWeblog = (enabled: boolean): void => {
  settingsStore.setWeblogEnabled(enabled);
  setWeblogEnabled(enabled);
  trackAction("LOG_ENABLED_TOGGLE", { target: enabled ? "开启" : "关闭" });
};

/** 进入系统日志页：先收起设置抽屉再跳转，避免抽屉盖住页面 */
const onOpenSystemLog = (): void => {
  trackAction("NAV_SYSTEM_LOG_OPEN", { target: ROUTE_PATH.SYSTEM_LOG });
  emit("close");
  void router.push(ROUTE_PATH.SYSTEM_LOG);
};

/**
 * 代理连通性自检：经同源 /stock-proxy 请求一次轻量行情，
 * 展示成功耗时或失败原因（用户手动触发，不参与轮询）
 */
const onProbeProxy = async (): Promise<void> => {
  if (probeStatus.value === "running") {
    return;
  }
  probeStatus.value = "running";
  probeError.value = null;
  const startedAt = performance.now();
  try {
    const response = await fetch(
      `${STOCK_PROXY_PATH}?u=${encodeURIComponent(PROBE_TARGET_URL)}`,
    );
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    await response.text();
    probeCostMs.value = Math.round(performance.now() - startedAt);
    probeStatus.value = "ok";
  } catch (error) {
    probeError.value = error instanceof Error ? error.message : String(error);
    probeStatus.value = "fail";
  }
};
</script>

<template>
  <div class="space-y-4">
    <NoticeBar :text="POLLING_RULE_NOTICE" />
    <BaseCard title="数据获取">
      <a
        :href="DATA_SOURCE_URL"
        target="_blank"
        rel="noreferrer"
        class="pressable mb-2 block text-sm font-medium text-primary hover:opacity-80"
        title="数据来源：stock-sdk"
      >
        数据来源：{{ DATA_SOURCE_LABEL }}
      </a>
      <!-- 代理连通性自检：手动触发一次轻量请求 -->
      <div class="flex items-center justify-between gap-4">
        <p class="text-xs text-text-tertiary">
          检测同源代理到上游数据源的连通性（手动触发一次轻量请求）
        </p>
        <BaseButton
          variant="ghost"
          :disabled="probeStatus === 'running'"
          data-track="PROXY_PROBE"
          @click="onProbeProxy"
        >
          {{ probeButtonText }}
        </BaseButton>
      </div>
      <p v-if="probeResultText" class="mt-2">
        <BaseTag :tone="probeStatus === 'ok' ? 'primary' : 'flat'">
          {{ probeResultText }}
        </BaseTag>
      </p>
      <p class="my-2 text-sm text-text">缓存管理</p>
      <div class="flex items-center justify-between gap-4">
        <p class="text-xs text-text-tertiary">
          清空代码表 / 交易日历 / 板块映射等实例级缓存
        </p>
        <BaseButton variant="ghost" data-track="SDK_CACHE_CLEAR" @click="onClearCaches">
          清空 SDK 缓存
        </BaseButton>
      </div>
    </BaseCard>
    <BaseCard title="轮询">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-text">行情自动刷新</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            关闭后所有页面暂停轮询，手动刷新浏览器仍可拉取
          </p>
        </div>
        <BaseSwitch
          :model-value="settingsStore.pollingEnabled"
          data-track="POLLING_TOGGLE"
          @update:model-value="settingsStore.setPollingEnabled"
        />
      </div>

      <!-- 刷新间隔：仅在轮询开启时展示 -->
      <div
        v-if="settingsStore.pollingEnabled"
        class="mt-4 border-t border-flat-weak pt-4"
      >
        <div class="flex items-center justify-between gap-4">
          <div>
            <p class="text-sm text-text">刷新间隔</p>
            <p class="mt-0.5 text-xs text-text-tertiary">
              行情类数据按此间隔轮询；重数据（全市场快照等）保持不低于 30
              秒的克制档
            </p>
          </div>
          <BaseTag tone="primary">{{ activeIntervalLabel }}</BaseTag>
        </div>
        <div
          class="mt-3 flex flex-wrap gap-1.5"
          role="radiogroup"
          aria-label="刷新间隔"
        >
          <button
            v-for="option in REFRESH_INTERVAL_OPTIONS"
            :key="option.value"
            type="button"
            role="radio"
            :aria-checked="settingsStore.refreshIntervalMs === option.value"
            data-track="REFRESH_INTERVAL_CHANGE"
            :data-track-detail="option.label"
            class="pressable rounded-lg px-2.5 py-1 text-xs font-medium active:scale-90"
            :class="
              settingsStore.refreshIntervalMs === option.value
                ? 'bg-primary text-on-primary'
                : 'bg-flat-weak text-text-secondary hover:text-text'
            "
            @click="settingsStore.setRefreshIntervalMs(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div class="mt-3 flex items-center justify-between">
        <BaseTag :tone="settingsStore.pollingEnabled ? 'primary' : 'flat'">
          {{ settingsStore.pollingEnabled ? "轮询已开启" : "轮询已暂停" }}
        </BaseTag>
        <BaseButton
          variant="ghost"
          data-track="POLLING_DETAIL_VIEW"
          @click="pollingDetailModalOpen = true"
        >
          查看轮询详情
        </BaseButton>
      </div>
    </BaseCard>

    <!-- 外观：选项收进「主题设置」弹窗（与首次启动引导同一组件，避免两处各维护一份选项） -->
    <BaseCard title="外观">
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm text-text">界面外观</p>
          <p class="mt-0.5 text-xs leading-relaxed text-text-tertiary">
            明暗模式、系统主题色与涨跌配色，统一在主题设置里调整
          </p>
        </div>
        <BaseButton
          variant="ghost"
          data-track="THEME_SETUP_OPEN"
          @click="themeSetupOpen = true"
        >
          主题设置
        </BaseButton>
      </div>
    </BaseCard>


    <!-- 窗口 & 托盘开关（仅桌面端生效） -->
    <BaseCard title="窗口 & 托盘">
      <div class="flex items-center justify-between gap-4 border-b border-flat-weak pb-4">
        <div>
          <p class="text-sm text-text">关闭按钮最小化到托盘</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            开启后点击标题栏 ×（或 Alt+F4）仅隐藏到系统托盘，托盘菜单「退出」才是真正关闭；关闭后点击关闭直接退出应用
          </p>
        </div>
        <BaseSwitch
          :model-value="settingsStore.closeToTray"
          data-track="CLOSE_TO_TRAY_TOGGLE"
          @update:model-value="settingsStore.setCloseToTray"
        />
      </div>
      <div class="flex items-center justify-between gap-4 pt-4">
        <div>
          <p class="text-sm text-text">开机自动启动</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            开启后随当前用户登录自动启动应用（写入系统启动项，可在任务管理器「启动应用」里查看或关闭）；默认关闭
          </p>
        </div>
        <BaseSwitch
          :model-value="settingsStore.launchAtStartup"
          data-track="LAUNCH_AT_STARTUP_TOGGLE"
          @update:model-value="settingsStore.setLaunchAtStartup"
        />
      </div>
    </BaseCard>

    <!-- 任务栏盯盘小组件：配置入口随 dsh-watch-widget 插件自带的设置面板走，见插件工坊 -->

    <!-- 水印开关 + 快捷键说明（合并一卡） -->
    <BaseCard title="水印 & 快捷键">
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm text-text">全局水印</p>
            <p class="mt-0.5 text-xs text-text-tertiary">
              斜向平铺展示「数据仅供个人学习参考」，覆盖全部页面
            </p>
          </div>
          <BaseSwitch
            :model-value="settingsStore.watermarkEnabled"
            data-track="WATERMARK_TOGGLE"
            @update:model-value="settingsStore.setWatermarkEnabled"
          />
        </div>
        <div class="flex items-center justify-between border-t border-flat-weak pt-4">
          <div>
            <p class="text-sm text-text">快捷键说明</p>
            <p class="mt-0.5 text-xs text-text-tertiary">查看当前软件支持的快捷操作</p>
          </div>
          <BaseButton variant="ghost" data-track="SHORTCUTS_VIEW" @click="shortcutsModalOpen = true">查看</BaseButton>
        </div>
      </div>
    </BaseCard>

    <!-- 布局编排：侧栏导航 + 顶栏工具合并一卡（均为拖拽顺序 + 显隐控制） -->
    <BaseCard title="布局编排">
      <div class="mb-4 flex items-center justify-between gap-4">
        <div>
          <p class="text-sm text-text">路由顺序编排</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            拖拽调整左侧导航顺序（含插件菜单），并可控制各页面是否显示；弹窗内可一键恢复默认
          </p>
        </div>
        <BaseButton variant="ghost" data-track="MENU_ORDER_EDIT" @click="openMenuOrderModal">编排</BaseButton>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm text-text">右上角工具编排</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            拖拽调整顶栏条目顺序（含插件条目），并可控制各条目是否显示；弹窗内可一键恢复默认。
            「Agent 分析」开关同时控制各页面的 AI 分析按钮（热点新闻 / 个股详情）
          </p>
        </div>
        <BaseButton variant="ghost" data-track="HEADER_ORDER_EDIT" @click="openHeaderOrderModal">
          编排
        </BaseButton>
      </div>
    </BaseCard>

    <!-- 插件的安装 / 启停 / 卸载统一在侧栏「插件工坊」页，设置页不再放入口 -->

    <!-- 系统日志：采集开关 + 进入日志页（报错 / 行为两页签表格） -->
    <BaseCard title="系统日志">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-text">日志采集</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            记录报错与操作行为（页面显示、按钮点击、接口请求），{{ weblogRetentionText }}
          </p>
        </div>
        <!-- 埋点由 onToggleWeblog 显式上报（带开启/关闭详情），此处不再标 data-track 以免重复 -->
        <BaseSwitch
          :model-value="settingsStore.weblogEnabled"
          @update:model-value="onToggleWeblog"
        />
      </div>
      <div class="mt-4 flex items-center justify-between gap-4 border-t border-flat-weak pt-4">
        <div>
          <p class="text-sm text-text">查看系统日志</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            报错日志 / 行为日志两个页签，支持按时间、分类、关键字筛选与导出
          </p>
        </div>
        <!-- 埋点由 onOpenSystemLog 显式上报（需先关抽屉再跳转），此处不再标 data-track -->
        <BaseButton variant="ghost" @click="onOpenSystemLog">
          查看
        </BaseButton>
      </div>
    </BaseCard>

    <!-- 数据迁移：导出 / 导入本地数据（换机迁移，仅桌面端） -->
    <BaseCard title="数据迁移">
      <div class="flex items-center justify-between gap-4 border-b border-flat-weak pb-4">
        <div>
          <p class="text-sm text-text">导出数据</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            按类别勾选自选股 / 账户 / 设置等本地数据，导出为单个 JSON 文件备份或换机
          </p>
        </div>
        <BaseButton
          variant="ghost"
          data-track="DATA_EXPORT_OPEN"
          :disabled="!dataPortAvailable"
          @click="dataExportOpen = true"
        >
          导出
        </BaseButton>
      </div>
      <div class="flex items-center justify-between gap-4 pt-4">
        <div>
          <p class="text-sm text-text">导入数据</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            {{ dataPortAvailable ? "从导出文件恢复，覆盖前自动备份并需二次确认" : "仅桌面端可用（浏览器端无本地数据库）" }}
          </p>
        </div>
        <BaseButton
          variant="ghost"
          :disabled="!dataPortAvailable"
          @click="dataImportOpen = true"
        >
          导入
        </BaseButton>
      </div>
    </BaseCard>

    <BaseCard title="系统">
      <div class="mb-4 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm text-text">GitHub 仓库</p>
          <p class="mt-0.5 truncate text-xs text-text-tertiary">
            {{ repoDisplayUrl }}
          </p>
        </div>
        <BaseButton
          variant="ghost"
          data-track="REPO_OPEN"
          @click="onOpenRepo"
        >
          打开
        </BaseButton>
      </div>
      <div class="mb-4 flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm text-text">插件仓库</p>
          <p class="mt-0.5 truncate text-xs text-text-tertiary">
            {{ pluginRepoDisplayUrl }}
          </p>
        </div>
        <BaseButton
          variant="ghost"
          @click="onOpenPluginRepo"
        >
          打开
        </BaseButton>
      </div>
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm text-text">
            当前版本 v{{ currentVersion }}
            <BaseTag
              v-if="updateStatus === 'up-to-date'"
              tone="primary"
              class="ml-1"
            >
              已是最新
            </BaseTag>
          </p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            启动时自动检查更新；发现新版可在标题栏徽标或此处直接下载安装
          </p>
          <p v-if="updateMessage" class="mt-0.5 text-xs text-text-tertiary">
            {{ updateMessage }}
          </p>
        </div>
        <BaseButton
          variant="ghost"
          :disabled="updateStatus === 'checking' || updateStatus === 'installing'"
          :data-track="UPDATE_TRACK_BY_STATUS[updateStatus]"
          @click="onUpdateAction"
        >
          {{ updateButtonText }}
        </BaseButton>
      </div>
    </BaseCard>

    <!-- 快捷键说明弹窗 -->
    <DataExportModal v-model:open="dataExportOpen" />
    <DataImportModal v-model:open="dataImportOpen" />

    <BaseConfirmModal
      v-model:open="shortcutsModalOpen"
      title="快捷键说明"
      ok-text="知道了"
      cancel-text=""
    >
      <ul class="space-y-3">
        <li
          v-for="shortcut in SHORTCUTS"
          :key="shortcut.key"
          class="flex items-center gap-3"
        >
          <kbd class="min-w-[80px] shrink-0 rounded-md border border-flat-weak bg-flat-weak px-2.5 py-1 text-center text-xs font-semibold text-text tabular-nums">
            {{ shortcut.key }}
          </kbd>
          <span class="text-sm text-text-secondary">{{ shortcut.action }}</span>
        </li>
      </ul>
      <div v-if="pluginShortcuts.length > 0" class="mt-4 border-t border-flat-weak pt-4">
        <p class="mb-3 text-xs font-medium text-text-tertiary">
          插件命令（随插件启停自动增删，可在「设置 → 插件」里关闭）
        </p>
        <ul class="space-y-3">
          <li
            v-for="shortcut in pluginShortcuts"
            :key="`plugin-${shortcut.key}`"
            class="flex items-center gap-3"
          >
            <kbd class="min-w-[80px] shrink-0 rounded-md border border-flat-weak bg-flat-weak px-2.5 py-1 text-center text-xs font-semibold text-text tabular-nums">
              {{ shortcut.key }}
            </kbd>
            <span class="text-sm text-text-secondary">{{ shortcut.action }}</span>
          </li>
        </ul>
      </div>
    </BaseConfirmModal>

    <!-- 轮询详情弹窗：各页面轮询任务清单 -->
    <BaseConfirmModal
      v-model:open="pollingDetailModalOpen"
      title="轮询详情"
      ok-text="知道了"
      cancel-text=""
      max-width-class="max-w-2xl"
    >
      <BaseTable
        :columns="pollingDetailColumns"
        :rows="POLLING_DETAIL_ROWS"
        :row-key="pollingDetailRowKey"
        min-width="560px"
      />
      <p class="mt-3 text-xs leading-5 text-text-tertiary">
        实际刷新间隔 = max（上方设置的刷新间隔，各任务的间隔下限）。页面隐藏或切走时暂停，恢复可见立即补刷；请求失败按指数退避（2s 起、封顶 60s），成功后恢复。系统日志页的 10 秒自动刷新为独立定时器，不受「行情自动刷新」总开关管理。
      </p>
    </BaseConfirmModal>

    <!-- 插件安装弹窗与插件启停 / 卸载统一在「插件工坊」页承载，设置页不再重复 -->

    <!-- 路由顺序编排弹窗：拖拽调整侧栏顺序，确认后持久化并即时生效 -->
    <BaseConfirmModal
      v-model:open="menuOrderModalOpen"
      title="路由顺序编排"
      ok-text="确认"
      cancel-text="取消"
      max-width-class="max-w-md"
      @ok="onConfirmMenuOrder"
    >
      <p class="mb-3 text-xs text-text-tertiary">
        拖拽调整顺序；开关控制该页是否显示在左侧栏（隐藏后路由仍可达）。「恢复默认」复原默认顺序并重新显示全部页面，点「确认」保存并立即刷新侧栏
      </p>
      <VueDraggable
        v-model="menuOrderDraft"
        tag="ul"
        :animation="150"
        handle=".draft-handle"
        :force-fallback="true"
        fallback-class="sortable-fallback bg-surface shadow-lg ring-1 ring-flat-weak"
        ghost-class="opacity-40"
        chosen-class="bg-flat-weak"
        class="space-y-1"
      >
        <li
          v-for="item in menuOrderDraft"
          :key="item.path"
          class="flex select-none items-center gap-3 rounded-lg border border-flat-weak px-3 py-2.5 text-sm text-text-secondary"
          :class="item.visible ? '' : 'opacity-55'"
        >
          <MenuIcon
            name="grip"
            :size="16"
            class="draft-handle cursor-grab text-text-tertiary active:cursor-grabbing"
          />
          <MenuIcon :name="item.icon" :size="16" class="text-text-tertiary" />
          <span class="text-text">{{ item.title }}</span>
          <BaseTag v-if="item.plugin" tone="flat">插件</BaseTag>
          <BaseSwitch
            v-model="item.visible"
            class="ml-auto shrink-0"
            data-track="MENU_VISIBILITY_TOGGLE"
            :aria-label="`在侧栏显示${item.title}`"
          />
        </li>
      </VueDraggable>
      <template #footer-extra>
        <BaseButton
          variant="ghost"
          :disabled="isDefaultMenuDraft"
          data-track="MENU_ORDER_RESET"
          @click="resetMenuOrderDraft"
        >
          恢复默认
        </BaseButton>
      </template>
    </BaseConfirmModal>
    <!-- 顶栏工具编排弹窗：拖拽调整顺序，确认后持久化并即时生效 -->
    <BaseConfirmModal
      v-model:open="headerOrderModalOpen"
      title="顶栏工具编排"
      ok-text="确认"
      cancel-text="取消"
      max-width-class="max-w-md"
      @ok="onConfirmHeaderOrder"
    >
      <p class="mb-3 text-xs text-text-tertiary">
        拖拽调整顺序（从右到左依次排列）；开关控制该条目是否显示在顶栏。「恢复默认」复原默认顺序并重新显示全部条目，点「确认」保存并立即生效
      </p>
      <VueDraggable
        v-model="headerOrderDraft"
        tag="ul"
        :animation="150"
        handle=".header-order-handle"
        :force-fallback="true"
        fallback-class="sortable-fallback bg-surface shadow-lg ring-1 ring-flat-weak"
        ghost-class="opacity-40"
        chosen-class="bg-flat-weak"
        class="space-y-1"
      >
        <li
          v-for="item in headerOrderDraft"
          :key="item.key"
          class="flex select-none items-center gap-3 rounded-lg border border-flat-weak px-3 py-2.5 text-sm text-text-secondary"
          :class="item.visible ? '' : 'opacity-55'"
        >
          <MenuIcon
            name="grip"
            :size="16"
            class="header-order-handle cursor-grab text-text-tertiary active:cursor-grabbing"
          />
          <MenuIcon :name="item.icon" :size="16" class="text-text-tertiary" />
          <span class="text-text">{{ item.title }}</span>
          <BaseTag v-if="item.plugin" tone="flat">插件</BaseTag>
          <BaseSwitch
            v-model="item.visible"
            class="ml-auto shrink-0"
            data-track="HEADER_VISIBILITY_TOGGLE"
            :aria-label="`在顶栏显示${item.title}`"
          />
        </li>
      </VueDraggable>
      <template #footer-extra>
        <BaseButton
          variant="ghost"
          :disabled="isDefaultHeaderDraft"
          data-track="HEADER_ORDER_RESET"
          @click="resetHeaderOrderDraft"
        >
          恢复默认
        </BaseButton>
      </template>
    </BaseConfirmModal>

    <!-- 主题设置弹窗：复用首次启动引导版式，从「外观」卡片手动唤起
         （纯受控组件，关闭时不会改动 settings.setupCompleted） -->
    <FirstRunSetupModal v-model:open="themeSetupOpen" mode="settings" />
  </div>
</template>

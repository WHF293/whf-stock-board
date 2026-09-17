<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { VueDraggable } from "vue-draggable-plus";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseConfirmModal from "../components/ui/BaseConfirmModal.vue";
import BaseSwitch from "../components/ui/BaseSwitch.vue";
import MenuIcon from "../components/ui/MenuIcon.vue";
import NoticeBar from "../components/ui/NoticeBar.vue";
import BaseTag from "../components/ui/BaseTag.vue";
import PluginManageModal from "../components/plugin/PluginManageModal.vue";
import PluginInstallModal from "../components/plugin/PluginInstallModal.vue";
import { pluginKernel } from "../plugin";
import { usePlugins } from "../composables/use-plugins";
import { sdk } from "../api/sdk";
import { MENU_DEFAULT_ORDER, MENU_ITEMS, ROUTE_PATH } from "../constants/router-meta.constants";
import { HEADER_DEFAULT_ORDER, HOST_HEADER_ITEMS } from "../constants/header.constants";
import { STOCK_PROXY_PATH } from "../constants/proxy.constants";
import { REFRESH_INTERVAL_OPTIONS } from "../constants/polling.constants";
import { THEME_COLOR_OPTIONS } from "../constants/theme-color.constants";
import { TREND_THEME_OPTIONS } from "../constants/trend-theme.constants";
import { WEBLOG_RETENTION_DAYS } from "../constants/weblog.constants";
import {
  APP_VERSION,
  CHECK_UPDATE_TIMEOUT_MS,
  RELEASES_LATEST_API,
  RELEASES_URL,
  REPO_URL,
} from "../constants/app-info.constants";
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

// ---------- 侧栏导航顺序编排 ----------

/** 编排弹窗显隐 */
const menuOrderModalOpen = ref(false);

// ---------- 插件管理 ----------

/** 插件管理弹窗显隐 */
const pluginModalOpen = ref(false);

/** 插件安装弹窗显隐（应用内安装用户插件） */
const pluginInstallModalOpen = ref(false);

/** 插件清单与已挂载数量（内核状态变化后自动刷新） */
const { plugins: pluginList, mountedCount } = usePlugins();

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

/** 宿主菜单的 path 集合（区分默认顺序比较口径用） */
const HOST_MENU_PATHS: ReadonlySet<string> = new Set(
  MENU_ITEMS.map((item) => item.path as string),
);

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
 * 当前宿主菜单顺序是否为默认（插件菜单不参与比较；用于禁用「重置」按钮）
 *
 * 显隐集合也要算进来：「重置」承诺「重新显示全部页面」，若只隐藏了页面
 * （顺序未动）也必须允许一键恢复，否则按钮禁用与文案自相矛盾。
 */
const isDefaultMenuOrder = computed(
  () =>
    settingsStore.hiddenMenus.length === 0 &&
    settingsStore.menuOrder
      .filter((path) => HOST_MENU_PATHS.has(path))
      .join(",") === MENU_DEFAULT_ORDER.join(","),
);

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

/** 重置侧栏：顺序恢复默认 + 全部页面重新显示 */
const onResetMenuOrder = (): void => {
  settingsStore.resetMenuOrder();
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

/** 宿主自带顶栏条目的键集合（区分默认顺序比较口径用） */
const HOST_HEADER_KEYS: ReadonlySet<string> = new Set(
  HOST_HEADER_ITEMS.map((item) => item.id),
);

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
 * 当前顶栏顺序是否为默认（插件条目不参与比较；用于禁用「重置」按钮）
 *
 * 显隐集合也要算进来：「重置」承诺「重新显示全部条目」，若只隐藏了条目
 * （顺序未动）也必须允许一键恢复，否则按钮禁用与文案自相矛盾。
 */
const isDefaultHeaderOrder = computed(
  () =>
    settingsStore.hiddenHeaderItems.length === 0 &&
    settingsStore.headerOrder
      .filter((key) => HOST_HEADER_KEYS.has(key))
      .join(",") === HEADER_DEFAULT_ORDER.join(","),
);

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

/** 重置顶栏：顺序恢复默认 + 全部条目重新显示 */
const onResetHeaderOrder = (): void => {
  settingsStore.resetHeaderOrder();
};

// ---------- 检查更新 ----------
/** 检查状态：idle 未检查 / checking 检查中 / latest 已是最新 / newer 发现新版 / fail 失败 */
type UpdateStatus = "idle" | "checking" | "latest" | "newer" | "fail";

/** 检查更新状态 */
const updateStatus = ref<UpdateStatus>("idle");

/** 最新版本号（去掉 tag 前缀 v） */
const latestVersion = ref<string>("");

/** 快捷键说明弹窗 */
const shortcutsModalOpen = ref(false);

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

/** 新版弹窗显隐 */
const updateModalOpen = ref(false);

/**
 * 解析版本号为可比较的数字数组（'v0.1.5' -> [0, 1, 5]，缺位补 0）
 * @param tag 版本 tag 或纯版本号
 * @returns 数字数组（长度 3）
 */
const parseVersion = (tag: string): number[] =>
  tag
    .replace(/^v/i, "")
    .split(".")
    .map((part) => Number.parseInt(part, 10) || 0)
    .concat([0, 0, 0])
    .slice(0, 3);

/**
 * 检查更新：请求 GitHub Releases 最新版，与当前版本比较
 * （api.github.com 免鉴权且 CORS 允许任意来源，浏览器 / Tauri 均可直连）
 */
const onCheckUpdate = async (): Promise<void> => {
  updateStatus.value = "checking";
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(
      () => controller.abort(),
      CHECK_UPDATE_TIMEOUT_MS,
    );
    const response = await fetch(RELEASES_LATEST_API, {
      signal: controller.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    window.clearTimeout(timer);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const release = (await response.json()) as { tag_name?: string };
    const tag = release.tag_name ?? "";
    if (!tag) throw new Error("响应缺少 tag_name");

    latestVersion.value = tag.replace(/^v/i, "");
    const current = parseVersion(APP_VERSION);
    const latest = parseVersion(tag);
    const hasNewer =
      latest[0] !== current[0] ||
      latest[1] !== current[1] ||
      latest[2] !== current[2];
    // 仅当远端严格更新时弹窗，本地更高（未发布）视为最新
    updateStatus.value = hasNewer ? "newer" : "latest";
    if (hasNewer) {
      updateModalOpen.value = true;
    }
  } catch (error) {
    updateStatus.value = "fail";
    console.error("[settings] check-update", error);
  }
};

/** 检查按钮文案（随状态变化） */
const updateButtonText = computed(() => {
  if (updateStatus.value === "checking") return "检查中...";
  if (updateStatus.value === "latest") return "已是最新";
  if (updateStatus.value === "fail") return "检查失败，点击重试";
  return "检查更新";
});

/** 弹窗「前往下载」：打开 Releases 页 */
const onGoDownload = (): void => {
  window.open(RELEASES_URL, "_blank", "noopener");
};

/** 仓库地址展示文案（去掉协议头，短一些不挤行） */
const repoDisplayUrl = computed(() => REPO_URL.replace(/^https?:\/\//, ""));

/** 「打开」仓库：与「前往下载」同口径开新窗口（不再用裸 <a>，按钮风格与同卡片其他按钮统一） */
const onOpenRepo = (): void => {
  window.open(REPO_URL, "_blank", "noopener");
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
              行情类数据按此间隔轮询；重数据（全市场快照等）保持不低于 1
              分钟的克制档
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
                ? 'bg-primary text-white'
                : 'bg-flat-weak text-text-secondary hover:text-text'
            "
            @click="settingsStore.setRefreshIntervalMs(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <p class="mt-3">
        <BaseTag :tone="settingsStore.pollingEnabled ? 'primary' : 'flat'">
          {{ settingsStore.pollingEnabled ? "轮询已开启" : "轮询已暂停" }}
        </BaseTag>
      </p>
    </BaseCard>

    <BaseCard title="主题色">
      <div class="flex flex-wrap gap-3" role="radiogroup" aria-label="主题色">
        <button
          v-for="option in THEME_COLOR_OPTIONS"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="settingsStore.themeColor === option.value"
          data-track="THEME_COLOR_CHANGE"
          :data-track-detail="option.label"
          class="pressable flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium active:scale-95"
          :class="
            settingsStore.themeColor === option.value
              ? 'bg-flat-weak text-text ring-1 ring-primary'
              : 'bg-flat-weak text-text-secondary hover:text-text'
          "
          @click="settingsStore.setThemeColor(option.value)"
        >
          <span
            class="h-5 w-5 rounded-full"
            :style="{ backgroundColor: option.swatch }"
          />
          {{ option.label }}
        </button>
      </div>
      <p class="mt-2 text-xs text-text-tertiary">
        主色即时生效并记住选择，暗色模式自动适配
      </p>

      <p class="my-4 text-sm text-text">涨跌颜色</p>
      <div class="flex flex-wrap gap-3" role="radiogroup" aria-label="涨跌配色">
        <button
          v-for="option in TREND_THEME_OPTIONS"
          :key="option.value"
          type="button"
          role="radio"
          :aria-checked="settingsStore.trendTheme === option.value"
          data-track="TREND_THEME_CHANGE"
          :data-track-detail="option.label"
          class="pressable flex items-center gap-2 rounded-full py-1 pl-1 pr-3 text-xs font-medium active:scale-95"
          :class="
            settingsStore.trendTheme === option.value
              ? 'bg-flat-weak text-text ring-1 ring-primary'
              : 'bg-flat-weak text-text-secondary hover:text-text'
          "
          @click="settingsStore.setTrendTheme(option.value)"
        >
          <!-- 预览色块：固定展示该选项自身的标识色（左涨右跌），不随当前主题变化 -->
          <span class="flex items-center gap-0.5 pl-1">
            <span
              class="inline-block h-5 w-5 rounded-full"
              :style="{ backgroundColor: option.upSwatch }"
            />
            -
            <span
              class="inline-block h-5 w-5 rounded-full"
              :style="{ backgroundColor: option.downSwatch }"
            />
          </span>
          {{ option.label }}
        </button>
      </div>
      <p class="mt-2 text-xs text-text-tertiary">
        左侧色块为涨、右侧为跌；全站文本与图表即时跟随
      </p>
    </BaseCard>

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

    <BaseCard title="侧栏导航">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm text-text">路由顺序编排</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            拖拽调整左侧导航顺序（含插件菜单），并可控制各页面是否显示
          </p>
        </div>
        <BaseButton variant="ghost" data-track="MENU_ORDER_EDIT" @click="openMenuOrderModal">编排</BaseButton>
      </div>
      <div class="mt-4 flex items-center justify-between gap-4 border-t border-flat-weak pt-4">
        <div>
          <p class="text-sm text-text">重置顺序</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            恢复默认的侧栏导航顺序，并重新显示全部页面
          </p>
        </div>
        <BaseButton
          variant="ghost"
          :disabled="isDefaultMenuOrder"
          data-track="MENU_ORDER_RESET"
          @click="onResetMenuOrder"
        >
          重置
        </BaseButton>
      </div>
    </BaseCard>

    <BaseCard title="顶栏工具">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm text-text">右上角工具编排</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            拖拽调整顶栏条目顺序（含插件条目），并可控制各条目是否显示
          </p>
        </div>
        <BaseButton variant="ghost" data-track="HEADER_ORDER_EDIT" @click="openHeaderOrderModal">
          编排
        </BaseButton>
      </div>
      <div class="mt-4 flex items-center justify-between gap-4 border-t border-flat-weak pt-4">
        <div>
          <p class="text-sm text-text">重置顺序</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            恢复默认的顶栏顺序，并重新显示全部条目
          </p>
        </div>
        <BaseButton
          variant="ghost"
          :disabled="isDefaultHeaderOrder"
          data-track="HEADER_ORDER_RESET"
          @click="onResetHeaderOrder"
        >
          重置
        </BaseButton>
      </div>
    </BaseCard>

    <BaseCard title="插件">
      <div class="flex items-center justify-between gap-4">
        <div>
          <p class="text-sm text-text">插件管理</p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            共 {{ pluginList.length }} 个插件，已挂载 {{ mountedCount }}
            个；启停即时生效，插件的侧栏面板、菜单、路由与命令会一起增删
          </p>
        </div>
        <div class="flex items-center gap-2">
          <BaseButton
            variant="ghost"
            data-track="PLUGIN_INSTALL_OPEN"
            @click="pluginInstallModalOpen = true"
          >
            安装插件
          </BaseButton>
          <BaseButton variant="ghost" data-track="PLUGIN_MANAGE_OPEN" @click="pluginModalOpen = true">
            管理
          </BaseButton>
        </div>
      </div>
      <div class="mt-4 border-t border-flat-weak pt-4">
        <p class="text-sm text-text">插件工坊</p>
        <p class="mt-0.5 text-xs text-text-tertiary">
          侧栏「插件工坊」页可查看已挂载插件、贡献点清单、生效服务与最近内核事件
        </p>
      </div>
    </BaseCard>

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

    <BaseCard title="系统">
      <div class="mb-4 flex items-center justify-between gap-4">
        <div class="text-sm text-text">作者</div>
        <div class="mt-0.5 text-xs text-text-tertiary">WHF293</div>
      </div>
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
      <div class="flex items-center justify-between gap-4">
        <div class="min-w-0">
          <p class="text-sm text-text">
            当前版本 v{{ APP_VERSION }}
            <BaseTag
              v-if="updateStatus === 'latest'"
              tone="primary"
              class="ml-1"
            >
              已是最新
            </BaseTag>
          </p>
          <p class="mt-0.5 text-xs text-text-tertiary">
            对比 GitHub Releases 最新版本
          </p>
        </div>
        <BaseButton
          variant="ghost"
          :disabled="updateStatus === 'checking'"
          data-track="CHECK_UPDATE"
          @click="onCheckUpdate"
        >
          {{ updateButtonText }}
        </BaseButton>
      </div>
    </BaseCard>

    <!-- 快捷键说明弹窗 -->
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

    <!-- 发现新版本弹窗：展示版本号与下载地址 -->
    <BaseConfirmModal
      v-model:open="updateModalOpen"
      title="发现新版本"
      :ok-text="'前往下载'"
      cancel-text="关闭"
      @ok="onGoDownload"
    >
      <p class="text-sm text-text">
        最新版本
        <span class="font-semibold text-primary">v{{ latestVersion }}</span>
        <span class="text-text-tertiary">（当前 v{{ APP_VERSION }}）</span>
      </p>
      <p class="mt-2 text-xs text-text-tertiary">下载地址：</p>
      <a
        :href="RELEASES_URL"
        target="_blank"
        rel="noopener"
        class="mt-1 block break-all text-xs text-primary underline underline-offset-2"
        @click="updateModalOpen = false"
      >
        {{ RELEASES_URL }}
      </a>
    </BaseConfirmModal>

    <!-- 插件管理弹窗：列表 + 启停 + 重试 + 用户插件卸载 -->
    <PluginManageModal v-model:open="pluginModalOpen" />

    <!-- 插件安装弹窗：粘贴代码 / 选本地 .js → 解析预览 → 确认安装 -->
    <PluginInstallModal v-model:open="pluginInstallModalOpen" />

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
        拖拽调整顺序；开关控制该页是否显示在左侧栏（隐藏后路由仍可达）。点「确认」保存并立即刷新侧栏
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
        拖拽调整顺序（从右到左依次排列）；开关控制该条目是否显示在顶栏。点「确认」保存并立即生效
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
    </BaseConfirmModal>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseConfirmModal from "../components/ui/BaseConfirmModal.vue";
import BaseSwitch from "../components/ui/BaseSwitch.vue";
import NoticeBar from "../components/ui/NoticeBar.vue";
import BaseTag from "../components/ui/BaseTag.vue";
import { sdk } from "../api/sdk";
import { STOCK_PROXY_PATH } from "../constants/proxy.constants";
import { REFRESH_INTERVAL_OPTIONS } from "../constants/polling.constants";
import { THEME_COLOR_OPTIONS } from "../constants/theme-color.constants";
import { TREND_THEME_OPTIONS } from "../constants/trend-theme.constants";
import {
  APP_VERSION,
  CHECK_UPDATE_TIMEOUT_MS,
  RELEASES_LATEST_API,
  RELEASES_URL,
} from "../constants/app-info.constants";
import { useSettingsStore } from "../stores/settings";
import {
  DATA_SOURCE_LABEL,
  DATA_SOURCE_URL,
} from "@/constants/data-source.constants";

/**
 * 设置页：轮询规则公告 + 数据来源 + 代理自检 + 轮询总开关 + 刷新间隔 + 主题配置 + 缓存管理
 * （偏好 localStorage 持久化）
 */

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

// ---------- 检查更新 ----------
/** 检查状态：idle 未检查 / checking 检查中 / latest 已是最新 / newer 发现新版 / fail 失败 */
type UpdateStatus = "idle" | "checking" | "latest" | "newer" | "fail";

/** 检查更新状态 */
const updateStatus = ref<UpdateStatus>("idle");

/** 最新版本号（去掉 tag 前缀 v） */
const latestVersion = ref<string>("");

/** 快捷键说明弹窗 */
const shortcutsModalOpen = ref(false);

/** 快捷键列表 */
const SHORTCUTS = [
  { key: 'Shift + Tab', action: '切换页面（按侧栏顺序循环，不含设置页）' },
  { key: 'Esc', action: '关闭股票详情面板 / 搜索弹窗' },
  { key: '↑ ↓', action: '搜索弹窗内切换标的' },
  { key: 'Enter', action: '搜索弹窗内确认选中标的' },
] as const;

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
        <BaseButton variant="ghost" @click="onClearCaches">
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
            @update:model-value="settingsStore.setWatermarkEnabled"
          />
        </div>
        <div class="flex items-center justify-between border-t border-flat-weak pt-4">
          <div>
            <p class="text-sm text-text">快捷键说明</p>
            <p class="mt-0.5 text-xs text-text-tertiary">查看当前软件支持的快捷操作</p>
          </div>
          <BaseButton variant="ghost" @click="shortcutsModalOpen = true">查看</BaseButton>
        </div>
      </div>
    </BaseCard>

    <BaseCard title="系统">
      <div class="flex items-center justify-between gap-4 mb-4">
        <div class="text-sm text-text">作者</div>
        <div class="mt-0.5 text-xs text-text-tertiary">WHF293</div>
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
  </div>
</template>

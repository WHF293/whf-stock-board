<script setup lang="ts">
import { computed, ref } from "vue";
import BaseButton from "../components/ui/BaseButton.vue";
import BaseCard from "../components/ui/BaseCard.vue";
import BaseSwitch from "../components/ui/BaseSwitch.vue";
import NoticeBar from "../components/ui/NoticeBar.vue";
import BaseTag from "../components/ui/BaseTag.vue";
import { sdk } from "../api/sdk";
import { STOCK_PROXY_PATH } from "../constants/proxy.constants";
import { REFRESH_INTERVAL_OPTIONS } from "../constants/polling.constants";
import { THEME_COLOR_OPTIONS } from "../constants/theme-color.constants";
import { TREND_THEME_OPTIONS } from "../constants/trend-theme.constants";
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
  "行情自动刷新仅在交易时段内按所选间隔轮询：A 股为交易日 09:15–15:00，美股为 21:30–24:00 与 00:00–04:00；非交易日与其他时段仅在进入页面时请求一次，不重复轮询。"
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
  <div class="max-w-xl space-y-4">
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
        <BaseButton variant="ghost" :disabled="probeStatus === 'running'" @click="onProbeProxy">
          {{ probeButtonText }}
        </BaseButton>
      </div>
      <p v-if="probeResultText" class="mt-2">
        <BaseTag :tone="probeStatus === 'ok' ? 'primary' : 'flat'">
          {{ probeResultText }}
        </BaseTag>
      </p>
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
    </BaseCard>

    <BaseCard title="涨跌颜色">
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
              class="inline-block h-3 w-3 rounded-sm"
              :style="{ backgroundColor: option.upSwatch }"
            />
            <span
              class="inline-block h-3 w-3 rounded-sm"
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

    <BaseCard title="水印">
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
    </BaseCard>

    <BaseCard title="缓存管理">
      <div class="flex items-center justify-between gap-4">
        <p class="text-xs text-text-tertiary">
          清空代码表 / 交易日历 / 板块映射等实例级缓存
        </p>
        <BaseButton variant="ghost" @click="onClearCaches">
          清空 SDK 缓存
        </BaseButton>
      </div>
    </BaseCard>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentAppVersion } from "../../../common/api/app-update.api.ts";
import { useAppUpdate } from "../../../common/composables/use-app-update";
import { UPDATE_FEEDBACK_RESET_MS } from "../../../common/constants/update.constants.ts";

/**
 * 版本号标签（自绘标题栏左侧、交易状态徽标之后，youtube-desktop 同款，仅桌面端渲染）
 *
 * 常显当前版本 vA.B.C；点击检查更新——发现新版后**不再二次确认**，自动
 * 「流式下载（进度实时显示）→ 下载完立即静默安装并自动重启」一站完成。
 * 「已是最新」/ 失败原因以瞬态文案反馈 2.5s 后复位回版本号。
 * 检测状态机与设置页检查更新卡片共享同一份（use-app-update 模块级单例）。
 */

const { status, latestVersion, progressPercent, lastMessage, check, startDownload, cancelDownload, installNow, autoCheckOnce } =
  useAppUpdate();

/** 当前运行版本（Tauri 下读 tauri.conf.json 的 version，浏览器端回退 APP_VERSION 常量） */
const currentVersion = ref("");

/** 瞬态反馈文案（「已是最新」/ 失败原因；展示 UPDATE_FEEDBACK_RESET_MS 后复位） */
const flash = ref("");

/** flash 的语气（决定文案颜色） */
const flashTone = ref<"ok" | "error">("ok");

/** 本次交互是否由用户点击触发（区别于启动静默检测：只有点击链路才自动下载+安装） */
const autoFlow = ref(false);

let flashTimer = 0;

/**
 * 展示瞬态反馈并定时复位
 * @param text 反馈文案（「已是最新」/ 失败原因）
 * @param tone 语气（决定文案颜色：ok=成功色，error=提示色）
 */
const showFlash = (text: string, tone: "ok" | "error"): void => {
  flash.value = text;
  flashTone.value = tone;
  window.clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => {
    flash.value = "";
  }, UPDATE_FEEDBACK_RESET_MS);
};

// 自动链路：点击触发的检查发现新版 → 直接下载；下载完 → 直接静默安装重启。
// 启动静默检测发现的新版只亮「新版本 · 点击更新」，不未经确认自动装
watch(status, (value) => {
  if (!autoFlow.value) return;
  if (value === "available") void startDownload();
  else if (value === "ready") void installNow();
});

/** 点击标签（按当前状态分流；见文件头注释） */
const onClick = (): void => {
  if (status.value === "downloading") {
    // 下载中点击 = 取消（半截文件由 api 层清理），回「新版本 · 点击更新」
    autoFlow.value = false;
    cancelDownload();
    return;
  }
  if (status.value === "ready") {
    void installNow();
    return;
  }
  if (status.value === "checking" || status.value === "installing") return;
  // idle / up-to-date：检查更新，且本次链路发现新版后自动下载+安装
  autoFlow.value = true;
  void check(false).then(() => {
    if (status.value === "up-to-date") showFlash("已是最新", "ok");
  });
};

// 检查 / 下载 / 安装失败的轻提示（lastMessage 由状态机写入）转瞬态反馈
watch(lastMessage, (value) => {
  if (value) showFlash(value, "error");
});

/** 标签文案（flash 优先，其余按状态机） */
const label = computed(() => {
  if (flash.value) return flash.value;
  switch (status.value) {
    case "checking":
      return "检查中…";
    case "downloading":
      return `下载中 ${progressPercent.value}%`;
    case "ready":
      return "立即更新";
    case "installing":
      return "更新中…";
    case "available":
      return `新版本 v${latestVersion.value} · 点击更新`;
    default:
      return currentVersion.value ? `v${currentVersion.value}` : "";
  }
});

/** 有新版 / 下载中 / 安装中时高亮（提示色），其余走弱文本色 */
const isHighlighted = computed(
  () => flashTone.value === "error" || ["available", "downloading", "ready", "installing"].includes(status.value),
);

onMounted(() => {
  if (!isTauri()) return;
  void getCurrentAppVersion().then((value) => {
    currentVersion.value = value;
  });
  // 启动静默检测照旧（发现新版只提示，不自动装）
  autoCheckOnce();
});
</script>

<template>
  <button
    v-if="currentVersion"
    type="button"
    class="shrink-0 rounded-md px-1.5 py-0.5 text-xs whitespace-nowrap transition-colors hover:bg-flat-weak active:scale-95"
    :class="isHighlighted ? 'text-primary' : 'text-text-tertiary'"
    :title="`当前版本 v${currentVersion}，点击检查更新`"
    data-track="UPDATE_VERSION_TAG"
    @click="onClick"
  >
    {{ label }}
  </button>
</template>

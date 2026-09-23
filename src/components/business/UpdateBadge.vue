<script setup lang="ts">
import { onMounted } from "vue";
import { useAppUpdate } from "../../composables/use-app-update";
import type { AppUpdateStatus } from "../../types/app-update.types";

/**
 * 自动更新徽标（自绘标题栏右侧常驻位，仅 Tauri 桌面端随 TitleBar 渲染）
 *
 * 应用启动 6 秒后静默检测 GitHub Releases（失败按「无新版本」处理，不打扰）；
 * 发现有新版时展示下载入口，点击流式下载安装包（进度百分比实时反馈），
 * 下载完变「立即更新」，点击后 Rust 侧静默安装并自动重启应用。
 * idle / checking / up-to-date 状态不渲染任何内容，不占顶栏空间。
 */

const {
  status,
  latestVersion,
  progressPercent,
  isBadgeVisible,
  startDownload,
  cancelDownload,
  installNow,
  autoCheckOnce,
} = useAppUpdate();

/** 状态 → 无障碍标签 / 埋点键（仅展示态会渲染，其余值不会出现） */
const BADGE_ARIA: Record<AppUpdateStatus, string> = {
  available: "下载新版本",
  downloading: "取消下载",
  ready: "立即更新",
  installing: "正在安装更新",
  idle: "",
  checking: "",
  "up-to-date": "",
};

const BADGE_TRACK: Record<AppUpdateStatus, string> = {
  available: "UPDATE_DOWNLOAD",
  downloading: "UPDATE_CANCEL_DOWNLOAD",
  ready: "UPDATE_INSTALL",
  installing: "UPDATE_INSTALL",
  idle: "",
  checking: "",
  "up-to-date": "",
};

onMounted(() => {
  autoCheckOnce();
});
</script>

<template>
  <button
    v-if="isBadgeVisible"
    type="button"
    class="relative mr-1 flex h-7 shrink-0 items-center gap-1.5 overflow-hidden rounded-md px-2 text-xs font-medium whitespace-nowrap active:scale-95"
    :class="{
      'bg-flat-weak text-text hover:bg-flat-weak/70': status === 'available' || status === 'downloading',
      'bg-primary text-on-primary hover:opacity-90': status === 'ready' || status === 'installing',
      'cursor-not-allowed opacity-70': status === 'installing',
    }"
    :aria-label="BADGE_ARIA[status]"
    :data-track="BADGE_TRACK[status]"
    :disabled="status === 'installing'"
    @click="
      () => {
        if (status === 'available') void startDownload();
        else if (status === 'downloading') cancelDownload();
        else if (status === 'ready') void installNow();
      }
    "
  >
    <!-- 新版待下载：小圆点强调 + 版本号 -->
    <template v-if="status === 'available'">
      <span class="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />
      新版本 v{{ latestVersion }}
    </template>
    <!-- 下载中：百分比（点击 = 取消），底部细进度条 -->
    <template v-else-if="status === 'downloading'">
      下载中 {{ progressPercent }}%
      <span
        class="absolute inset-x-0 bottom-0 h-0.5 bg-primary transition-all"
        :style="{ width: `${progressPercent}%` }"
        aria-hidden="true"
      />
    </template>
    <!-- 下载完成：一键静默安装并重启 -->
    <template v-else-if="status === 'ready'">立即更新</template>
    <template v-else>更新中…</template>
  </button>
</template>

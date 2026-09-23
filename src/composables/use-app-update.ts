import { computed, ref } from 'vue';
import {
  downloadReleaseAsset,
  fetchLatestRelease,
  getCurrentAppVersion,
  runInstaller,
} from '../api/app-update.api';
import { compareVersion } from '../utils/compare-version';
import {
  UPDATE_AUTO_CHECK_DELAY_MS,
  UPDATE_DOWNLOAD_TIMEOUT_MS,
  UPDATE_PROGRESS_PRECISION,
} from '../constants/update.constants';
import type { AppUpdateStatus, LatestReleaseInfo } from '../types/app-update.types';

/**
 * 应用自动更新 · 全局状态机（模块级单例，TitleBar 徽标与设置页卡片共享同一份）
 *
 * 流转：idle --check--> up-to-date / available --startDownload--> downloading
 * --完成--> ready --installNow--> installing（Rust 静默安装 + 自动重启，前端不再回来）。
 * 任何失败均不抛向全局：自动检测失败视为无新版本（回 idle），手动操作失败
 * 回退到可重试的前态并把原因写入 lastMessage（设置页轻提示展示）。
 */

/** ---------------- 模块级单例状态（useAppUpdate 的所有调用者共享） ---------------- */

const status = ref<AppUpdateStatus>('idle');

/** 最新版本号（检测到新版时有值，如 3.0.3） */
const latestVersion = ref('');

/** 下载进度（0-100 整数百分比，仅 downloading 态有意义） */
const progressPercent = ref(0);

/** 最近一次失败的轻提示（手动检测 / 下载 / 安装失败的原因，供设置页展示） */
const lastMessage = ref('');

/** 检测到的 release（available 之后持有，下载 / 安装共用） */
let pendingRelease: LatestReleaseInfo | null = null;

/** 安装包绝对路径（下载完成后持有，installNow 用） */
let installerPath = '';

/** 下载中止控制器 + 超时定时器（cancelDownload / 完成时清理） */
let downloadAbort: AbortController | null = null;
let downloadTimeoutTimer = 0;

/** 自动检测已启动标记（保证整个应用生命周期只调度一次） */
let autoCheckStarted = false;

/** ---------------- 状态流转 ---------------- */

/**
 * 检查更新（手动与自动共用；自动传 silent）
 * @param silent true = 启动自动检测：失败静默回 idle，不写 lastMessage
 */
const check = async (silent: boolean): Promise<void> => {
  if (status.value === 'checking' || status.value === 'downloading') return;
  status.value = 'checking';
  lastMessage.value = '';
  const currentVersion = await getCurrentAppVersion();
  const info = await fetchLatestRelease();
  if (!info) {
    // 网络不通 / 未开源 / 限流：按「无新版本」处理（用户指定口径），仅手动检测给轻提示
    status.value = 'idle';
    if (!silent) lastMessage.value = '暂时无法获取版本信息（网络不可用或仓库未发布），稍后再试';
    return;
  }
  if (compareVersion(currentVersion, info.version) >= 0) {
    status.value = 'up-to-date';
    return;
  }
  pendingRelease = info;
  latestVersion.value = info.version;
  status.value = 'available';
};

/**
 * 开始下载安装包（available 态点击下载触发；进度写入 progressPercent）
 */
const startDownload = async (): Promise<void> => {
  if (status.value !== 'available' || !pendingRelease) return;
  status.value = 'downloading';
  progressPercent.value = 0;
  downloadAbort = new AbortController();
  downloadTimeoutTimer = window.setTimeout(
    () => downloadAbort?.abort(),
    UPDATE_DOWNLOAD_TIMEOUT_MS,
  );
  try {
    installerPath = await downloadReleaseAsset(
      pendingRelease.asset,
      (received, total) => {
        if (total > 0) {
          progressPercent.value = Math.floor((received / total) * UPDATE_PROGRESS_PRECISION);
        }
      },
      downloadAbort.signal,
    );
    status.value = 'ready';
  } catch (error) {
    status.value = 'available';
    lastMessage.value =
      error instanceof DOMException && error.name === 'AbortError'
        ? '下载已取消'
        : `下载失败：${error instanceof Error ? error.message : String(error)}`;
  } finally {
    window.clearTimeout(downloadTimeoutTimer);
    downloadAbort = null;
  }
};

/**
 * 取消下载（downloading 态点击触发；半截文件由 api 层清理，状态回 available）
 */
const cancelDownload = (): void => {
  downloadAbort?.abort();
};

/**
 * 立即更新（ready 态点击触发）：Rust 侧静默安装并自动重启；失败回 ready 可重试
 */
const installNow = async (): Promise<void> => {
  if (status.value !== 'ready' || !installerPath) return;
  status.value = 'installing';
  try {
    await runInstaller(installerPath);
    // 成功路径：应用随即退出（静默安装 + 自动重启），不会走到后续状态
  } catch (error) {
    status.value = 'ready';
    lastMessage.value = `启动安装失败：${error instanceof Error ? error.message : String(error)}`;
  }
};

/**
 * 启动自动检测（整个生命周期只调度一次；延迟避开启动高峰，失败静默）
 */
const autoCheckOnce = (): void => {
  if (autoCheckStarted) return;
  autoCheckStarted = true;
  window.setTimeout(() => {
    void check(true);
  }, UPDATE_AUTO_CHECK_DELAY_MS);
};

/** 是否处于需要展示徽标的状态（available / downloading / ready / installing） */
const isBadgeVisible = computed(
  () =>
    status.value === 'available' ||
    status.value === 'downloading' ||
    status.value === 'ready' ||
    status.value === 'installing',
);

/**
 * 应用自动更新状态机（模块级单例，所有调用点共享同一份状态）
 * @returns 状态 / 动作集合
 */
export const useAppUpdate = () => ({
  status,
  latestVersion,
  progressPercent,
  lastMessage,
  isBadgeVisible,
  check,
  startDownload,
  cancelDownload,
  installNow,
  autoCheckOnce,
});

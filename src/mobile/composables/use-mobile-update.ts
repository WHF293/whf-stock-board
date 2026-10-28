import { ref } from 'vue';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { APP_VERSION } from '../../common/constants/app-info.constants.ts';
import { UPDATE_CHECK_TIMEOUT_MS } from '../../common/constants/update.constants.ts';

/**
 * 移动端检查更新 + 直下 APK + 拉起安装（MobileMine / MobileSettings 共用）
 *
 * 链路：GitHub Releases API 比对版本 → 有新版时点「更新」：
 * 从 release 资产里挑出 APK（stockboard_*_arm64.apk）→ Rust 侧交系统
 * DownloadManager 直下（带进度轮询）→ 下载完成自动拉起系统安装界面。
 * 任一步失败回退：打开 Releases 页让用户手动下载。
 */

/** 更新检查状态（downloading = APK 下载中；ready = 待安装） */
export type MobileUpdateState = 'idle' | 'checking' | 'latest' | 'available' | 'downloading';

/** 进度轮询间隔（毫秒；DownloadManager 查询是本地 binder 调用，可稍密） */
const DOWNLOAD_POLL_INTERVAL_MS = 800;

/**
 * 比较语义化版本（x.y.z 逐段数值比较）
 * @param a 版本 a
 * @param b 版本 b
 * @returns a > b 返回正数
 */
const compareVersions = (a: string, b: string): number => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

/**
 * 移动端更新状态机
 * @param onMessage 轻提示回调（传 Toast 函数）
 * @param onFallback 回退回调（下载链路失败时打开 Releases 页）
 * @returns 状态与动作
 */
export const useMobileUpdate = (
  onMessage: (text: string) => void,
  onFallback: () => void,
) => {
  const updateState = ref<MobileUpdateState>('idle');
  const latestTag = ref('');
  /** 下载进度 0~100（成功后保持 100） */
  const progress = ref(0);

  /** 检查更新：比对 GitHub Release 最新 tag 与内置 APP_VERSION */
  const checkUpdate = async (): Promise<void> => {
    if (updateState.value === 'checking' || updateState.value === 'downloading') return;
    updateState.value = 'checking';
    try {
      const response = await fetch(
        'https://api.github.com/repos/WHF293/whf-stock-board/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' } },
      );
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as { tag_name?: string };
      latestTag.value = (payload.tag_name ?? '').replace(/^v/, '');
      updateState.value =
        latestTag.value !== '' && compareVersions(latestTag.value, APP_VERSION) > 0
          ? 'available'
          : 'latest';
    } catch {
      updateState.value = 'latest';
      onMessage('检查失败，请稍后重试');
    }
  };

  /**
   * 从 release 资产里挑 APK 直链（CI 产物命名 stockboard_<tag>_arm64.apk）
   * @param assets release 资产列表
   * @returns APK 下载直链；没有资产返回 null
   */
  const pickApkUrl = (assets: { name?: string; browser_download_url?: string }[]): string | null =>
    assets.find((asset) => /\.apk$/i.test(asset.name ?? ''))?.browser_download_url ?? null;

  /**
   * 等待下载完成并轮询进度（DownloadManager 任务结束即返回）
   * @param id 下载任务 id
   * @returns 是否成功
   */
  const waitForDownload = async (id: number): Promise<boolean> => {
    for (;;) {
      const [status, soFar, total] = await invoke<[string, number, number]>(
        'apk_download_status',
        { id },
      );
      if (total > 0) {
        progress.value = Math.min(100, Math.round((soFar / total) * 100));
      }
      if (status === 'successful') {
        progress.value = 100;
        return true;
      }
      if (status === 'failed') {
        return false;
      }
      await new Promise((resolve) => setTimeout(resolve, DOWNLOAD_POLL_INTERVAL_MS));
    }
  };

  /**
   * 直下 APK 并拉起安装（「更新」按钮主链路；失败回退 Releases 页）
   */
  const downloadLatest = async (): Promise<void> => {
    if (updateState.value === 'downloading') return;
    // 非 Tauri（浏览器 dev）或 Rust 命令缺失：直接回退 Release 页
    if (!isTauri()) {
      onFallback();
      return;
    }
    updateState.value = 'downloading';
    progress.value = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
      const response = await fetch(
        'https://api.github.com/repos/WHF293/whf-stock-board/releases/latest',
        { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal },
      );
      clearTimeout(timer);
      if (!response.ok) throw new Error(String(response.status));
      const payload = (await response.json()) as {
        tag_name?: string;
        assets?: { name?: string; browser_download_url?: string }[];
      };
      const url = pickApkUrl(payload.assets ?? []);
      if (!url) throw new Error('未找到 APK 资产');
      const tag = (payload.tag_name ?? '').replace(/^v/, '');
      const id = await invoke<number>('download_apk', {
        url,
        title: `股票看板 v${tag || APP_VERSION}`,
      });
      onMessage('已开始下载新版安装包');
      const ok = await waitForDownload(Number(id));
      if (!ok) throw new Error('下载失败');
      await invoke('install_apk', { id: Number(id) });
      onMessage('下载完成，请在系统安装界面确认安装');
      updateState.value = 'latest';
    } catch {
      onMessage('下载链路异常，已打开发布页，请手动下载 APK');
      onFallback();
      updateState.value = 'available';
    }
  };

  return { updateState, latestTag, progress, checkUpdate, downloadLatest };
};

import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir } from '@tauri-apps/api/path';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { mkdir, open, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { APP_VERSION } from '../constants/app-info.constants';
import {
  UPDATE_API_ACCEPT,
  UPDATE_ASSET_SUFFIX,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_DIR_NAME,
  UPDATE_LATEST_API,
  UPDATE_PROGRESS_THROTTLE_MS,
  UPDATE_WRITE_CHUNK_BYTES,
} from '../constants/update.constants';
import type { GithubReleasePayload, LatestReleaseInfo, ReleaseAssetInfo } from '../types/app-update.types';

/**
 * 应用自动更新（GitHub Releases）· API
 *
 * 检测：GET releases/latest（未认证，仓库开源后免鉴权；失败返回 null，
 * 由调用方按「无新版本」静默处理）；下载：browser_download_url 经
 * tauri-plugin-http（Rust 直连，无 CORS 限制）流式拉取 NSIS 安装包到
 * $APPDATA/updates/，边下边按分块落盘并回报进度；安装：调 Rust 命令
 * `install_update` 以 /S + /R 参数启动安装包并退出当前应用（装完自动重启）。
 *
 * 全链路仅 Tauri 桌面端可用；浏览器端所有函数为空操作。
 */

/** 当前应用版本缓存（getVersion 是异步 IPC，取一次复用；浏览器端回退常量） */
let cachedAppVersion: string | null = null;

/**
 * 取当前应用版本（Tauri 下读 tauri.conf.json 的 version，浏览器端回退 APP_VERSION 常量）
 * @returns 版本号字符串（如 3.0.2）
 */
export const getCurrentAppVersion = async (): Promise<string> => {
  if (cachedAppVersion) return cachedAppVersion;
  if (isTauri()) {
    cachedAppVersion = await getVersion();
  } else {
    cachedAppVersion = APP_VERSION;
  }
  return cachedAppVersion;
};

/**
 * 安装包存放目录的绝对路径（appDataDir/updates，目录不存在则创建）
 * @returns 目录绝对路径（不含尾分隔符）
 */
const ensureInstallerDir = async (): Promise<string> => {
  const base = await appDataDir();
  const dir = `${base.replace(/[\\/]+$/, '')}/${UPDATE_DIR_NAME}`;
  await mkdir(dir, { baseDir: BaseDirectory.AppData, recursive: true });
  return dir;
};

/**
 * 从 release 的 assets 列表里找 NSIS 安装包（按文件名后缀匹配）
 * @param release GitHub release JSON（只取用 tag_name / assets）
 * @returns 安装包资产信息；找不到可执行资产返回 null
 */
const findSetupAsset = (release: GithubReleasePayload): ReleaseAssetInfo | null => {
  const asset = (release.assets ?? []).find(
    (item) => (item.name ?? '').endsWith(UPDATE_ASSET_SUFFIX),
  );
  if (!asset || !asset.id || !asset.name || !asset.browser_download_url) return null;
  return {
    assetId: asset.id,
    name: asset.name,
    downloadUrl: asset.browser_download_url,
    size: asset.size ?? 0,
  };
};

/**
 * 检测 GitHub Releases 最新版本（未认证请求；仓库未开源 / 限流 / 无网都返回 null）
 * @returns 最新 release 信息（版本号 + 安装包资产）；检测不到返回 null
 */
export const fetchLatestRelease = async (): Promise<LatestReleaseInfo | null> => {
  if (!isTauri()) return null;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    const response = await fetch(UPDATE_LATEST_API, {
      signal: controller.signal,
      headers: { Accept: UPDATE_API_ACCEPT },
    });
    if (!response.ok) return null;
    const release = (await response.json()) as GithubReleasePayload;
    const tag = release.tag_name ?? '';
    const asset = findSetupAsset(release);
    if (!tag || !asset) return null;
    return { version: tag.replace(/^v/i, ''), asset };
  } catch {
    // 网络口径（用户指定）：检测失败一律静默按「无新版本」处理
    return null;
  } finally {
    window.clearTimeout(timer);
  }
};

/**
 * 流式下载安装包到 $APPDATA/updates/<文件名>（边下边落盘，进度节流回报）
 * @param asset 安装包资产信息（downloadUrl / size）
 * @param onProgress 进度回调（receivedBytes / totalBytes；约 200ms 节流一次）
 * @param signal 取消信号（外部 abort 时中断下载并清理半截文件）
 * @returns 安装包绝对路径
 * @throws 网络中断 / 大小校验失败 / 写盘失败（半截文件已由本函数清理）
 */
export const downloadReleaseAsset = async (
  asset: ReleaseAssetInfo,
  onProgress: (receivedBytes: number, totalBytes: number) => void,
  signal: AbortSignal,
): Promise<string> => {
  await ensureInstallerDir();
  // 相对路径 + AppData 基准 = AppData/updates/<文件名>（与 fs:scope 放行的目录一致）
  const relativePath = `${UPDATE_DIR_NAME}/${asset.name}`;
  const base = await appDataDir();
  const filePath = `${base.replace(/[\\/]+$/, '')}/${relativePath}`;
  const controller = new AbortController();
  const onOuterAbort = (): void => controller.abort();
  signal.addEventListener('abort', onOuterAbort, { once: true });
  try {
    const response = await tauriFetch(asset.downloadUrl, {
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!response.ok || !response.body) {
      throw new Error(`下载响应异常 HTTP ${response.status}`);
    }
    const total =
      Number(response.headers.get('content-length')) || asset.size || 0;

    const handle = await open(relativePath, {
      write: true,
      create: true,
      truncate: true,
      baseDir: BaseDirectory.AppData,
    });
    let received = 0;
    let buffer = new Uint8Array(0);
    let lastEmit = 0;
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      // 分块累积到阈值再落盘（缓冲到 UPDATE_WRITE_CHUNK_BYTES 或流结束）
      const merged = new Uint8Array(buffer.length + value.length);
      merged.set(buffer);
      merged.set(value, buffer.length);
      buffer = merged;
      received += value.length;
      if (buffer.length >= UPDATE_WRITE_CHUNK_BYTES) {
        await handle.write(buffer);
        buffer = new Uint8Array(0);
      }
      const now = Date.now();
      if (now - lastEmit >= UPDATE_PROGRESS_THROTTLE_MS) {
        lastEmit = now;
        onProgress(received, total);
      }
    }
    if (buffer.length > 0) await handle.write(buffer);
    onProgress(received, total);
    if (asset.size > 0 && received !== asset.size) {
      throw new Error(`下载不完整：${received}/${asset.size} 字节`);
    }
    return filePath;
  } catch (error) {
    // 半截文件不保留（下次重试从头下载）
    await remove(relativePath, { baseDir: BaseDirectory.AppData }).catch(() => {});
    throw error;
  } finally {
    signal.removeEventListener('abort', onOuterAbort);
  }
};

/**
 * 启动安装包执行更新：Rust 侧以 /S（静默）+ /R（装完自动重启）spawn 后退出本应用。
 * @param installerPath 安装包绝对路径（downloadReleaseAsset 的返回值）
 * @throws 安装包启动失败（应用保持运行，由调用方恢复状态）
 */
export const runInstaller = async (installerPath: string): Promise<void> => {
  await invoke('install_update', { installerPath });
};

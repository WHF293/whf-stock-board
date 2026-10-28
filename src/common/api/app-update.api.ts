import { invoke, isTauri } from '@tauri-apps/api/core';
import { getVersion } from '@tauri-apps/api/app';
import { appDataDir } from '@tauri-apps/api/path';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { mkdir, open, remove, BaseDirectory } from '@tauri-apps/plugin-fs';
import { APP_VERSION } from '../constants/app-info.constants.ts';
import {
  UPDATE_API_ACCEPT,
  UPDATE_ASSET_SUFFIX,
  UPDATE_ASSET_URL_TEMPLATE,
  UPDATE_CHECK_TIMEOUT_MS,
  UPDATE_DIR_NAME,
  UPDATE_LATEST_API,
  UPDATE_PROGRESS_THROTTLE_MS,
  UPDATE_RELEASE_PAGE_URL,
  UPDATE_WRITE_CHUNK_BYTES,
} from '../constants/update.constants.ts';
import type { GithubReleasePayload, LatestReleaseInfo, ReleaseAssetInfo } from '../types/app-update.types.ts';
import { buildUpdateProxyInit } from '../utils/update-proxy.ts';
import { trackApiRequest } from '../../pc/weblog/weblogActions';

/**
 * 应用自动更新（GitHub Releases）· API
 *
 * 检测与下载均经 tauri-plugin-http（Rust 直连，无 CORS / 稳定跟随系统代理）：
 * 检测：主通道 = releases/latest 发布页 302 重定向解析版本号（无 API 匿名配额限制，
 * 直连可用），兜底 = releases/latest API（匿名按 IP 限流，可能 403）；失败抛错带原因，
 * 由调用方按手动 / 自动检测分流展示或静默。下载：安装包下载地址流式拉取
 * NSIS 安装包到 $APPDATA/updates/，边下边按分块落盘并回报进度；安装：调 Rust 命令
 * `install_update` 以 cmd 链「等退出 → /S 静默安装回原目录 → 重启新版本」并退出当前应用。
 *
 * 全链路仅 Tauri 桌面端可用；浏览器端所有函数为空操作。
 */

/** 当前应用版本缓存（getVersion 是异步 IPC，取一次复用；浏览器端回退常量） */
let cachedAppVersion: string | null = null;

/**
 * 检测请求实现（与插件更新 `plugin-update.api` 同款通道）：桌面端走 Rust 直连，
 * 浏览器端原生 fetch（本文件检测函数不会走到，仅为类型对齐）
 *
 * ⚠️ 检测不能用 WebView2 原生 fetch：其网络栈只在启动时读一次系统代理，
 * Clash 后开 / 切换模式时已启动的应用不感知，GitHub 请求会间歇性失败且被
 * 「静默按无新版本」的口径吞掉（实测安装版检测不触发即此因）；Rust reqwest
 * 走 `system-proxy` 稳定跟随系统代理，插件更新的 GitHub 请求实测一直正常。
 */
const netFetch: typeof globalThis.fetch = isTauri()
  ? (tauriFetch as unknown as typeof globalThis.fetch)
  : globalThis.fetch;

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
 * 按版本号构造安装包资产（版本号来自发布页重定向；下载地址按产物命名模板拼出）
 * @param version 版本号（不带 v 前缀，如 4.21.0）
 * @returns 最新 release 信息
 */
const buildReleaseFromVersion = (version: string): LatestReleaseInfo => ({
  version,
  asset: {
    assetId: 0,
    name: `stock-board_${version}_x64-setup.exe`,
    downloadUrl: UPDATE_ASSET_URL_TEMPLATE.replace('{version}', version),
    // 字节数未知：下载以响应 content-length 为准（0 = 跳过预校验）
    size: 0,
  },
});

/**
 * 从发布页重定向解析最新版本：`/releases/latest` 302 → `/tag/vX.Y.Z`，
 * 跟随重定向后 response.url 即最终地址（github.com 网页无 API 匿名配额限制）
 * @param signal 取消信号（超时控制）
 * @returns 最新 release 信息；解析不出版本号返回 null（交由调用方走 API 兜底）
 * @throws 网络失败（超时 / DNS / 连接失败），原因交由调用方聚合展示
 */
const fetchLatestFromReleasePage = async (signal: AbortSignal): Promise<LatestReleaseInfo | null> => {
  const proxyConfig = buildUpdateProxyInit().proxy;
  const proxyUrl = typeof proxyConfig?.all === 'string' ? proxyConfig.all : '';
  const startedAt = Date.now();
  let status: number | null = null;
  let ok = false;
  let error: unknown = null;
  try {
    const response = await netFetch(UPDATE_RELEASE_PAGE_URL, {
      signal,
      redirect: 'follow',
      ...buildUpdateProxyInit(),
    });
    status = response.status;
    if (!response.ok) {
      throw new Error(`发布页请求异常 HTTP ${response.status}`);
    }
    ok = true;
    const match = /\/tag\/v?(\d+\.\d+\.\d+)/.exec(response.url);
    return match ? buildReleaseFromVersion(match[1]) : null;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    // 成功失败都记：排查「有没有走代理 / 代理配了没生效」时这是唯一线索
    trackApiRequest({
      url: UPDATE_RELEASE_PAGE_URL,
      method: 'GET',
      durationMs: Date.now() - startedAt,
      status,
      ok,
      error,
      proxy: proxyUrl,
    });
  }
};

/**
 * 检测 GitHub Releases 最新版本（主通道 = 发布页重定向；API 为兜底）
 *
 * 检测失败**抛错**并带具体原因（2026-10-27 王总指定不再静默吞掉）——
 * 原先失败一律返回 null 被「静默按无新版本」口径吞掉，匿名 API 403 限流时
 * 更新永远失败且无任何提示
 * @returns 最新 release 信息（版本号 + 安装包资产）
 * @throws 检测失败（两通道都失败时聚合各自原因）
 */
export const fetchLatestRelease = async (): Promise<LatestReleaseInfo> => {
  if (!isTauri()) {
    throw new Error('仅桌面端支持检查更新');
  }
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), UPDATE_CHECK_TIMEOUT_MS);
  try {
    // 主通道：发布页重定向（直连可用，不受 API 配额限制）
    const fromPage = await fetchLatestFromReleasePage(controller.signal);
    if (fromPage) return fromPage;

    // 兜底通道：Releases API（匿名按 IP 限流，可能 403）
    const apiStartedAt = Date.now();
    let apiStatus: number | null = null;
    let apiOk = false;
    let apiError: unknown = null;
    try {
      const response = await netFetch(UPDATE_LATEST_API, {
        signal: controller.signal,
        headers: { Accept: UPDATE_API_ACCEPT },
        ...buildUpdateProxyInit(),
      });
      apiStatus = response.status;
      if (!response.ok) {
        throw new Error(
          response.status === 403 || response.status === 429
            ? `GitHub 接口限流（HTTP ${response.status}），请稍后再试或配置更新代理`
            : `GitHub 接口异常 HTTP ${response.status}`,
        );
      }
      const release = (await response.json()) as GithubReleasePayload;
      apiOk = true;
      const tag = release.tag_name ?? '';
      const asset = findSetupAsset(release);
      if (!tag || !asset) {
        throw new Error('最新版本未提供安装包（*_x64-setup.exe）');
      }
      return { version: tag.replace(/^v/i, ''), asset };
    } catch (err) {
      apiError = err;
      throw err;
    } finally {
      trackApiRequest({
        url: UPDATE_LATEST_API,
        method: 'GET',
        durationMs: Date.now() - apiStartedAt,
        status: apiStatus,
        ok: apiOk,
        error: apiError,
        proxy: ((): string => { const p = buildUpdateProxyInit().proxy; return typeof p?.all === 'string' ? p.all : ''; })(),
      });
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('检测超时（网络不可用或 GitHub 不可达），可尝试配置更新代理', { cause: error });
    }
    throw error;
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
  const proxyConfig = buildUpdateProxyInit().proxy;
  const proxyUrl = typeof proxyConfig?.all === 'string' ? proxyConfig.all : '';
  const startedAt = Date.now();
  let status: number | null = null;
  let ok = false;
  let error: unknown = null;
  try {
    const response = await tauriFetch(asset.downloadUrl, {
      signal: controller.signal,
      redirect: 'follow',
      // 检测与下载同通道：检测走通了代理，下载也必须走同一个，否则装包拉不下来
      ...buildUpdateProxyInit(),
    });
    status = response.status;
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
    ok = true;
    return filePath;
  } catch (err) {
    error = err;
    // 半截文件不保留（下次重试从头下载）
    await remove(relativePath, { baseDir: BaseDirectory.AppData }).catch(() => {});
    throw err;
  } finally {
    signal.removeEventListener('abort', onOuterAbort);
    // 成功失败都记：排查「有没有走代理 / 代理配了没生效」时这是唯一线索
    trackApiRequest({
      url: asset.downloadUrl,
      method: 'GET',
      durationMs: Date.now() - startedAt,
      status,
      ok,
      error,
      proxy: proxyUrl,
    });
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

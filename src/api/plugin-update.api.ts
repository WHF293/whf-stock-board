/**
 * 插件在线更新的网络底座（拉清单 / 下 zip / 算 sha256）
 *
 * 两条硬规矩：
 * 1. **只走这里的 `httpGet`**。桌面端用 `tauri-plugin-http`（Rust 直连，无 CORS），
 *    浏览器用原生 fetch（GitHub CDN 带 CORS 头）。**禁止用 `proxyFetch`** —— 它把 URL
 *    改写成 `/stock-proxy?u=`，是股票行情专用通道，套在 GitHub 上只会拿到 404。
 * 2. **只做传输，不做安装**。下载产物是 `ArrayBuffer`，交给编排层解析后
 *    复用 `useUserPlugins().install()`，这里不碰持久化与内核。
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from '@tauri-apps/api/core';
import {
  PLUGIN_UPDATE_DOWNLOAD_TIMEOUT_MS,
  PLUGIN_UPDATE_ERR_DOWNLOAD,
  PLUGIN_UPDATE_ERR_INDEX,
  PLUGIN_UPDATE_ERR_SCHEMA,
  PLUGIN_UPDATE_FALLBACK_TIMEOUT_MS,
  PLUGIN_UPDATE_INDEX_TIMEOUT_MS,
  PLUGIN_UPDATE_INDEX_URL,
  PLUGIN_UPDATE_RELEASES_API,
  PLUGIN_UPDATE_REPO,
  PLUGIN_UPDATE_SCHEMA_VERSION,
  PLUGIN_UPDATE_ZIP_MAX_BYTES,
} from '../constants/plugin-update.constants';
import type {
  PluginUpdateIndex,
  PluginUpdateIndexEntry,
} from '../types/plugin-update.types';

/**
 * 网络实现：桌面端走 Rust 直连（绕 CORS），浏览器回退原生 fetch
 *
 * 在模块加载时定下来：运行环境不会中途变化，每次请求再判一次只是白跑。
 */
const netFetch: typeof globalThis.fetch = isTauri()
  ? (tauriFetch as unknown as typeof globalThis.fetch)
  : globalThis.fetch;

/**
 * 带超时的 GET
 *
 * 超时用 `AbortController` 而不是包一层 `Promise.race`：后者只是让调用方不等了，
 * 底层请求还在跑，静默检查一多就会攒出一堆悬挂连接。
 * @param url 目标地址
 * @param init 请求参数（可带外部 signal）
 * @param timeoutMs 超时毫秒
 * @returns 响应
 */
const httpGet = async (
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  // 调用方传了外部 signal 就一并跟随（弹窗关掉时不必等超时）
  const outer = init.signal;
  const onOuterAbort = (): void => controller.abort();
  if (outer) outer.addEventListener('abort', onOuterAbort);
  try {
    return await netFetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timer);
    if (outer) outer.removeEventListener('abort', onOuterAbort);
  }
};

/**
 * 把未知异常压成能给用户看的中文原因
 * @param error 抛出的异常
 * @returns 原因文案
 */
const toReason = (error: unknown): string => {
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '请求超时';
    return error.message;
  }
  return '未知错误';
};

/**
 * 只取认识的字段（「多余字段不消费」：将来清单加字段不影响老版本 app）
 * @param raw 清单里的一个原始条目
 * @returns 归一化条目；缺关键字段返回 null（该插件直接不参与更新）
 */
const normalizeEntry = (raw: unknown): PluginUpdateIndexEntry | null => {
  if (typeof raw !== 'object' || raw === null) return null;
  const entry = raw as Partial<PluginUpdateIndexEntry>;
  // id / version / downloadUrl 三缺一就没法匹配也没法下载，宁可跳过也不让它污染列表
  if (typeof entry.id !== 'string' || entry.id.length === 0) return null;
  if (typeof entry.version !== 'string' || entry.version.length === 0) return null;
  if (typeof entry.downloadUrl !== 'string' || entry.downloadUrl.length === 0) return null;
  return {
    id: entry.id,
    name: typeof entry.name === 'string' ? entry.name : entry.id,
    version: entry.version,
    description: typeof entry.description === 'string' ? entry.description : '',
    author: typeof entry.author === 'string' ? entry.author : '',
    zipName: typeof entry.zipName === 'string' ? entry.zipName : '',
    zipSize: typeof entry.zipSize === 'number' ? entry.zipSize : 0,
    sha256: typeof entry.sha256 === 'string' ? entry.sha256 : '',
    downloadUrl: entry.downloadUrl,
    changelog: typeof entry.changelog === 'string' ? entry.changelog : '',
  };
};

/**
 * 解析并校验清单（契约版本不对 = 不可用，宁可整体放弃也不猜字段）
 * @param text 清单原文
 * @returns 清单
 */
const parseIndex = (text: string): PluginUpdateIndex => {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('更新清单不是合法 JSON');
  }
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('更新清单格式不正确');
  }
  const index = raw as Partial<PluginUpdateIndex>;
  if (index.schemaVersion !== PLUGIN_UPDATE_SCHEMA_VERSION) {
    throw new Error(PLUGIN_UPDATE_ERR_SCHEMA);
  }
  if (!Array.isArray(index.plugins)) {
    throw new Error('更新清单缺少 plugins');
  }
  return {
    schemaVersion: PLUGIN_UPDATE_SCHEMA_VERSION,
    generatedAt: typeof index.generatedAt === 'string' ? index.generatedAt : '',
    repo: typeof index.repo === 'string' ? index.repo : PLUGIN_UPDATE_REPO,
    tag: typeof index.tag === 'string' ? index.tag : '',
    releaseUrl: typeof index.releaseUrl === 'string' ? index.releaseUrl : '',
    plugins: index.plugins
      .map((entry) => normalizeEntry(entry))
      .filter((entry): entry is PluginUpdateIndexEntry => entry !== null),
  };
};

/**
 * 降级路径：先问 `api.github.com` 拿最新 tag，再按固定 tag 直链拉同一份清单
 *
 * 只在主 URL 失败时触发 —— 应对风险 R1（`tauri-plugin-http` 若不肯跟随
 * `latest/download` 的两次 302，`latest` 直链就废了，而固定 tag 直链只有一次跳转）。
 *
 * 降级路径仅在主流失败时触发，超时刻意短于主路径（`PLUGIN_UPDATE_FALLBACK_TIMEOUT_MS`）：
 * 两段都用 10s 的话，断网时静默检查要 20s 才收场，提示条会一直卡在「检查更新中…」。
 * @param signal 外部取消信号
 * @returns 清单
 */
const fetchIndexByTag = async (signal?: AbortSignal): Promise<PluginUpdateIndex> => {
  const releaseResponse = await httpGet(
    PLUGIN_UPDATE_RELEASES_API,
    { headers: { Accept: 'application/vnd.github+json' }, signal },
    PLUGIN_UPDATE_FALLBACK_TIMEOUT_MS,
  );
  if (!releaseResponse.ok) throw new Error(`HTTP ${releaseResponse.status}`);
  const release = (await releaseResponse.json()) as { tag_name?: string };
  const tag = release.tag_name ?? '';
  if (tag.length === 0) throw new Error('响应缺少 tag_name');
  const indexResponse = await httpGet(
    `https://github.com/${PLUGIN_UPDATE_REPO}/releases/download/${tag}/index.json`,
    { headers: { Accept: 'application/json' }, signal },
    PLUGIN_UPDATE_FALLBACK_TIMEOUT_MS,
  );
  if (!indexResponse.ok) throw new Error(`HTTP ${indexResponse.status}`);
  return parseIndex(await indexResponse.text());
};

/**
 * 拉更新清单（主 URL 失败时自动走一次降级路径）
 * @param signal 外部取消信号
 * @returns 清单
 */
export const fetchPluginIndex = async (signal?: AbortSignal): Promise<PluginUpdateIndex> => {
  try {
    const response = await httpGet(
      PLUGIN_UPDATE_INDEX_URL,
      { headers: { Accept: 'application/json' }, signal },
      PLUGIN_UPDATE_INDEX_TIMEOUT_MS,
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return parseIndex(await response.text());
  } catch (primaryError) {
    try {
      return await fetchIndexByTag(signal);
    } catch {
      // 降级也失败时，报主路径的原因（它更接近用户的真实处境：连不上 / 清单没发）
      throw new Error(`${PLUGIN_UPDATE_ERR_INDEX}（${toReason(primaryError)}）`);
    }
  }
};

/**
 * 下载插件 zip 字节
 * @param url 直链（钉在本 Release 的 tag 上）
 * @param signal 外部取消信号
 * @returns zip 字节
 */
export const downloadPluginZip = async (
  url: string,
  signal?: AbortSignal,
): Promise<ArrayBuffer> => {
  let response: Response;
  try {
    response = await httpGet(url, { signal }, PLUGIN_UPDATE_DOWNLOAD_TIMEOUT_MS);
  } catch (error) {
    throw new Error(PLUGIN_UPDATE_ERR_DOWNLOAD(toReason(error)), { cause: error });
  }
  if (!response.ok) {
    throw new Error(PLUGIN_UPDATE_ERR_DOWNLOAD(`HTTP ${response.status}`));
  }
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength > PLUGIN_UPDATE_ZIP_MAX_BYTES) {
    throw new Error(PLUGIN_UPDATE_ERR_DOWNLOAD('文件超出 8MB 上限'));
  }
  return buffer;
};

/**
 * 算 SHA-256 十六进制串
 *
 * `crypto.subtle` 不可用时（非安全上下文，如 http:// 访问的局域网 dev）返回空串 ——
 * 调用方视作「跳过校验」，功能不降级：校验是保险，不是必经关卡，装不上比装上有害。
 * 跳过时打一条 warn：清单明明给了 sha256 却没校验，将来排查「包被换了」时这是关键线索。
 * @param buffer 待摘要的字节
 * @returns 十六进制小写串；不可用时空串
 */
export const sha256Hex = async (buffer: ArrayBuffer): Promise<string> => {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    console.warn('[plugin-update] crypto.subtle 不可用，sha256 校验已跳过（非安全上下文？）');
    return '';
  }
  const digest = await subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

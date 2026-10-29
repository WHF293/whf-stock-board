/**
 * 插件市场的网络底座（拉任意源的 Releases → 解析 zip 资产 → 聚合插件条目）
 *
 * 两条硬规矩（与 `plugin-update.api.ts` 同源）：
 * 1. **只走本文件的 `httpGetJson`**：桌面端 `tauri-plugin-http`（Rust 直连，无 CORS），
 *    浏览器原生 fetch（api.github.com 与 Release 资产 CDN 均带 CORS 头）。
 *    **禁用 `proxyFetch`** —— `/stock-proxy` 是股票行情专用通道，套在 GitHub 上只会 404。
 * 2. **只做取数与解析，不做安装**：产物是聚合好的 `PluginMarketCatalog`，
 *    下载 / 校验 / 挂载在 `use-plugin-market.ts`（复用更新链路的 `downloadPluginZip` /
 *    `sha256Hex` / `useUserPlugins().install`）。
 *
 * 缓存：per-repo 落 appStorage（TTL 1h），请求失败回退过期缓存，无缓存才抛错 ——
 * 照官网插件生态页「绝不白屏」口径，也缓解 api.github.com 匿名 60 次/h/IP 限流。
 */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { isTauri } from '@tauri-apps/api/core';
import { appStorage } from '../utils/app-local-storage';
import { buildUpdateProxyInit } from '../utils/update-proxy';
import { trackApiRequest } from '../../pc/weblog/weblogActions';
import { compareVersion } from '../utils/plugin-version';
import {
  PLUGIN_MARKET_BUILTIN_REPO,
  PLUGIN_MARKET_CACHE_TTL_MS,
  PLUGIN_MARKET_CONTENTS_FILE_API,
  PLUGIN_MARKET_ENHANCE_ASSET_NAME,
  PLUGIN_MARKET_ENHANCE_TIMEOUT_MS,
  PLUGIN_MARKET_ERR_FETCH,
  PLUGIN_MARKET_LIST_TIMEOUT_MS,
  PLUGIN_MARKET_MANIFEST_FILE,
  PLUGIN_MARKET_META_TIMEOUT_MS,
  PLUGIN_MARKET_OFFICIAL_SOURCE_REPO,
  PLUGIN_MARKET_PER_PAGE,
  PLUGIN_MARKET_README_EXCERPT_MAX,
  PLUGIN_MARKET_README_FILE,
  PLUGIN_MARKET_RELEASES_API,
  PLUGIN_MARKET_ZIP_NAME_PATTERN,
} from '../constants/plugin-market.constants.ts';
import { STORAGE_NS_PLUGIN_MARKET_CATALOG } from '../constants/storage-key.constants.ts';
import type {
  PluginMarketCatalog,
  PluginMarketEntry,
  PluginMarketVersion,
} from '../types/plugin-market.types.ts';

/** GitHub Release 原始资产（仅取用到的字段，snake_case 与上游一致） */
interface GitHubReleaseAssetRaw {
  name: string;
  size: number;
  browser_download_url: string;
}

/** GitHub Releases 列表原始条目（仅取用到的字段） */
interface GitHubReleaseRaw {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  assets: GitHubReleaseAssetRaw[];
}

/** 增强清单（index.json）里的一条原始条目（宽松解析，字段缺失即跳过） */
interface EnhanceEntryRaw {
  id?: unknown;
  name?: unknown;
  version?: unknown;
  description?: unknown;
  author?: unknown;
  sha256?: unknown;
  changelog?: unknown;
}

/** 增强清单的宽松解析结果 */
interface EnhanceIndex {
  plugins: EnhanceEntryRaw[];
}

/** 缓存载荷：`repo -> { at, catalog }` */
type CatalogCache = Record<string, { at: number; catalog: PluginMarketCatalog }>;

/** `fetchSourceCatalog` 的入参选项 */
export interface FetchSourceCatalogOptions {
  /** true = 跳过新鲜缓存强制请求（用户点「刷新」） */
  force?: boolean;
  /** 外部取消信号（弹窗关闭时中断在途请求） */
  signal?: AbortSignal;
}

/** 网络实现：桌面端走 Rust 直连（绕 CORS），浏览器回退原生 fetch（模块加载时定型） */
const netFetch: typeof globalThis.fetch = isTauri()
  ? (tauriFetch as unknown as typeof globalThis.fetch)
  : globalThis.fetch;

/**
 * 带超时的 GET JSON（超时用 AbortController，避免悬挂连接堆积）
 * @param url 目标地址
 * @param timeoutMs 超时毫秒
 * @param signal 外部取消信号
 * @returns 解析后的 JSON
 */
const httpGetJson = async <T>(
  url: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<T> => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onOuterAbort = (): void => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);
  // 本次请求实际生效的代理（设置页更新代理；空串 = 直连跟随系统代理），随埋点落日志
  const proxyConfig = buildUpdateProxyInit().proxy;
  const proxyUrl = typeof proxyConfig?.all === 'string' ? proxyConfig.all : '';
  const startedAt = Date.now();
  let status: number | null = null;
  let ok = false;
  let error: unknown = null;
  try {
    const response = await netFetch(url, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
      // 设置页配置了更新代理时显式走代理（与应用更新同一条 GitHub 通道）
      ...buildUpdateProxyInit(),
    });
    status = response.status;
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = (await response.json()) as T;
    ok = true;
    return json;
  } catch (err) {
    error = err;
    throw err;
  } finally {
    window.clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
    // 成功失败都记：排查「有没有走代理 / 代理配了没生效」时这是唯一线索
    trackApiRequest({
      url,
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
 * 把未知异常压成可展示的原因（Tauri Rust 层错误 reject 的是字符串，必须 String 化，否则只剩「未知错误」）
 * @param error 抛出的异常
 * @returns 原因文案
 */
const toReason = (error: unknown): string => {
  if (error instanceof Error) return error.message;
  const text = String(error).trim();
  return text.length > 0 ? text : '未知错误';
};

/**
 * 读 per-repo 目录缓存
 * @param repo 仓库全名
 * @returns 缓存载荷；缺失或损坏返回 null
 */
const readCatalogCache = (repo: string): { at: number; catalog: PluginMarketCatalog } | null => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_PLUGIN_MARKET_CATALOG);
    if (!raw) return null;
    const cache = JSON.parse(raw) as CatalogCache;
    const hit = cache[repo];
    if (!hit || typeof hit.at !== 'number' || !Array.isArray(hit.catalog?.entries)) return null;
    return hit;
  } catch {
    return null;
  }
};

/**
 * 写 per-repo 目录缓存（写失败静默忽略；缓存不参与数据迁移，丢了重拉即可）
 * @param repo 仓库全名
 * @param catalog 目录
 */
const writeCatalogCache = (repo: string, catalog: PluginMarketCatalog): void => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_PLUGIN_MARKET_CATALOG);
    const cache = (raw ? (JSON.parse(raw) as CatalogCache) : {}) as CatalogCache;
    cache[repo] = { at: Date.now(), catalog };
    appStorage.setItem(STORAGE_NS_PLUGIN_MARKET_CATALOG, JSON.stringify(cache));
  } catch {
    // 忽略写入失败（隐私模式等场景不该阻塞主流程）
  }
};

/**
 * 删除 per-repo 目录缓存（删除插件源时调用，避免留死数据）
 * @param repo 仓库全名
 */
export const removeCatalogCache = (repo: string): void => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_PLUGIN_MARKET_CATALOG);
    if (!raw) return;
    const cache = JSON.parse(raw) as CatalogCache;
    if (!(repo in cache)) return;
    delete cache[repo];
    appStorage.setItem(STORAGE_NS_PLUGIN_MARKET_CATALOG, JSON.stringify(cache));
  } catch {
    // 忽略清理失败
  }
};

/**
 * 只读缓存不发请求（编排层判断「哪些自定义源有缓存可直接刷」用）
 * @param repo 仓库全名
 * @returns 缓存目录；无有效缓存为 null
 */
export const peekCatalogCache = (repo: string): PluginMarketCatalog | null =>
  readCatalogCache(repo)?.catalog ?? null;

/**
 * 把一个 release 的 zip 资产解析为可安装版本
 * @param release 原始 release
 * @returns 版本列表（不合口径的资产已剔除）
 */
const parseReleaseVersions = (release: GitHubReleaseRaw): PluginMarketVersion[] => {
  const versions: PluginMarketVersion[] = [];
  for (const asset of release.assets) {
    const matched = PLUGIN_MARKET_ZIP_NAME_PATTERN.exec(asset.name);
    if (!matched) continue;
    versions.push({
      version: matched[2] ?? '',
      zipName: asset.name,
      zipSize: asset.size,
      downloadUrl: asset.browser_download_url,
      tag: release.tag_name,
      publishedAt: release.published_at ?? '',
      sha256: '',
      changelog: '',
    });
  }
  return versions;
};

/**
 * 把宽松解析出的增强条目整理成「id+version → 字段」查找表（字段缺失或类型不对即跳过）
 * @param raw 增强清单原始 JSON
 * @returns 查找表；不是对象 / 没有 plugins 数组时为空 Map
 */
const toEnhanceLookup = (raw: unknown): Map<string, EnhanceEntryRaw> => {
  const lookup = new Map<string, EnhanceEntryRaw>();
  if (typeof raw !== 'object' || raw === null) return lookup;
  const index = raw as EnhanceIndex;
  if (!Array.isArray(index.plugins)) return lookup;
  for (const entry of index.plugins) {
    if (typeof entry?.id !== 'string' || typeof entry?.version !== 'string') continue;
    lookup.set(`${entry.id}@${entry.version}`, entry);
  }
  return lookup;
};

/**
 * 用增强清单回填条目与版本的展示字段 / sha256 / changelog（就地修改）
 * @param entries 聚合后的条目
 * @param enhance 增强清单查找表
 */
const applyEnhancement = (
  entries: PluginMarketEntry[],
  enhance: Map<string, EnhanceEntryRaw>,
): void => {
  if (enhance.size === 0) return;
  for (const entry of entries) {
    for (const version of [entry.latest, ...entry.history]) {
      const hit = enhance.get(`${entry.id}@${version.version}`);
      if (!hit) continue;
      if (typeof hit.name === 'string' && hit.name.length > 0) entry.name = hit.name;
      if (typeof hit.description === 'string') entry.description = hit.description;
      if (typeof hit.author === 'string') entry.author = hit.author;
      if (typeof hit.sha256 === 'string') version.sha256 = hit.sha256;
      if (typeof hit.changelog === 'string') version.changelog = hit.changelog;
    }
  }
};

/** README 的一级标题（插件展示名） */
const README_TITLE_PATTERN = /^#\s+(.+)$/m;

/** README 的简介段口径：出包模板固定用「一句话：」开头 */
const README_ONELINER_PATTERN = /^一句话[：:]\s*(.+)$/m;

/**
 * 解码 contents API 的 base64 内容为 UTF-8 文本（中文 README 必须 TextDecoder，直接 atob 会乱码）
 * @param base64 base64 串（可能带换行）
 * @returns UTF-8 解码文本
 */
const decodeBase64Utf8 = (base64: string): string => {
  const binary = atob(base64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
};

/**
 * 提取 README 展示名（一级标题）
 * @param readme README 原文
 * @returns 标题文本；没有一级标题为空串
 */
const extractReadmeTitle = (readme: string): string =>
  README_TITLE_PATTERN.exec(readme)?.[1]?.trim() ?? '';

/**
 * 提取 README 简介：优先「一句话：」段（出包模板口径），回退首个正文段落；截断到上限
 * @param readme README 原文
 * @returns 纯文本描述；没有可用段落为空串
 */
const extractReadmeOneliner = (readme: string): string => {
  const oneliner = README_ONELINER_PATTERN.exec(readme)?.[1]?.trim();
  const raw =
    oneliner ??
    readme
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('#') && !line.startsWith('<')) ??
    '';
  const plain = raw.replace(/^[-*>]\s*/, '').replace(/[*`[\]]/g, '');
  return plain.length > PLUGIN_MARKET_README_EXCERPT_MAX
    ? `${plain.slice(0, PLUGIN_MARKET_README_EXCERPT_MAX)}…`
    : plain;
};

/**
 * 拉 contents API 里的单个源码文件（base64 → UTF-8 文本）
 * @param repo 仓库全名
 * @param id 插件 id
 * @param file 文件名
 * @param signal 外部取消信号
 * @returns 解码后的文本
 * @throws 非 base64 编码 / 请求失败时抛出
 */
const fetchContentsText = async (
  repo: string,
  id: string,
  file: string,
  signal?: AbortSignal,
): Promise<string> => {
  const payload = await httpGetJson<{ content?: string; encoding?: string }>(
    PLUGIN_MARKET_CONTENTS_FILE_API(repo, id, file),
    PLUGIN_MARKET_META_TIMEOUT_MS,
    signal,
  );
  if (payload.encoding !== 'base64' || !payload.content) {
    throw new Error('contents 响应不是 base64 编码');
  }
  return decodeBase64Utf8(payload.content);
};

/**
 * 源码元数据兜底：对增强后仍缺中文名 / 描述 / 作者的条目，从 contents API 拉源码仓库的
 * `plugins/<id>/manifest.json`（结构化元数据，index.json 的生成源）补齐；
 * manifest 缺名称或描述时再拉 README.md（`# 标题` + `一句话：` 段）兜底。
 *
 * 存在的理由：index.json 走 github.com 资产 CDN，部分网络环境不可达（实测）；
 * contents API 与 Releases 列表同在 api.github.com，可达性与主列表一致。
 * 每条目至多 2 次请求（manifest 必拉、README 按缺口），结果随目录缓存 1 小时。
 * @param entries 聚合后的条目（就地补齐缺空字段）
 * @param metaRepo 元数据所在仓库（官方源 = 源码仓库；第三方源 = 源自身，按 `plugins/<id>/` 布局约定）
 * @param signal 外部取消信号
 */
const applySourceMeta = async (
  entries: PluginMarketEntry[],
  metaRepo: string,
  signal?: AbortSignal,
): Promise<void> => {
  const pending = entries.filter(
    (entry) =>
      entry.name === entry.id || entry.description.length === 0 || entry.author.length === 0,
  );
  await Promise.allSettled(
    pending.map(async (entry) => {
      // ① manifest.json：结构化元数据（name / description / author）
      try {
        const manifest = JSON.parse(
          await fetchContentsText(metaRepo, entry.id, PLUGIN_MARKET_MANIFEST_FILE, signal),
        ) as Record<string, unknown>;
        if (typeof manifest === 'object' && manifest !== null) {
          if (entry.name === entry.id && typeof manifest.name === 'string' && manifest.name.length > 0) {
            entry.name = manifest.name;
          }
          if (
            entry.description.length === 0 &&
            typeof manifest.description === 'string' &&
            manifest.description.length > 0
          ) {
            entry.description = manifest.description;
          }
          if (entry.author.length === 0 && typeof manifest.author === 'string' && manifest.author.length > 0) {
            entry.author = manifest.author;
          }
        }
      } catch {
        // manifest 拉不到 / 解析失败：交给 README 兜底
      }
      // ② README.md：名称或描述仍有缺口时兜底
      if (entry.name === entry.id || entry.description.length === 0) {
        try {
          const readme = await fetchContentsText(metaRepo, entry.id, PLUGIN_MARKET_README_FILE, signal);
          const title = extractReadmeTitle(readme);
          if (title.length > 0 && entry.name === entry.id) entry.name = title;
          if (entry.description.length === 0) {
            const oneliner = extractReadmeOneliner(readme);
            if (oneliner.length > 0) entry.description = oneliner;
          }
        } catch {
          // README 也拉不到：保持 name=id、描述空串（与官网同款降级，不阻塞主流程）
        }
      }
    }),
  );
};

/**
 * 拉取一个源的插件目录（缓存优先 → Releases 列表 → 按 id 聚合 → index.json 增强）
 * @param repo 仓库全名 `owner/repo`
 * @param options 拉取选项（force 跳过新鲜缓存；signal 外部取消）
 * @returns 聚合后的插件目录
 * @throws 网络失败 / 限流且无过期缓存 / 仓库没有任何符合口径的产物时抛错（message 可直接展示）
 */
export const fetchSourceCatalog = async (
  repo: string,
  options?: FetchSourceCatalogOptions,
): Promise<PluginMarketCatalog> => {
  const cached = readCatalogCache(repo);
  if (!options?.force && cached && Date.now() - cached.at < PLUGIN_MARKET_CACHE_TTL_MS) {
    return cached.catalog;
  }
  try {
    const releases = await httpGetJson<GitHubReleaseRaw[]>(
      `${PLUGIN_MARKET_RELEASES_API(repo)}?per_page=${PLUGIN_MARKET_PER_PAGE}`,
      PLUGIN_MARKET_LIST_TIMEOUT_MS,
      options?.signal,
    );
    // 聚合依据：第一个带插件产物的正式 release（tag / 发布页取它；增强清单也只认它）
    const usable = releases.find(
      (item) => !item.draft && !item.prerelease && parseReleaseVersions(item).length > 0,
    );
    if (!usable) throw new Error('仓库 Releases 里没有符合口径的插件产物');
    const byId = new Map<string, PluginMarketVersion[]>();
    for (const release of releases) {
      if (release.draft || release.prerelease) continue;
      for (const version of parseReleaseVersions(release)) {
        const id = extractIdFromZip(version.zipName);
        const bucket = byId.get(id);
        if (bucket) bucket.push(version);
        else byId.set(id, [version]);
      }
    }
    const entries: PluginMarketEntry[] = [...byId.entries()]
      .map(([id, versions]) => {
        const sorted = [...versions].sort((a, b) => compareVersion(b.version, a.version));
        const [latest, ...rest] = sorted;
        return {
          id,
          name: id,
          description: '',
          author: '',
          sourceRepo: repo,
          builtinSource: repo === PLUGIN_MARKET_BUILTIN_REPO,
          latest: latest as PluginMarketVersion,
          history: rest,
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
    // index.json 增强通道：官方源补 sha256 / changelog / 展示名；第三方源通常没有，静默跳过
    try {
      const enhanceAsset = usable.assets.find(
        (asset) => asset.name === PLUGIN_MARKET_ENHANCE_ASSET_NAME,
      );
      if (enhanceAsset) {
        const enhance = await httpGetJson<unknown>(
          enhanceAsset.browser_download_url,
          PLUGIN_MARKET_ENHANCE_TIMEOUT_MS,
          options?.signal,
        );
        applyEnhancement(entries, toEnhanceLookup(enhance));
      }
    } catch {
      // 增强失败不阻塞主流程：条目保持「无校验」形态
    }
    // 源码元数据兜底（中文名 / 描述 / 作者）：走 api.github.com contents API，
    // 不依赖 github.com 资产 CDN（部分网络环境对后者不可达，实测）
    const metaRepo =
      repo === PLUGIN_MARKET_BUILTIN_REPO ? PLUGIN_MARKET_OFFICIAL_SOURCE_REPO : repo;
    await applySourceMeta(entries, metaRepo, options?.signal);
    // 条目级官方标记已在聚合时按 `PLUGIN_MARKET_BUILTIN_REPO` 标好
    const catalog: PluginMarketCatalog = {
      repo,
      tag: usable.tag_name,
      releaseUrl: usable.html_url,
      fetchedAt: Date.now(),
      entries,
    };
    writeCatalogCache(repo, catalog);
    return catalog;
  } catch (error) {
    // 限流 / 网络失败：有过期缓存就先兜底展示，绝不白屏
    if (cached) return cached.catalog;
    throw new Error(`${PLUGIN_MARKET_ERR_FETCH}（${toReason(error)}）`, { cause: error });
  }
};

/**
 * 从 zip 文件名提取插件 id（口径已在解析时校验过，这里只做纯提取）
 * @param zipName zip 产物文件名
 * @returns 插件 id
 */
const extractIdFromZip = (zipName: string): string =>
  PLUGIN_MARKET_ZIP_NAME_PATTERN.exec(zipName)?.[1] ?? zipName;

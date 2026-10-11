/**
 * 官网插件生态数据源：插件仓库 Releases 资产清单 + 各插件 README
 *
 * 缓存策略与 Releases API 一致（localStorage 1h TTL + 失败回退过期缓存）。
 * 插件数量 / 版本 / 大小由最新 Release 的 zip 资产动态决定；
 * 名称与描述从 contents API 的 README.md 补齐（失败降级展示 id）。
 * zip 下载直链只交给 <a> 标签使用（github.com 资产链不带 CORS 头，不能 fetch）。
 */
import {
  PLUGIN_CACHE_KEY,
  PLUGIN_CONTENTS_API_URL,
  PLUGIN_RELEASES_API_URL,
  PLUGIN_SOURCE_DIR,
  RELEASES_CACHE_TTL_MS,
} from '../constants/site.constants';
import type { GitHubReleaseAssetRaw, GitHubReleaseRaw } from '../types/release.types';
import type { PluginCard, PluginCatalog } from '../types/plugin.types';

/** 缓存载荷（localStorage JSON 结构） */
interface PluginCachePayload {
  at: number;
  catalog: PluginCatalog;
}

/** 插件产物 zip 文件名口径：`<插件id>-<x.y.z>.zip`（id 可含连字符，版本为三段数字） */
const ZIP_NAME_PATTERN = /^([a-z0-9][a-z0-9-]*?)-(\d+\.\d+\.\d+)\.zip$/i;

/** README 的一级标题（插件展示名） */
const README_TITLE_PATTERN = /^#\s+(.+)$/m;

/** README 的简介段口径：出包模板固定用「一句话：」开头 */
const README_ONELINER_PATTERN = /^一句话[：:]\s*(.+)$/m;

/**
 * 拉取插件生态数据（最新 Release 的 zip 资产 + 各插件 README 元数据）
 * @param options 拉取选项
 * @param options.force 为 true 时跳过新鲜缓存强制请求（后台刷新用）
 * @returns 归一化插件目录；fromCache 标识是否来自本地缓存
 * @throws API 失败 / 限流且无缓存 / 最新 Release 无插件产物时抛错（调用方渲染错误态）
 */
export async function fetchPluginCatalog(options?: { force?: boolean }): Promise<PluginCatalog & { fromCache: boolean }> {
  const cached = readPluginCache();
  if (!options?.force && cached && Date.now() - cached.at < RELEASES_CACHE_TTL_MS) {
    return { ...cached.catalog, fromCache: true };
  }
  try {
    const response = await fetch(`${PLUGIN_RELEASES_API_URL}?per_page=10`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`插件仓库 Releases API 响应异常（HTTP ${response.status}）`);
    const releases = (await response.json()) as GitHubReleaseRaw[];
    const catalog = await buildCatalogFromReleases(releases);
    writePluginCache({ at: Date.now(), catalog });
    return { ...catalog, fromCache: false };
  } catch (error) {
    // 限流 / 网络失败：有过期缓存就先兜底展示，绝不白屏
    if (cached) return { ...cached.catalog, fromCache: true };
    throw error instanceof Error ? error : new Error('插件清单拉取失败');
  }
}

/**
 * 从 Release 列表构建插件目录：取最新一个带插件 zip 产物的 Release，
 * 资产名解析出 id 与版本，再并行拉各插件 README 补名称与描述
 * @param releases Releases API 响应（默认按创建时间降序）
 * @returns 归一化插件目录
 */
async function buildCatalogFromReleases(releases: GitHubReleaseRaw[]): Promise<PluginCatalog> {
  const release = releases.find((item) => !item.draft && !item.prerelease && pickPluginAssets(item.assets).length > 0);
  if (!release) throw new Error('插件仓库最近 Release 里没有插件 zip 产物');
  const parsed = pickPluginAssets(release.assets)
    .map(parsePluginAsset)
    .filter((card): card is PluginCard => card !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
  if (parsed.length === 0) throw new Error('插件产物文件名都不符合 <id>-<版本>.zip 口径');
  // README 元数据逐插件并行补齐（单个失败不影响整页，仅该卡降级展示 id）
  await Promise.allSettled(parsed.map(async (card) => applyReadmeMeta(card)));
  return {
    tag: release.tag_name,
    releaseUrl: release.html_url,
    publishedAt: release.published_at ?? '',
    plugins: parsed,
  };
}

/**
 * 从一个 Release 的资产里筛出插件 zip 产物
 * @param assets Release 资产数组
 * @returns 插件 zip 资产（排除 index.json 等非插件文件）
 */
function pickPluginAssets(assets: GitHubReleaseAssetRaw[]): GitHubReleaseAssetRaw[] {
  return assets.filter((asset) => ZIP_NAME_PATTERN.test(asset.name));
}

/**
 * 把 zip 资产解析为插件卡（名称与描述先置空，由 README 元数据补齐）
 * @param asset 插件 zip 资产
 * @returns 插件卡；文件名不合口径返回 null
 */
function parsePluginAsset(asset: GitHubReleaseAssetRaw): PluginCard | null {
  const matched = ZIP_NAME_PATTERN.exec(asset.name);
  if (!matched) return null;
  return {
    id: matched[1] ?? asset.name,
    name: matched[1] ?? asset.name,
    version: matched[2] ?? '',
    description: '',
    zipName: asset.name,
    zipSize: asset.size,
    downloadUrl: asset.browser_download_url,
  };
}

/**
 * 就地补齐插件卡的名称与描述（README.md；任何失败都静默降级为 id）
 * @param card 插件卡
 */
async function applyReadmeMeta(card: PluginCard): Promise<void> {
  try {
    const response = await fetch(`${PLUGIN_CONTENTS_API_URL}/${PLUGIN_SOURCE_DIR}/${card.id}/README.md`);
    if (!response.ok) return;
    const payload = (await response.json()) as { content?: string; encoding?: string };
    if (payload.encoding !== 'base64' || !payload.content) return;
    const readme = decodeBase64Utf8(payload.content);
    const title = README_TITLE_PATTERN.exec(readme)?.[1]?.trim();
    if (title) card.name = title;
    const description = extractFirstParagraph(readme);
    if (description) card.description = description;
  } catch {
    // README 拉不到：保持 name=id、description 空串
  }
}

/**
 * 提取 README 简介：优先「一句话：」段（出包模板口径），回退首个正文段落；截断到 120 字
 * @param readme README 原文
 * @returns 描述文案；没有可用段落时为空串
 */
function extractFirstParagraph(readme: string): string {
  const oneliner = README_ONELINER_PATTERN.exec(readme)?.[1]?.trim();
  if (oneliner) return toPlainExcerpt(oneliner);
  const paragraph = readme
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#') && !line.startsWith('<'))
    .map((line) => line.replace(/^[-*>]\s*/, ""))
    .find((line) => line.length > 0);
  return paragraph ? toPlainExcerpt(paragraph) : '';
}

/**
 * 清理段落里的行内 markdown 标记并截断
 * @param raw 段落原文
 * @returns 纯文本描述（超 120 字截断）
 */
function toPlainExcerpt(raw: string): string {
  const plain = raw.replace(/[*`[\]]/g, "");
  return plain.length > 120 ? `${plain.slice(0, 120)}…` : plain;
}

/**
 * 解码 contents API 的 base64 内容为 UTF-8 文本（中文 README 必须 TextDecoder，直接 atob 会乱码）
 * @param base64 base64 串（可能带换行）
 * @returns UTF-8 解码文本
 */
function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * 读本地缓存
 * @returns 缓存载荷；缺失或损坏返回 null
 */
function readPluginCache(): PluginCachePayload | null {
  try {
    const raw = localStorage.getItem(PLUGIN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PluginCachePayload;
    if (!parsed.catalog || !Array.isArray(parsed.catalog.plugins) || typeof parsed.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 写本地缓存（写失败静默忽略——隐私模式等场景不该阻塞主流程）
 * @param payload 缓存载荷
 */
function writePluginCache(payload: PluginCachePayload): void {
  try {
    localStorage.setItem(PLUGIN_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // 忽略写入失败
  }
}

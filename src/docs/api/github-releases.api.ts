/**
 * GitHub Releases API 客户端（匿名，无鉴权）
 *
 * 缓存策略：localStorage 1 小时 TTL——新鲜缓存直接用；过期缓存先返回再由调用方
 * 后台刷新（stale-while-revalidate）；请求失败时回退过期缓存，无缓存才抛错。
 * 背景见边界定论：匿名限额 60 次/h/IP，官网流量上来后必然触发限流。
 */
import {
  MIN_DOWNLOAD_VERSION,
  RELEASES_API_URL,
  RELEASES_CACHE_KEY,
  RELEASES_CACHE_TTL_MS,
  RELEASES_PER_PAGE,
} from '../constants/site.constants';
import type { AppRelease, GitHubReleaseRaw, ReleasesResult, SiteVersion } from '../types/release.types';
import { classifyReleaseAsset } from '../utils/release-asset.utils';
import { extractReleaseNotes } from '../utils/release-notes.utils';
import { compareVersion, parseVersionTag } from '../utils/semver.utils';

/** 缓存载荷（localStorage JSON 结构；缓存里只放可序列化的归一化结果） */
interface ReleasesCachePayload {
  at: number;
  releases: AppRelease[];
  totalTagCount: number;
}

/**
 * 拉取可下载版本列表（v3.0.0+，semver 降序，过滤 draft / prerelease）
 * @param options 拉取选项
 * @param options.force 为 true 时跳过新鲜缓存强制请求（后台刷新用）
 * @returns 归一化结果；fromCache 标识是否来自本地缓存
 * @throws 网络失败 / 限流且无可用缓存时抛错（调用方渲染错误态）
 */
export async function fetchAppReleases(options?: { force?: boolean }): Promise<ReleasesResult> {
  const cached = readReleasesCache();
  if (!options?.force && cached && Date.now() - cached.at < RELEASES_CACHE_TTL_MS) {
    return toResult(cached.releases, cached.totalTagCount, true, cached.at);
  }
  try {
    const response = await fetch(`${RELEASES_API_URL}?per_page=${RELEASES_PER_PAGE}`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`GitHub Releases API 响应异常（HTTP ${response.status}）`);
    const raw = (await response.json()) as GitHubReleaseRaw[];
    const minVersion = parseVersionTag(MIN_DOWNLOAD_VERSION);
    if (!minVersion) throw new Error('MIN_DOWNLOAD_VERSION 常量不是合法版本号');
    const releases = normalizeReleases(raw, minVersion);
    writeReleasesCache({ at: Date.now(), releases, totalTagCount: raw.length });
    return toResult(releases, raw.length, false, null);
  } catch (error) {
    // 限流 / 网络失败：有过期缓存就先兜底展示，绝不白屏
    if (cached) return toResult(cached.releases, cached.totalTagCount, true, cached.at);
    throw error instanceof Error ? error : new Error('GitHub Releases 拉取失败');
  }
}

/**
 * 只读本地缓存，不发起请求（轻量场景用，如文档页展示「同步至 vX.Y.Z」）
 * @returns 缓存结果；无缓存为 null
 */
export function peekReleasesCache(): ReleasesResult | null {
  const cached = readReleasesCache();
  return cached ? toResult(cached.releases, cached.totalTagCount, true, cached.at) : null;
}

/**
 * 归一化原始响应：过滤 draft / prerelease 与 v3.0.0 之前的版本，按 semver 降序
 * @param raw 原始响应数组
 * @param minVersion 可下载的最低版本
 * @returns 归一化版本组（降序）
 */
function normalizeReleases(raw: GitHubReleaseRaw[], minVersion: SiteVersion): AppRelease[] {
  const releases: AppRelease[] = [];
  for (const item of raw) {
    if (item.draft || item.prerelease) continue;
    const version = parseVersionTag(item.tag_name);
    if (!version || compareVersion(version, minVersion) < 0) continue;
    releases.push({
      tag: item.tag_name,
      version,
      publishedAt: item.published_at ?? '',
      htmlUrl: item.html_url,
      notes: extractReleaseNotes(item.body),
      packages: item.assets
        .map(classifyReleaseAsset)
        .filter((pkg): pkg is NonNullable<typeof pkg> => pkg !== null),
    });
  }
  return releases.sort((a, b) => compareVersion(b.version, a.version));
}

/**
 * 组装结果结构
 * @param releases 版本组
 * @param totalTagCount 仓库全部 tag 数
 * @param fromCache 是否来自缓存
 * @param cachedAt 缓存时间
 * @returns 拉取结果
 */
function toResult(releases: AppRelease[], totalTagCount: number, fromCache: boolean, cachedAt: number | null): ReleasesResult {
  return { releases, totalTagCount, fromCache, cachedAt };
}

/**
 * 读本地缓存
 * @returns 缓存载荷；缺失或损坏返回 null
 */
function readReleasesCache(): ReleasesCachePayload | null {
  try {
    const raw = localStorage.getItem(RELEASES_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ReleasesCachePayload;
    if (!Array.isArray(parsed.releases) || typeof parsed.at !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 写本地缓存（写失败静默忽略——隐私模式等场景不该阻塞主流程）
 * @param payload 缓存载荷
 */
function writeReleasesCache(payload: ReleasesCachePayload): void {
  try {
    localStorage.setItem(RELEASES_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // 忽略写入失败
  }
}

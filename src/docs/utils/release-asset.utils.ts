/**
 * Release 资产归类：按文件名识别安装包形态与平台
 */
import type { GitHubReleaseAssetRaw, ReleasePackage, ReleasePackageKind, ReleasePlatform } from '../types/release.types';

/**
 * 按文件名归类一个安装包；不属于已知形态的资产（latest.json、校验文件等）返回 null
 * @param asset GitHub 原始资产
 * @returns 归一化安装包；无法识别时为 null
 */
export function classifyReleaseAsset(asset: GitHubReleaseAssetRaw): ReleasePackage | null {
  const name = asset.name.toLowerCase();
  if (name.endsWith('.apk')) return buildPackage('android', 'apk', asset);
  if (name.endsWith('.msi')) return buildPackage('windows', 'msi', asset);
  if (name.endsWith('.exe') && name.includes('setup')) return buildPackage('windows', 'nsis', asset);
  return null;
}

/**
 * 安装包排序（默认展示顺序）：Windows 安装向导 → MSI → APK
 * @param packages 待排序安装包
 * @returns 新数组（不改入参顺序）
 */
export function sortReleasePackages(packages: readonly ReleasePackage[]): ReleasePackage[] {
  const order: Record<ReleasePackageKind, number> = { nsis: 0, msi: 1, apk: 2 };
  return [...packages].sort((a, b) => order[a.kind] - order[b.kind]);
}

/**
 * 按访问端平台把该平台的安装包排到最前（推荐位）
 * @param packages 待排序安装包
 * @param platform 访问端平台（other 时不调整）
 * @returns 新数组（不改入参顺序）
 */
export function orderByVisitorPlatform(packages: readonly ReleasePackage[], platform: ReleasePlatform | 'other'): ReleasePackage[] {
  const sorted = sortReleasePackages(packages);
  if (platform === 'other') return sorted;
  return [...sorted].sort((a, b) => Number(b.platform === platform) - Number(a.platform === platform));
}

/**
 * 归一化构建安装包结构
 * @param platform 平台
 * @param kind 安装包形态
 * @param asset GitHub 原始资产
 * @returns 归一化安装包
 */
function buildPackage(platform: ReleasePlatform, kind: ReleasePackageKind, asset: GitHubReleaseAssetRaw): ReleasePackage {
  return {
    platform,
    kind,
    fileName: asset.name,
    sizeBytes: asset.size,
    downloadCount: asset.download_count,
    url: asset.browser_download_url,
  };
}

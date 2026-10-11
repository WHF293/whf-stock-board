/**
 * 官网下载中心的数据类型
 *
 * GitHub Releases 原始响应字段保持上游 snake_case；归一化结构（AppRelease /
 * ReleasePackage）供视图消费，避免上游字段名漏进组件层。
 */

/** 语义化版本号（仅 x.y.z 三段） */
export interface SiteVersion {
  major: number;
  minor: number;
  patch: number;
}

/** 下载包所属平台 */
export type ReleasePlatform = 'windows' | 'android';

/** 安装包形态：NSIS 安装向导 / MSI 部署包 / Android 直装 APK */
export type ReleasePackageKind = 'nsis' | 'msi' | 'apk';

/** 归一化后的安装包（一个可下载文件） */
export interface ReleasePackage {
  platform: ReleasePlatform;
  kind: ReleasePackageKind;
  fileName: string;
  sizeBytes: number;
  downloadCount: number;
  url: string;
}

/** 归一化后的版本组（对应一个 GitHub Release） */
export interface AppRelease {
  tag: string;
  version: SiteVersion;
  publishedAt: string;
  htmlUrl: string;
  notes: string[];
  packages: ReleasePackage[];
}

/** GitHub Release 原始资产（仅取本站用到的字段，snake_case 与上游一致） */
export interface GitHubReleaseAssetRaw {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

/** GitHub Release 原始响应（仅取本站用到的字段，snake_case 与上游一致） */
export interface GitHubReleaseRaw {
  tag_name: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  html_url: string;
  body: string | null;
  assets: GitHubReleaseAssetRaw[];
}

/** Releases 拉取结果：可下载版本列表 + 仓库全部 tag 数（首页统计用） */
export interface ReleasesResult {
  releases: AppRelease[];
  totalTagCount: number;
  /** 本次结果是否来自本地缓存（过期缓存由调用方决定是否后台刷新） */
  fromCache: boolean;
  /** 缓存写入时间（毫秒时间戳；非缓存来源为 null） */
  cachedAt: number | null;
}

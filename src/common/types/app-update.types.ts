/**
 * 应用自动更新（GitHub Releases）类型定义
 */

/** GitHub Release 中可执行的 NSIS 安装包资产信息 */
export interface ReleaseAssetInfo {
  /** 资产 id（GitHub API 标识） */
  assetId: number;
  /** 文件名（如 stock-board_3.0.2_x64-setup.exe） */
  name: string;
  /** 下载地址（browser_download_url，开源仓库免鉴权） */
  downloadUrl: string;
  /** 文件字节数（下载完整性校验用） */
  size: number;
}

/** 检测到的最新 Release（仅解析本应用关心的字段） */
export interface LatestReleaseInfo {
  /** 最新版本号（tag 去掉 v 前缀，如 3.0.3） */
  version: string;
  /** 对应的 NSIS 安装包资产（缺失时调用方按检测失败处理） */
  asset: ReleaseAssetInfo;
}

/** 更新状态机的状态 */
export type AppUpdateStatus =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing';

/** GitHub release JSON 响应中本应用关心的字段（其余字段不解析） */
export interface GithubReleasePayload {
  /** 版本 tag（如 v3.0.3） */
  tag_name?: string;
  /** 附件资产清单（安装包在其中） */
  assets?: GithubReleaseAssetPayload[];
}

/** GitHub release JSON 响应中的单个资产 */
export interface GithubReleaseAssetPayload {
  /** 资产 id */
  id?: number;
  /** 文件名 */
  name?: string;
  /** 下载地址 */
  browser_download_url?: string;
  /** 字节数 */
  size?: number;
}

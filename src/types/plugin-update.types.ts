/**
 * 插件在线更新的类型契约（宿主 ↔ 官方插件仓库 `index.json`）
 *
 * 消费策略是「多余字段不消费」：反序列化只取认识的字段，将来清单加字段
 * 不影响老版本 app。反过来，`sha256` / `changelog` / `author` 是**可选**字段 ——
 * 手写清单与旧清单没有它们也要能跑（见 constants 里的「可选校验」口径）。
 */

/** 清单里的一个插件条目（CI 由 manifest.json + zip 产物生成） */
export interface PluginUpdateIndexEntry {
  /** 插件 id：更新匹配的唯一键（永远不要用包名 / 文件名 / 展示名匹配） */
  id: string;
  /** 展示名 */
  name: string;
  /** 语义化版本 */
  version: string;
  /** 一句话说明（manifest 原文） */
  description: string;
  /** 作者（可选，缺省空串） */
  author?: string;
  /** 安装包文件名 `<id>-<version>.zip` */
  zipName: string;
  /** 字节数 */
  zipSize: number;
  /** zip 的 SHA-256 十六进制小写（可选：有则校验，无则跳过） */
  sha256?: string;
  /** 绝对直链 `https://github.com/<repo>/releases/download/<tag>/<zipName>` */
  downloadUrl: string;
  /** 本次更新说明（可选，一期 CI 填空串） */
  changelog?: string;
}

/** 更新清单（index.json 顶层结构） */
export interface PluginUpdateIndex {
  /** 契约版本（≠ PLUGIN_UPDATE_SCHEMA_VERSION 视为不可用） */
  schemaVersion: number;
  /** 生成时刻（ISO 8601 UTC） */
  generatedAt: string;
  /** `owner/repo` */
  repo: string;
  /** 本 Release 的 tag（zip 直链钉在它上面，不能用会漂移的 latest） */
  tag: string;
  /** 本 Release 页面地址 */
  releaseUrl: string;
  /** 插件条目 */
  plugins: PluginUpdateIndexEntry[];
}

/**
 * 一个「可更新」项：清单条目与本地已装记录合并后的形态
 *
 * `currentVersion` 来自本地 `UserPluginRecord.version`，其余来自清单 ——
 * UI 拿它就能直接渲染「v1.0.0 → v1.1.0」，不必再自己拼。
 */
export interface PluginUpdateCandidate {
  /** 插件 id */
  id: string;
  /** 展示名（清单为准，与本地同名） */
  name: string;
  /** 本地已安装版本 */
  currentVersion: string;
  /** 清单里的最新版本 */
  latestVersion: string;
  /** 一句话说明 */
  description: string;
  /** 作者（缺省空串） */
  author: string;
  /** 安装包文件名 */
  zipName: string;
  /** 字节数 */
  zipSize: number;
  /** zip 的 SHA-256（空串 = 清单没给，跳过校验） */
  sha256: string;
  /** 直链 */
  downloadUrl: string;
  /** 更新说明（空串 = 没有） */
  changelog: string;
  /** 本次 Release 页面地址（确认弹窗「查看更新说明」用） */
  releaseUrl: string;
}

/** 检查更新的状态（提示条据此渲染四种形态） */
export type PluginUpdateCheckStatus = 'idle' | 'checking' | 'latest' | 'updatable' | 'fail';

/** 批量更新的结果 */
export interface PluginUpdateSummary {
  /** 成功更新个数 */
  updated: number;
  /** 失败个数 */
  failed: number;
}

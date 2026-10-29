/**
 * 插件市场的类型契约（多源 GitHub Releases → 插件卡）
 *
 * 数据模型分三层：
 * - `PluginMarketSource`：插件源（一个 GitHub 仓库），持久化的用户配置；
 * - `PluginMarketVersion`：某个 release 资产解析出的**一个可装版本**（不可变，钉在 tag 上）；
 * - `PluginMarketEntry`：一个插件在某源下的**聚合形态**（最新版 + 历史版本），
 *   由 API 层按 zip 文件名口径 `<id>-<版本>.zip` 解析聚合，UI 直接消费。
 *
 * 与更新清单（`plugin-update.types.ts`）的关系：官方源的 `index.json` 只作
 * sha256 / changelog 的**增强通道**（缺失时字段为空串、跳过校验），不是市场的主数据。
 */

/** 一个插件源（GitHub 仓库） */
export interface PluginMarketSource {
  /** 仓库全名 `owner/repo`（唯一键；内置官方源同样用它寻址） */
  repo: string;
  /** 展示名（自定义源添加时可自定义；缺省取 repo） */
  label: string;
  /** 是否内置官方源（不可删除；应用升级可更新其指向） */
  builtin: boolean;
  /** 添加时间（ISO 8601；内置源为空串） */
  addedAt: string;
}

/** 某个 release 资产解析出的一个可安装版本 */
export interface PluginMarketVersion {
  /** 语义化版本（从 zip 文件名解析，不带 v 前缀） */
  version: string;
  /** zip 产物文件名 */
  zipName: string;
  /** zip 字节数（Releases 资产的 size） */
  zipSize: number;
  /** 下载直链（钉在具体 tag 的 release 资产上，内容不可变） */
  downloadUrl: string;
  /** 所属 release 的 tag（「查看发布页」导流用） */
  tag: string;
  /** 发布时间（ISO 8601；上游缺失为空串） */
  publishedAt: string;
  /** zip 的 SHA-256 十六进制小写（index.json 增强命中才有；否则空串 = 跳过校验） */
  sha256: string;
  /** 版本说明（index.json 增强命中才有；否则空串） */
  changelog: string;
}

/** 一个插件在某个源下的聚合形态（最新版 + 历史版本） */
export interface PluginMarketEntry {
  /** 插件 id（zip 文件名解析；安装匹配与覆盖判定的唯一键） */
  id: string;
  /** 展示名（index.json 增强命中用其 name；否则用 id） */
  name: string;
  /** 一句话描述（index.json 增强命中才有；否则空串） */
  description: string;
  /** 作者（index.json 增强命中才有；否则空串） */
  author: string;
  /** 来自哪个源（`owner/repo`） */
  sourceRepo: string;
  /** 是否来自内置官方源（UI 标「官方」用） */
  builtinSource: boolean;
  /** 聚合出的最新版本 */
  latest: PluginMarketVersion;
  /** 历史版本（不含 latest；按版本号降序） */
  history: readonly PluginMarketVersion[];
}

/** 单个源的拉取结果（编排层合并多源前 per-repo 暂存） */
export interface PluginMarketCatalog {
  /** 源仓库全名 */
  repo: string;
  /** 聚合依据的最新一个可用 release 的 tag */
  tag: string;
  /** 该 release 的 GitHub 页面地址 */
  releaseUrl: string;
  /** 拉取完成时刻（毫秒时间戳，缓存 TTL 判定用） */
  fetchedAt: number;
  /** 插件条目（已按 id 聚合、latest 降序排好） */
  entries: PluginMarketEntry[];
}

/** 单个源的加载状态（UI 按源分桶渲染） */
export type PluginMarketRepoState = 'idle' | 'loading' | 'ready' | 'fail';

/** 市场安装动作的进行中标记（全局串行：同一时刻至多一个） */
export interface PluginMarketInstallingKey {
  /** 插件 id */
  id: string;
  /** 正在安装的版本号 */
  version: string;
}

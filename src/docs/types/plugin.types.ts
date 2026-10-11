/**
 * 官网「插件生态」页的数据类型
 *
 * 数据源是插件仓库（stock-board-plugin）的 GitHub Releases 资产清单：
 * 出包脚本把 `<插件id>-<版本>.zip` 随 Release 发布，插件数量 / 版本 / 大小全部动态，
 * 官网不内置任何插件清单。名称与描述从仓库 `plugins/<id>/README.md` 补齐
 * （contents API，拉不到时降级展示 id）。
 *
 * 注意：release 资产本体（含 index.json）从浏览器 fetch 会被 CORS 拦截
 * （github.com / S3 重定向链不带 ACAO），因此数据只取自
 * api.github.com（CORS 友好）；zip 下载直链交给 <a> 标签，不受此限制。
 */

/** 官网插件卡片的归一化数据 */
export interface PluginCard {
  /** 插件 id（如 dsh-mainline，从 zip 文件名解析） */
  id: string;
  /** 插件展示名（README 标题；拉不到时用 id） */
  name: string;
  /** 插件自身版本（如 1.0.0，从 zip 文件名解析） */
  version: string;
  /** 一句话描述（README 首段；拉不到时为空串） */
  description: string;
  /** zip 产物文件名 */
  zipName: string;
  /** zip 产物字节数（Releases API 资产的 size） */
  zipSize: number;
  /** 最新版 zip 下载直链（供 <a> 下载，不能用于 fetch） */
  downloadUrl: string;
}

/** 官网插件页的归一化数据 */
export interface PluginCatalog {
  /** 产物对应的插件仓库 release tag（如 v1.3.2） */
  tag: string;
  /** 该 release 的 GitHub 页（「历史版本」导流目标） */
  releaseUrl: string;
  /** 产物发布时间（ISO 串） */
  publishedAt: string;
  /** 插件清单（按插件 id 字母序） */
  plugins: PluginCard[];
}

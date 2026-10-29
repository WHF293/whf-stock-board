/**
 * 官网静态配置单源：仓库标识、下载范围、分页与缓存阈值、外链、文档 Tab 归组。
 * 禁止在组件里散落同类字面量。
 */
import type { ReleasePackageKind, ReleasePlatform } from '../types/release.types';

/** 仓库归属（Releases API 与外链都从这里拼） */
export const SITE_REPO_OWNER = 'WHF293';

/** 仓库名（同时是 GitHub Pages 项目站子路径） */
export const SITE_REPO_NAME = 'whf-stock-board';

/** GitHub 仓库主页 */
export const SITE_REPO_URL = `https://github.com/${SITE_REPO_OWNER}/${SITE_REPO_NAME}`;

/** GitHub Releases 列表页（限流兜底与页脚外跳入口） */
export const SITE_RELEASES_URL = `${SITE_REPO_URL}/releases`;

/** GitHub Issues（页脚「问题反馈」） */
export const SITE_ISSUES_URL = `${SITE_REPO_URL}/issues`;

/** 官方插件仓库（曾用名 tauri-plugin 已更名；官方插件源码与 zip 产物在此） */
export const PLUGIN_REPO_OWNER = 'jx62257070';

/** 插件仓库名 */
export const PLUGIN_REPO_NAME = 'stock-board-plugin';

/** 插件仓库主页（插件页「历史版本 / 源码」导流目标） */
export const PLUGIN_REPO_URL = `https://github.com/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}`;

/** 插件仓库 Releases 匿名 API（官网插件页数据源：Release 资产清单 + 各插件 README） */
export const PLUGIN_RELEASES_API_URL = `https://api.github.com/repos/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}/releases`;

/** 插件仓库 Contents 匿名 API（拉 plugins/<id>/README.md 补插件名与描述） */
export const PLUGIN_CONTENTS_API_URL = `https://api.github.com/repos/${PLUGIN_REPO_OWNER}/${PLUGIN_REPO_NAME}/contents`;

/** 插件仓库内插件源码目录名 */
export const PLUGIN_SOURCE_DIR = 'plugins';

/** 插件索引本地缓存 key（localStorage） */
export const PLUGIN_CACHE_KEY = 'whf-site:plugins';

/** GitHub Releases 匿名 API（匿名限额 60 次/h/IP，客户端走 1h 缓存兜底） */
export const RELEASES_API_URL = `https://api.github.com/repos/${SITE_REPO_OWNER}/${SITE_REPO_NAME}/releases`;

/** Releases API 单页条数（一次拉全量，前端过滤 + 分页） */
export const RELEASES_PER_PAGE = 100;

/** 下载范围（用户定论）：仅提供 v3.0.0 及之后的版本，更早版本不下载也不展示 */
export const MIN_DOWNLOAD_VERSION = '3.0.0';

/** 历史版本分页：每页版本组数 */
export const RELEASE_PAGE_SIZE = 5;

/** Releases 本地缓存 key（localStorage） */
export const RELEASES_CACHE_KEY = 'whf-site:releases';

/** Releases 本地缓存 TTL（1 小时；GitHub 匿名限额 60 次/h/IP） */
export const RELEASES_CACHE_TTL_MS = 60 * 60 * 1000;

/** 文档搜索：每章最多展示的命中条数（与客户端白皮书同款阈值） */
export const DOCS_HITS_PER_CHAPTER = 6;

/** 文档搜索：命中总条数上限（与客户端白皮书同款阈值） */
export const DOCS_HITS_TOTAL_LIMIT = 60;

/** 文档 Tab 选项（与客户端白皮书的 DOC_TABS 一致） */
export const DOCS_TABS = [
  { label: '使用说明', value: 'user' },
  { label: '开发者指南', value: 'dev' },
] as const;

/** 文档 Tab 值 */
export type DocsTabValue = (typeof DOCS_TABS)[number]['value'];

/**
 * 归入「开发者指南」Tab 的章节 id（与客户端白皮书 DEV_CHAPTER_IDS 一致）
 */
export const DOCS_DEV_CHAPTER_IDS: ReadonlySet<string> = new Set<string>([
  'dev',
  'dev-api',
  'dev-data',
  'dev-market',
]);

/**
 * 文档目录分组顺序（镜像应用侧栏的分组惯例：市场行情 / 热点资讯 / 自选与账户 / 插件）
 *
 * 不在侧栏路由里的章节统一归「二级页」组；未收录进此数组的 tag 按出现顺序追加在后。
 */
export const DOCS_GROUP_ORDER: readonly string[] = [
  '必读',
  '市场行情',
  '热点资讯',
  '自选与账户',
  '插件',
  '二级页',
  '开发者',
];

/** 平台展示名 */
export const RELEASE_PLATFORM_LABELS = {
  windows: 'Windows 10+ · x64',
  android: 'Android 8.0+ · arm64',
} as const satisfies Record<ReleasePlatform, string>;

/** 安装包形态展示名 */
export const RELEASE_KIND_LABELS = {
  nsis: 'Windows 安装向导（NSIS）',
  msi: 'Windows MSI 部署包',
  apk: 'Android 直装 APK（已签名）',
} as const satisfies Record<ReleasePackageKind, string>;

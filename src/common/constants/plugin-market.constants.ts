/**
 * 插件市场常量（多源 GitHub Releases 取数 / 源管理 / 全部用户可见文案）
 *
 * 与 `plugin-update.constants.ts` 的分工：更新链路只认官方分发仓库的 `index.json`
 * 固定清单；市场的主数据走**任意源的 Releases 资产解析**，`index.json` 仅为官方源的
 * 增强通道。内置官方源与更新链路同仓库（`PLUGIN_UPDATE_REPO`）——否则市场装的版本
 * 与「检查更新」提示的版本序列 / sha256 对不上。
 */

import { PLUGIN_UPDATE_REPO } from './plugin-update.constants.ts';

/** 内置官方插件源（不可删除；与在线更新链路同仓库） */
export const PLUGIN_MARKET_BUILTIN_REPO = PLUGIN_UPDATE_REPO;

/** 内置官方源的展示名 */
export const PLUGIN_MARKET_BUILTIN_LABEL = '官方插件市场';

/**
 * 官方插件**源码仓库**（源码元数据兜底的取数仓库）
 *
 * 内置官方源指向分发仓库（release 资产所在），但它的仓库内容不含插件源码；
 * manifest.json / README.md（中文名 / 描述 / 作者）在源码仓库 `plugins/<id>/` 下。
 */
export const PLUGIN_MARKET_OFFICIAL_SOURCE_REPO = 'jx62257070/stock-board-plugin';

/** 插件源码在仓库内的目录（第三方源按同布局约定：`<repo>/plugins/<id>/`） */
export const PLUGIN_MARKET_PLUGIN_DIR = 'plugins';

/** 插件清单文件名（结构化元数据：name / description / author；index.json 的生成源） */
export const PLUGIN_MARKET_MANIFEST_FILE = 'manifest.json';

/** 插件说明文件名（manifest 缺描述时的兜底：`# 标题` + `一句话：` 段） */
export const PLUGIN_MARKET_README_FILE = 'README.md';

/**
 * 源码元数据的 contents API（单文件）
 * @param repo 仓库全名（官方源用源码仓库）
 * @param id 插件 id
 * @param file 文件名（manifest.json / README.md）
 * @returns API 地址
 */
export const PLUGIN_MARKET_CONTENTS_FILE_API = (
  repo: string,
  id: string,
  file: string,
): string => `https://api.github.com/repos/${repo}/contents/${PLUGIN_MARKET_PLUGIN_DIR}/${id}/${file}`;

/** 源码元数据请求超时（毫秒；兜底通道失败静默跳过，不能拖慢主流程） */
export const PLUGIN_MARKET_META_TIMEOUT_MS = 8_000;

/** README 简介截断长度（字符） */
export const PLUGIN_MARKET_README_EXCERPT_MAX = 120;

/**
 * Releases 列表 API（匿名，CORS 友好）
 * @param repo 仓库全名 `owner/repo`
 * @returns API 地址
 */
export const PLUGIN_MARKET_RELEASES_API = (repo: string): string =>
  `https://api.github.com/repos/${repo}/releases`;

/** 单次拉取的 release 页大小（最近 10 个批次，覆盖全部历史插件版本） */
export const PLUGIN_MARKET_PER_PAGE = 10;

/** 目录缓存 TTL（毫秒；per-repo 一小时，与官网插件生态页口径一致） */
export const PLUGIN_MARKET_CACHE_TTL_MS = 60 * 60 * 1000;

/** Releases 列表请求超时（毫秒） */
export const PLUGIN_MARKET_LIST_TIMEOUT_MS = 10_000;

/** 增强清单（index.json）下载超时（毫秒；增强失败静默跳过，不能拖慢主流程） */
export const PLUGIN_MARKET_ENHANCE_TIMEOUT_MS = 8_000;

/** 多源并发拉取的并发上限（频率红线惯例：同一上游连续请求 ≤3） */
export const PLUGIN_MARKET_LOAD_CONCURRENCY = 3;

/** 多源顺序错峰间隔（毫秒；降低对 api.github.com 的瞬时压力） */
export const PLUGIN_MARKET_LOAD_STAGGER_MS = 500;

/** 自定义源数量上限（防限流放大：每源每次打开至少 1 次 Releases 请求） */
export const PLUGIN_MARKET_SOURCE_MAX = 10;

/** 插件产物 zip 文件名口径：`<插件id>-<x.y.z>.zip`（id 可含连字符，版本三段数字） */
export const PLUGIN_MARKET_ZIP_NAME_PATTERN = /^([a-z0-9][a-z0-9-]*?)-(\d+\.\d+\.\d+)\.zip$/i;

/** 增强清单资产名（官方出包脚本随最新 release 发布的 index.json） */
export const PLUGIN_MARKET_ENHANCE_ASSET_NAME = 'index.json';

// ——— 风险提示 ———

/** 市场顶部常驻风险提示（与安装弹窗同口径，补第三方源说明） */
export const PLUGIN_MARKET_RISK_NOTICE =
  '插件代码会以与应用相同的权限运行，请只安装来源可信的插件；第三方源的插件无官方校验，添加前请自行确认仓库可信。';

/**
 * 添加第三方源的确认正文
 * @param repo 仓库全名
 * @returns 确认文案
 */
export const PLUGIN_MARKET_SOURCE_ADD_CONFIRM = (repo: string): string =>
  `添加后将允许从 ${repo} 的 GitHub Releases 下载并执行插件代码（与应用同权限）。请确认该仓库来源可信，是否添加？`;

// ——— 源管理文案 ———

/** 源管理面板标题 */
export const PLUGIN_MARKET_SOURCE_PANEL_TITLE = '管理插件源';

/** 源管理面板的说明 */
export const PLUGIN_MARKET_SOURCE_PANEL_HINT =
  '插件市场从每个源的 GitHub Releases 读取插件产物（<插件id>-<版本>.zip）。官方源不可删除；自定义源最多 10 个。';

/** 添加源输入框占位文案 */
export const PLUGIN_MARKET_SOURCE_INPUT_PLACEHOLDER = 'owner/repo 或 GitHub 仓库地址';

/** 添加源按钮 */
export const PLUGIN_MARKET_SOURCE_ADD_LABEL = '添加源';

/** 源条目的官方徽标 */
export const PLUGIN_MARKET_SOURCE_BUILTIN_BADGE = '官方';

/** 源条目删除按钮：空闲态（两段确认的第一段） */
export const PLUGIN_MARKET_SOURCE_REMOVE_LABEL = '删除';

/** 源条目删除按钮：待确认态（两段确认的第二段） */
export const PLUGIN_MARKET_SOURCE_REMOVE_CONFIRM_LABEL = '确认删除';

/** 源加载失败的重试按钮 */
export const PLUGIN_MARKET_RETRY_LABEL = '重试';

// ——— 工具栏 / 列表文案 ———

/** 搜索框占位文案 */
export const PLUGIN_MARKET_SEARCH_PLACEHOLDER = '搜索插件名 / id / 描述';

/** 源筛选的「全部」chip */
export const PLUGIN_MARKET_FILTER_ALL_LABEL = '全部';

/** 刷新按钮 */
export const PLUGIN_MARKET_REFRESH_LABEL = '刷新';

/** 插件卡的「历史版本」折叠开关（收起态） */
export const PLUGIN_MARKET_HISTORY_TOGGLE_LABEL = '历史版本';

/** 插件卡的「收起历史」折叠开关（展开态） */
export const PLUGIN_MARKET_HISTORY_COLLAPSE_LABEL = '收起历史';

/** 历史版本区标题 */
export const PLUGIN_MARKET_HISTORY_TITLE = '可选版本';

/** 卡片安装按钮（空闲态） */
export const PLUGIN_MARKET_INSTALL_LABEL = '安装';

/** 卡片安装按钮（进行中；安装全局串行，仅一个按钮会显示它） */
export const PLUGIN_MARKET_INSTALLING_LABEL = '安装中…';

/**
 * 卡片更新按钮（已装旧版时）
 * @param version 远端最新版本
 * @returns 按钮文案
 */
export const PLUGIN_MARKET_UPDATE_LABEL = (version: string): string => `更新 v${version}`;

/** 卡片「已安装」按钮（已装同版或更新版；禁用态） */
export const PLUGIN_MARKET_INSTALLED_LABEL = '已安装';

/** 历史版本行的「当前版本」标签（该版本正是本地已装版本；禁用态） */
export const PLUGIN_MARKET_CURRENT_VERSION_LABEL = '当前版本';

/** 搜索无匹配结果 */
export const PLUGIN_MARKET_NO_MATCH_TEXT = '没有匹配的插件';

/**
 * 插件卡的来源徽标
 * @param label 源展示名
 * @param builtin 是否官方源
 * @returns 徽标文案
 */
export const PLUGIN_MARKET_SOURCE_BADGE = (label: string, builtin: boolean): string =>
  builtin ? `${PLUGIN_MARKET_SOURCE_BUILTIN_BADGE} · ${label}` : label;

/** 空态文案（当前筛选下没有任何插件） */
export const PLUGIN_MARKET_EMPTY_TEXT = '当前源还没有可安装的插件';

/** 空态文案（「未安装」视图下全部市场插件本地都已安装） */
export const PLUGIN_MARKET_EMPTY_NOT_INSTALLED_TEXT = '没有未安装的插件';

/** 加载失败（按源展示；带具体原因） */
export const PLUGIN_MARKET_FAIL_PREFIX = '加载失败：';

/**
 * 空结果提示：仓库能访问但没有任何符合口径的 zip 资产
 * （第三方仓库最常见的坑：产物没按 `<id>-<版本>.zip` 命名）
 */
export const PLUGIN_MARKET_NO_PRODUCTS_TEXT =
  '该仓库的 Releases 里没有符合「<插件id>-<版本>.zip」命名口径的插件产物，请确认仓库发布方式';

// ——— 确认弹窗文案 ———

/**
 * 安装确认弹窗标题
 * @param name 插件展示名
 * @returns 标题
 */
export const PLUGIN_MARKET_CONFIRM_TITLE = (name: string): string => `安装「${name}」`;

/** 安装确认弹窗的确定按钮 */
export const PLUGIN_MARKET_CONFIRM_OK = '下载并安装';

/** 安装确认弹窗的取消按钮 */
export const PLUGIN_MARKET_CONFIRM_CANCEL = '取消';

/**
 * 安装确认弹窗的来源行
 * @param label 源展示名
 * @param repo 仓库全名
 * @returns 来源文案
 */
export const PLUGIN_MARKET_CONFIRM_SOURCE = (label: string, repo: string): string =>
  `${label}（${repo}）`;

/**
 * 安装确认弹窗的降级提醒（装历史旧版覆盖新版时）
 * @param current 本地已装版本
 * @param target 即将安装的旧版本
 * @returns 提醒文案
 */
export const PLUGIN_MARKET_CONFIRM_DOWNGRADE = (current: string, target: string): string =>
  `本地已装 v${current}，本次将**降级**覆盖为 v${target}（插件数据表保留，之后「检查更新」会提示升回最新）`;

/**
 * 安装确认弹窗的无校验提醒（第三方源没有 sha256 时）
 * @param repo 仓库全名
 * @returns 提醒文案
 */
export const PLUGIN_MARKET_CONFIRM_NO_CHECKSUM = (repo: string): string =>
  `该插件来自第三方源 ${repo}，无官方 sha256 校验，请确认来源可信`;

// ——— 浮窗 / 错误文案 ———

/** 浮窗来源标签（与 `PLUGIN_UPDATE_NOTICE_SOURCE` 同口径） */
export const PLUGIN_MARKET_NOTICE_SOURCE = '插件市场';

/** 安装成功浮窗标题 */
export const PLUGIN_MARKET_OK_TITLE = '插件已安装';

/**
 * 安装成功浮窗正文
 * @param name 插件展示名
 * @param version 安装的版本
 * @returns 正文
 */
export const PLUGIN_MARKET_OK_BODY = (name: string, version: string): string =>
  `「${name}」v${version} 已挂载，可在插件清单里启停`;

/** 安装失败浮窗标题 */
export const PLUGIN_MARKET_FAIL_TITLE = '插件安装失败';

/** 拉取目录失败的兜底文案（无过期缓存可用时） */
export const PLUGIN_MARKET_ERR_FETCH = '未能获取插件列表，请检查网络后重试';

/** 校验失败（sha256 不匹配；硬失败） */
export const PLUGIN_MARKET_ERR_CHECKSUM = '下载内容校验未通过，已中止安装';

/**
 * 包内 id 与市场条目 id 不符
 * @param expected 市场条目 id
 * @param actual 包内清单 id
 * @returns 面向用户的文案
 */
export const PLUGIN_MARKET_ERR_ID_MISMATCH = (expected: string, actual: string): string =>
  `插件包 id（${actual}）与市场条目（${expected}）不一致，已中止`;

/**
 * 输入的仓库地址不合法
 * @param input 原始输入
 * @returns 面向用户的文案
 */
export const PLUGIN_MARKET_ERR_REPO_INPUT = (input: string): string =>
  `无法从「${input}」解析出 GitHub 仓库（示例：owner/repo 或 https://github.com/owner/repo）`;

/**
 * 源数量超上限
 * @param max 上限
 * @returns 面向用户的文案
 */
export const PLUGIN_MARKET_ERR_SOURCE_MAX = (max: number): string =>
  `自定义源数量已达上限（${max} 个），请先删除不再使用的源`;

/** 重复添加同一仓库 */
export const PLUGIN_MARKET_ERR_SOURCE_DUP = '该仓库已在插件源列表中';

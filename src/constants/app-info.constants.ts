/**
 * 应用信息常量（版本号 / 发布页地址）
 */

/** 当前应用版本（与 src-tauri/tauri.conf.json 的 version 同步维护） */
export const APP_VERSION = '2.6.3';

/** GitHub Releases 发布页地址（检查更新 / 手动下载入口） */
export const RELEASES_URL = 'https://github.com/WHF293/whf-stock-board/releases';

/** GitHub 仓库主页地址（设置页「系统」卡片入口） */
export const REPO_URL = 'https://github.com/WHF293/whf-stock-board';

/** GitHub Releases 最新版 API（免鉴权，CORS 允许任意来源） */
export const RELEASES_LATEST_API =
  'https://api.github.com/repos/WHF293/whf-stock-board/releases/latest';

/** 检查更新请求超时（毫秒） */
export const CHECK_UPDATE_TIMEOUT_MS = 10_000;

/**
 * 应用信息常量（版本号 / 发布页地址）
 */

/** 当前应用版本（与 src-tauri/tauri.conf.json 的 version 同步维护；Tauri 端运行时以 getVersion() 为准） */
export const APP_VERSION = '3.0.4';

/** GitHub Releases 发布页地址（检查更新 / 手动下载入口） */
export const RELEASES_URL = 'https://github.com/WHF293/whf-stock-board/releases';

/** GitHub 仓库主页地址（设置页「系统」卡片入口） */
export const REPO_URL = 'https://github.com/WHF293/whf-stock-board';

/** 官方插件仓库地址（设置页「系统」卡片入口；官方插件源码与 zip 产物包在此独立仓库） */
export const PLUGIN_REPO_URL = 'https://github.com/WHF293/whf-stock-board-plugin';

/**
 * 应用信息常量（版本号 / 发布页地址）
 */

/** 当前应用版本（与 src-tauri/tauri.conf.json 的 version 同步维护；Tauri 端运行时以 getVersion() 为准） */
export const APP_VERSION = '4.24.3';

/** GitHub Releases 发布页地址（检查更新 / 手动下载入口） */
export const RELEASES_URL = 'https://github.com/WHF293/whf-stock-board/releases';

/** GitHub 仓库主页地址（设置页「系统」卡片入口） */
export const REPO_URL = 'https://github.com/WHF293/whf-stock-board';

/** 官方插件仓库地址（设置页「系统」卡片入口；官方插件源码与 zip 产物包在此独立仓库，曾用名 tauri-plugin 已更名） */
export const PLUGIN_REPO_URL = 'https://github.com/jx62257070/stock-board-plugin';

/** 官网首页地址（设置页「官方网站」入口；GitHub Pages 项目站，下载中心 / 软件文档 / 插件生态都在站内） */
export const SITE_URL = 'https://whf293.github.io/whf-stock-board/';

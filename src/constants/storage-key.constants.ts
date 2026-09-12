/**
 * 本地存储键集中管理
 *
 * 全站持久化统一收敛到单一 localStorage key（STORAGE_KEY_APP）：
 * value 为按命名空间划分的对象 { [ns]: value }，经 appStorage 适配器读写；
 * 本文件常量为各 store 的命名空间（不再是独立 localStorage key）
 */

/** 统一持久化外层 key（localStorage 唯一键） */
export const STORAGE_KEY_APP = 'whf:app';

/** 自选股分组命名空间 */
export const STORAGE_NS_WATCHLIST = 'watchlist';

/** 应用设置命名空间 */
export const STORAGE_NS_SETTINGS = 'settings';

/** 明暗模式命名空间 */
export const STORAGE_NS_COLOR_SCHEME = 'colorScheme';

/** 右侧停靠面板命名空间（宽度 / 侧栏开关） */
export const STORAGE_NS_DOCK_PANEL = 'dockPanel';

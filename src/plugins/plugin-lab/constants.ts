/**
 * 插件 dsh-plugin-lab · 私有常量
 */

/** 「最近事件」最多展示的条数 */
export const PLUGIN_LAB_EVENT_LIMIT = 12;

/** 事件心跳间隔（毫秒）：环形缓冲不是响应式的，用它驱动定时刷新 */
export const PLUGIN_LAB_TICK_MS = 1000;

/**
 * 插件工坊页面路径（由本插件注册进左侧导航）
 *
 * 该页面同时是「插件页随插件撤销」的兜底落点（见 plugin.ts 的 `fallbackLanding`），
 * 宿主不与这个字面量耦合 —— 落点由声明解析，不强编码路径。
 */
export const PLUGIN_LAB_PATH = '/plugin-lab';

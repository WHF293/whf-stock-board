/**
 * 插件内核单例（宿主与插件共同引用的唯一实例）
 *
 * 为什么是模块级单例而不是「构造函数 + 传参」：插件的贡献点需要被**多个宿主组件**
 * 同时消费（MainLayout 读侧栏面板与菜单、DockPanel 读停靠面板、Agent 运行时读 MCP 工具），
 * 单例让这些消费点不必层层透传。代价是测试时需要显式重置（`createKernel` 供测试用）。
 */
import { PluginKernel } from './kernel';

/** 全应用唯一的插件内核实例 */
export const pluginKernel = new PluginKernel();

/**
 * 新建一个独立内核（仅测试 / 单元验证使用，主流程一律用 `pluginKernel`）
 * @returns 全新的插件内核实例
 */
export const createKernel = (): PluginKernel => new PluginKernel();

export { PluginKernel } from './kernel';
export type { PluginMountOptions } from './kernel';
export { createDisposable, DisposableBag, NOOP_DISPOSABLE } from './disposable';
export { PluginEventBus } from './events';
export { PluginServiceContainer } from './services';
export { PluginContributions } from './contributions';
export { PluginContextImpl } from './context';

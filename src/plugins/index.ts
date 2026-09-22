/**
 * 内置插件清单（唯一事实源）
 *
 * 新增一个内置能力 = 在 `src/plugins/<name>/` 写一个插件定义（元信息 + apply），
 * 然后追加到本数组。数组顺序不影响挂载顺序 —— 挂载由内核按 `inject` 依赖收敛决定。
 */
import type { PluginDefinition } from '../types/plugin.types';

/**
 * 全部随应用分发的内置插件
 *
 * 这里的每一项都是**源码集成**：源文件就在 `src/plugins/<dir>/`，连同本清单一起被编译进应用。
 * 它们不是「运行时装进来的」，所以应用内的卸载 UI 不会给它们出现「卸载」按钮 ——
 * 要 uninstall 得改源码（删目录 + 撤登记），做法见 AGENTS.md「源码集成插件：增删时的备份与恢复」。
 *
 * **当前为空**：四个官方插件已全部走「源码级卸载 + zip 产物包分发」——
 * 源码目录彻底删除、登记行撤掉、不参与任何构建，只活在备份 / git 与已发布的产物包里，
 * 用户以「应用内安装」的方式装上（也能在应用里一键卸载）：
 * - `dsh-mainline`（股票主线，2026-09-21）→ `plugins-dist/dsh-mainline-1.0.0.zip`
 * - `dsh-dividend-screen`（股息筛选，2026-09-22）→ `plugins-dist/dsh-dividend-screen-1.0.0.zip`
 * - `dsh-quick-note`（速记，2026-09-22）→ `plugins-dist/dsh-quick-note-1.1.0.zip`
 * - `dsh-sidebar-watch`（自选盯盘，2026-09-22）→ `plugins-dist/dsh-sidebar-watch-1.3.0.zip`
 *
 * 内核本身不依赖这个数组非空：插件可以一个都没有（贡献点容器全空，界面照常工作）。
 * 想恢复内置：把源码目录与下面数组里那一行加回来即可，id 派生的数据表与 storage
 * 命名空间都不受影响。要重新出包走 AGENTS.md 里的「临时流程」，
 * 别把备份目录留在 `scripts/build-plugins.mjs` 的 TARGETS 里。
 */
export const BUILTIN_PLUGINS: readonly PluginDefinition[] = [];

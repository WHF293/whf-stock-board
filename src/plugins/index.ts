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
 * **当前为空**：五个官方插件已全部走「源码级卸载 + zip 产物包分发」——
 * 源码在独立插件仓库（tauri-plugin）维护，zip 产物在其 `plugins-dist/` 入库，
 * 用户以「应用内安装」的方式装上（也能在应用里一键卸载）：
 * - `dsh-mainline`（股票主线）→ `dsh-mainline-1.0.0.zip`
 * - `dsh-dividend-screen`（股息筛选）→ `dsh-dividend-screen-1.0.0.zip`
 * - `dsh-quick-note`（速记）→ `dsh-quick-note-1.1.0.zip`
 * - `dsh-sidebar-watch`（自选盯盘）→ `dsh-sidebar-watch-1.4.0.zip`（1.4.0 起公开 watch:monitor）
 * - `dsh-watch-widget`（任务栏盯盘小组件，2026-09-22 迁出）→ `dsh-watch-widget-1.0.0.zip`
 *
 * 迁出不等于删干净：以下**宿主侧资产必须保留在本仓**（它们不是插件源码，是宿主职责）：
 * - `src/plugins/watch-widget/constants.ts`：事件协议常量（渲染端 `src/widget/` 与
 *   插件产物两端共享同一份事实源，插件仓经 host 快照引用）；
 * - `src/widget/` + `watch-widget.html` + vite 多页入口 + `src-tauri/capabilities/watch-widget.json`：
 *   小组件窗口的渲染端与授权，窗口 URL 指向宿主域，插件产物无法自带；
 * - `types/watch-widget.types.ts` / settings store 的 `watchWidget` 段 / `stores/market-status`
 *   的 `isAShareIntraday`：`app:watch-widget-settings` 与 `app:market-status` 服务的宿主侧。
 *
 * 内核本身不依赖这个数组非空：插件可以一个都没有（贡献点容器全空，界面照常工作）。
 * 想恢复内置：把源码目录与下面数组里那一行加回来即可，id 派生的数据表与 storage
 * 命名空间都不受影响。
 */
export const BUILTIN_PLUGINS: readonly PluginDefinition[] = [];

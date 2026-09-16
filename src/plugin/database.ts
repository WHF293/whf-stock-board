/**
 * 插件通用数据库 · 每插件绑定层
 *
 * 把通用通道（api/plugin-db.api.ts，函数都带 pluginId 参数） curry 成
 * `ctx.db` 的 PluginDatabase 形态 —— 插件拿到的是「本插件专属」的库句柄，
 * 表自动归属本插件（`plugin_<插件id>_<表名>`），越权操作在通道层被拦截。
 */
import {
  clearPluginTable,
  countPluginRows,
  ensurePluginTable,
  insertPluginRow,
  removePluginRow,
  selectPluginRows,
  updatePluginRow,
} from '../api/plugin-db.api';
import type { PluginDbColumn, PluginDatabase, PluginDbQuery } from '../types/plugin.types';

/**
 * 创建某插件专属的数据库句柄（内核在构造 ctx 时调用）
 * @param pluginId 插件 id
 * @returns 插件自有数据库句柄
 */
export const createPluginDatabase = (pluginId: string): PluginDatabase => ({
  ensureTable: (table: string, columns: readonly PluginDbColumn[]): Promise<void> =>
    ensurePluginTable(pluginId, table, columns),
  insert: (table: string, row: Record<string, unknown>): Promise<number> =>
    insertPluginRow(pluginId, table, row),
  select: <T extends Record<string, unknown>>(
    table: string,
    query?: PluginDbQuery,
  ): Promise<(T & { id: number; createdAt: number; updatedAt: number })[]> =>
    selectPluginRows<T>(pluginId, table, query),
  update: (table: string, id: number, patch: Record<string, unknown>): Promise<void> =>
    updatePluginRow(pluginId, table, id, patch),
  remove: (table: string, id: number): Promise<void> => removePluginRow(pluginId, table, id),
  count: (table: string, where?: PluginDbQuery['where']): Promise<number> =>
    countPluginRows(pluginId, table, where),
  clear: (table: string): Promise<void> => clearPluginTable(pluginId, table),
});

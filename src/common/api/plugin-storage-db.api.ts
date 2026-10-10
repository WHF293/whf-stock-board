/**
 * 插件存储镜像（stock-board.db / plugin_storage 表，V6 迁移）
 *
 * 插件持久化的统一后端：插件只经 `ctx.storage`（宿主 API）读写，**永不直接访问 SQL**；
 * 本文件是 ctx.storage 在 Tauri 端的镜像通道 —— localStorage 即时写保证两端可用与同步读，
 * 本表异步镜像保证桌面端数据落 SQLite（重启 / 换机可恢复）。
 */
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';

let dbPromise: Promise<Database> | null = null;

/**
 * 惰性打开 stock-board.db（非 Tauri 环境返回 null，调用方降级）
 * @returns 数据库连接 Promise（非 Tauri 为 null）
 */
const getDb = (): Promise<Database> | null => {
  if (!isTauri()) return null;
  dbPromise ??= Database.load('sqlite:stock-board.db');
  return dbPromise;
};

/**
 * 读取某插件的全部镜像键值
 * @param pluginId 插件 id
 * @returns 键值对象（key → 已反序列化的值原文 JSON 串解析结果）；非 Tauri 或失败为 null
 */
export const loadPluginStorage = async (
  pluginId: string,
): Promise<Record<string, unknown> | null> => {
  const db = getDb();
  if (!db) return null;
  try {
    const conn = await db;
    const rows = await conn.select<Record<string, unknown>[]>(
      'SELECT key, value FROM plugin_storage WHERE plugin_id = $1',
      [pluginId],
    );
    const result: Record<string, unknown> = {};
    for (const row of rows) {
      try {
        result[String(row.key)] = JSON.parse(String(row.value)) as unknown;
      } catch {
        // 单条损坏只丢该键，不拖垮整个插件的存储水合
      }
    }
    return result;
  } catch (error) {
    console.error(`[plugin-storage-db] 读取插件存储镜像失败（${pluginId}）`, error);
    return null;
  }
};

/**
 * 镜像单个键（upsert 语义）
 * @param pluginId 插件 id
 * @param key 存储键
 * @param valueText 值的 JSON 串（由 ctx.storage 序列化后传入）
 * @returns 是否写入成功
 */
export const savePluginStorageEntry = async (
  pluginId: string,
  key: string,
  valueText: string,
): Promise<boolean> => {
  const db = getDb();
  if (!db) return false;
  try {
    const conn = await db;
    await conn.execute(
      `INSERT INTO plugin_storage (plugin_id, key, value, updated_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT(plugin_id, key) DO UPDATE SET value = $3, updated_at = $4`,
      [pluginId, key, valueText, Date.now()],
    );
    return true;
  } catch (error) {
    console.error(`[plugin-storage-db] 镜像插件存储失败（${pluginId}#${key}）`, error);
    return false;
  }
};

/**
 * 删除某插件的单个镜像键
 * @param pluginId 插件 id
 * @param key 存储键
 * @returns 是否删除成功
 */
export const deletePluginStorageEntry = async (
  pluginId: string,
  key: string,
): Promise<boolean> => {
  const db = getDb();
  if (!db) return false;
  try {
    const conn = await db;
    await conn.execute('DELETE FROM plugin_storage WHERE plugin_id = $1 AND key = $2', [
      pluginId,
      key,
    ]);
    return true;
  } catch (error) {
    console.error(`[plugin-storage-db] 删除插件存储镜像失败（${pluginId}#${key}）`, error);
    return false;
  }
};

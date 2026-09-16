/**
 * 自选股本地库（stock-board.db / watchlist_group + watchlist_stock 表，V6 迁移）
 *
 * 自选股是**全量镜像**模式：watchlist store（localStorage 即时持久化）仍是运行期单一事实源，
 * Tauri 端在变更后整包重写两表，启动时若库里有数据则以库覆盖水合；
 * 浏览器端无 SQLite，调用方（use-watchlist-sync）直接不启用同步。
 */
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import type { WatchlistGroup, WatchlistStock } from '../types/watchlist.types';

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
 * 从本地库读取自选股全量快照
 * @returns 分组列表（含各组个股，按落库顺序）；非 Tauri 或读取失败为 null
 */
export const loadWatchlistGroups = async (): Promise<WatchlistGroup[] | null> => {
  const db = getDb();
  if (!db) return null;
  try {
    const conn = await db;
    const groupRows = await conn.select<Record<string, unknown>[]>(
      'SELECT id, name FROM watchlist_group ORDER BY sort_order',
    );
    const stockRows = await conn.select<Record<string, unknown>[]>(
      'SELECT group_id, symbol, name, added_at FROM watchlist_stock ORDER BY group_id, sort_order',
    );
    const stocksByGroup = new Map<string, WatchlistStock[]>();
    for (const row of stockRows) {
      const groupId = String(row.group_id);
      const list = stocksByGroup.get(groupId) ?? [];
      list.push({
        symbol: String(row.symbol),
        name: String(row.name),
        addedAt: Number(row.added_at),
      });
      stocksByGroup.set(groupId, list);
    }
    return groupRows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      stocks: stocksByGroup.get(String(row.id)) ?? [],
    }));
  } catch (error) {
    console.error('[watchlist-db] 读取自选股快照失败', error);
    return null;
  }
};

/**
 * 把自选股全量快照写入本地库（整包重写：先清两表再按数组顺序落库）
 * @param groups 分组列表（运行期 store 的完整状态）
 * @returns 是否写入成功（false = 非 Tauri 或写失败；调用方静默降级）
 */
export const saveWatchlistGroups = async (groups: readonly WatchlistGroup[]): Promise<boolean> => {
  const db = getDb();
  if (!db) return false;
  try {
    const conn = await db;
    await conn.execute('DELETE FROM watchlist_stock');
    await conn.execute('DELETE FROM watchlist_group');
    const now = Date.now();
    for (const [groupIndex, group] of groups.entries()) {
      await conn.execute(
        'INSERT INTO watchlist_group (id, name, sort_order, created_at) VALUES ($1, $2, $3, $4)',
        [group.id, group.name, groupIndex, now],
      );
      for (const [stockIndex, stock] of group.stocks.entries()) {
        await conn.execute(
          'INSERT INTO watchlist_stock (group_id, symbol, name, added_at, sort_order) VALUES ($1, $2, $3, $4, $5)',
          [group.id, stock.symbol, stock.name, stock.addedAt, stockIndex],
        );
      }
    }
    return true;
  } catch (error) {
    console.error('[watchlist-db] 写入自选股快照失败', error);
    return false;
  }
};

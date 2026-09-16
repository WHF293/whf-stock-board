/**
 * 插件通用数据库 · 数据通道（stock-board.db / `plugin_<插件id>_<表名>` 动态表）
 *
 * 插件只经 `ctx.db`（宿主 API）做「声明式建表 + CRUD」，**永不直接访问 SQL**：
 * - Tauri 端：SQLite 动态表（IF NOT EXISTS 建表 + 全量参数化语句）；
 * - 浏览器端：无 SQLite，自动降级为 appStorage 内的 JSON 表仿真，两端语义一致。
 *
 * 列元信息（类型 / 索引）在本模块登记（进程级缓存），insert / select 等操作据此
 * 做单元格序列化与合法性校验 —— 未 ensureTable 就读写会直接抛错。
 */
import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import {
  PLUGIN_DB_CREATED_AT_COLUMN,
  PLUGIN_DB_FALLBACK_KEY_PREFIX,
  PLUGIN_DB_ID_COLUMN,
  PLUGIN_DB_TABLE_PREFIX,
  PLUGIN_DB_TABLE_REGISTRY_KEY,
  PLUGIN_DB_UPDATED_AT_COLUMN,
} from '../constants/plugin-db.constants';
import { appStorage } from '../utils/app-local-storage';
import {
  buildCreateIndexSqlList,
  buildCreateTableSql,
  deserializePluginCell,
  normalizePluginIdSegment,
  resolvePluginTableName,
  serializePluginCell,
  toColumnMap,
  withMetaColumns,
} from '../utils/plugin-db-sql';
import type { PluginDbMetaFields } from '../utils/plugin-db-sql';
import type { PluginDbColumn, PluginDbQuery } from '../types/plugin.types';

/** 浏览器降级仿真表的一行（业务单元格先序列化，语义与 SQLite 一致） */
interface FallbackRow {
  /** 行主键 */
  id: number;
  /** 创建时间（毫秒） */
  createdAt: number;
  /** 更新时间（毫秒） */
  updatedAt: number;
  /** 列名 → 已序列化的单元格值 */
  cells: Record<string, unknown>;
}

let dbPromise: Promise<Database> | null = null;

/** 物理表名 → 列声明（进程级；ensureTable 登记，CRUD 消费） */
const tableColumns = new Map<string, PluginDbColumn[]>();

/** 已执行过 DDL 的物理表集合（防止重复建表请求） */
const ensuredTables = new Set<string>();

/**
 * 惰性打开 stock-board.db（非 Tauri 环境返回 null，调用方走降级通道）
 * @returns 数据库连接 Promise（非 Tauri 为 null）
 */
const getDb = (): Promise<Database> | null => {
  if (!isTauri()) return null;
  dbPromise ??= Database.load('sqlite:stock-board.db');
  return dbPromise;
};

/**
 * 取某物理表的列声明（未 ensureTable 抛错）
 * @param tableName 物理表名
 * @returns 列声明列表
 */
const requireColumns = (tableName: string): PluginDbColumn[] => {
  const columns = tableColumns.get(tableName);
  if (!columns) {
    throw new Error(`[plugin-db] 表未声明（先调用 ensureTable）："${tableName}"`);
  }
  return columns;
};

/**
 * 读取浏览器降级仿真表
 * @param tableName 物理表名
 * @returns 行数组（损坏时返回空数组）
 */
const readFallbackRows = (tableName: string): FallbackRow[] => {
  const raw = appStorage.getItem(`${PLUGIN_DB_FALLBACK_KEY_PREFIX}${tableName}`);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as FallbackRow[]) : [];
  } catch {
    return [];
  }
};

/**
 * 写回浏览器降级仿真表
 * @param tableName 物理表名
 * @param rows 行数组
 */
const writeFallbackRows = (tableName: string, rows: FallbackRow[]): void => {
  appStorage.setItem(
    `${PLUGIN_DB_FALLBACK_KEY_PREFIX}${tableName}`,
    JSON.stringify(rows),
  );
};

/**
 * 读取表登记表（插件 id → 插件内表名数组）
 * @returns 登记映射（损坏时返回空对象）
 */
const readTableRegistry = (): Record<string, string[]> => {
  const raw = appStorage.getItem(PLUGIN_DB_TABLE_REGISTRY_KEY);
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
};

/**
 * 把一张表登记到插件名下（卸载询问 / 删表用）
 * @param pluginId 插件 id
 * @param table 插件内表名
 */
const registerPluginTable = (pluginId: string, table: string): void => {
  const registry = readTableRegistry();
  const tables = registry[pluginId] ?? [];
  if (!tables.includes(table)) {
    registry[pluginId] = [...tables, table];
    appStorage.setItem(PLUGIN_DB_TABLE_REGISTRY_KEY, JSON.stringify(registry));
  }
};

/**
 * 声明一张插件表（幂等；Tauri 端执行 DDL，浏览器端只登记元信息）
 * @param pluginId 插件 id
 * @param table 插件内表名
 * @param columns 列声明
 */
export const ensurePluginTable = async (
  pluginId: string,
  table: string,
  columns: readonly PluginDbColumn[],
): Promise<void> => {
  const checked = [...columns];
  toColumnMap(checked);
  const tableName = resolvePluginTableName(pluginId, table);
  tableColumns.set(tableName, checked);
  registerPluginTable(pluginId, table);
  if (ensuredTables.has(tableName)) return;
  const db = getDb();
  if (!db) {
    ensuredTables.add(tableName);
    return;
  }
  const conn = await db;
  await conn.execute(buildCreateTableSql(tableName, checked));
  for (const sql of buildCreateIndexSqlList(tableName, checked)) {
    await conn.execute(sql);
  }
  ensuredTables.add(tableName);
};

/**
 * 插入一行
 * @param pluginId 插件 id
 * @param table 插件内表名
 * @param row 行数据（键必须都是声明过的列）
 * @returns 新行主键
 */
export const insertPluginRow = async (
  pluginId: string,
  table: string,
  row: Record<string, unknown>,
): Promise<number> => {
  const tableName = resolvePluginTableName(pluginId, table);
  const columns = requireColumns(tableName);
  const now = Date.now();
  const db = getDb();
  if (!db) {
    const rows = readFallbackRows(tableName);
    const nextId = rows.reduce((max, item) => Math.max(max, item.id), 0) + 1;
    const cells: Record<string, unknown> = {};
    for (const column of columns) {
      cells[column.name] = serializePluginCell(row[column.name], column.type);
    }
    rows.push({ id: nextId, createdAt: now, updatedAt: now, cells });
    writeFallbackRows(tableName, rows);
    return nextId;
  }
  const knownKeys = new Set(columns.map((column) => column.name));
  for (const key of Object.keys(row)) {
    if (!knownKeys.has(key)) {
      throw new Error(`[plugin-db] 未声明的列："${key}"（表 ${tableName}）`);
    }
  }
  const names = columns.map((column) => column.name);
  const values = columns.map((column) => serializePluginCell(row[column.name], column.type));
  const placeholders = [...names, PLUGIN_DB_CREATED_AT_COLUMN, PLUGIN_DB_UPDATED_AT_COLUMN]
    .map((_, index) => `$${index + 1}`)
    .join(', ');
  const conn = await db;
  const result = await conn.execute(
    `INSERT INTO ${tableName} (${[...names, PLUGIN_DB_CREATED_AT_COLUMN, PLUGIN_DB_UPDATED_AT_COLUMN].join(', ')})
     VALUES (${placeholders})`,
    [...values, now, now],
  );
  const lastId = result.lastInsertId;
  return typeof lastId === 'number' ? lastId : 0;
};

/**
 * 组装 WHERE 子句（等值匹配；列必须声明过，值参数化）
 * @param tableName 物理表名
 * @param columns 列声明
 * @param where 等值条件
 * @returns SQL 片段（含 WHERE 关键字，空条件为空串）与参数
 */
const buildWhere = (
  tableName: string,
  columns: PluginDbColumn[],
  where: PluginDbQuery['where'],
): { sql: string; params: unknown[] } => {
  if (!where) return { sql: '', params: [] };
  const byName = new Map(columns.map((column) => [column.name, column]));
  const entries = Object.entries(where).filter(([, value]) => value !== undefined);
  for (const [key] of entries) {
    if (!byName.has(key)) {
      throw new Error(`[plugin-db] 未声明的列："${key}"（表 ${tableName}）`);
    }
  }
  if (entries.length === 0) return { sql: '', params: [] };
  const params = entries.map(([key, value]) =>
    serializePluginCell(value, byName.get(key)!.type),
  );
  const sql = ` WHERE ${entries.map(([key], index) => `${key} = $${index + 1}`).join(' AND ')}`;
  return { sql, params };
};

/**
 * 序列化一行库记录为插件侧形态（按列类型反序列化 + 宿主维护字段）
 * @param raw 库里读出的行
 * @param columns 列声明
 * @returns 插件侧行（业务字段 + id/createdAt/updatedAt）
 */
const mapRawRow = (
  raw: Record<string, unknown>,
  columns: PluginDbColumn[],
): Record<string, unknown> => {
  const row: Record<string, unknown> = {};
  for (const column of columns) {
    row[column.name] = deserializePluginCell(raw[column.name], column.type);
  }
  return withMetaColumns(row, {
    id: Number(raw[PLUGIN_DB_ID_COLUMN]),
    createdAt: Number(raw[PLUGIN_DB_CREATED_AT_COLUMN]),
    updatedAt: Number(raw[PLUGIN_DB_UPDATED_AT_COLUMN]),
  });
};

/**
 * 查询行
 * @param pluginId 插件 id
 * @param table 插件内表名
 * @param query 过滤 / 排序 / 分页条件（缺省取全部，按 id 升序）
 * @returns 行数组
 */
export const selectPluginRows = async <T extends Record<string, unknown>>(
  pluginId: string,
  table: string,
  query: PluginDbQuery = {},
): Promise<(T & PluginDbMetaFields)[]> => {
  const tableName = resolvePluginTableName(pluginId, table);
  const columns = requireColumns(tableName);
  const { sql: whereSql, params } = buildWhere(tableName, columns, query.where);
  const db = getDb();
  if (!db) {
    let rows = readFallbackRows(tableName);
    if (query.where) {
      const conditions = Object.entries(query.where).filter(([, value]) => value !== undefined);
      rows = rows.filter((item) =>
        conditions.every(([key, value]) => item.cells[key] === serializePluginCell(value, columns.find((c) => c.name === key)!.type)),
      );
    }
    const orderBy = query.orderBy;
    if (orderBy) {
      const dir = orderBy.desc === true ? -1 : 1;
      rows = [...rows].sort((a, b) => {
        const av = orderBy.column === PLUGIN_DB_ID_COLUMN ? a.id : a.cells[orderBy.column];
        const bv = orderBy.column === PLUGIN_DB_ID_COLUMN ? b.id : b.cells[orderBy.column];
        return av === bv ? 0 : (av as number) > (bv as number) ? dir : -dir;
      });
    }
    const offset = query.offset ?? 0;
    const sliced = rows.slice(offset, query.limit === undefined ? undefined : offset + query.limit);
    return sliced.map((item) =>
      mapRawRow(
        { ...item.cells, [PLUGIN_DB_ID_COLUMN]: item.id, [PLUGIN_DB_CREATED_AT_COLUMN]: item.createdAt, [PLUGIN_DB_UPDATED_AT_COLUMN]: item.updatedAt },
        columns,
      ),
    ) as (T & PluginDbMetaFields)[];
  }
  const orderSql = query.orderBy
    ? ` ORDER BY ${query.orderBy.column} ${query.orderBy.desc === true ? 'DESC' : 'ASC'}`
    : ` ORDER BY ${PLUGIN_DB_ID_COLUMN} ASC`;
  const limitSql =
    query.limit === undefined && query.offset === undefined
      ? ''
      : ` LIMIT ${query.limit ?? -1} OFFSET ${query.offset ?? 0}`;
  const conn = await db;
  const raws = await conn.select<Record<string, unknown>[]>(
    `SELECT * FROM ${tableName}${whereSql}${orderSql}${limitSql}`,
    params,
  );
  return raws.map((raw) => mapRawRow(raw, columns)) as (T & PluginDbMetaFields)[];
};

/**
 * 按主键更新一行（patch 键必须都是声明过的列，宿主自动刷新 updatedAt）
 * @param pluginId 插件 id
 * @param table 插件内表名
 * @param id 行主键
 * @param patch 待更新列
 */
export const updatePluginRow = async (
  pluginId: string,
  table: string,
  id: number,
  patch: Record<string, unknown>,
): Promise<void> => {
  const tableName = resolvePluginTableName(pluginId, table);
  const columns = requireColumns(tableName);
  const byName = new Map(columns.map((column) => [column.name, column]));
  const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
  for (const [key] of entries) {
    if (!byName.has(key)) {
      throw new Error(`[plugin-db] 未声明的列："${key}"（表 ${tableName}）`);
    }
  }
  if (entries.length === 0) return;
  const db = getDb();
  if (!db) {
    const rows = readFallbackRows(tableName);
    const target = rows.find((item) => item.id === id);
    if (!target) return;
    for (const [key, value] of entries) {
      target.cells[key] = serializePluginCell(value, byName.get(key)!.type);
    }
    target.updatedAt = Date.now();
    writeFallbackRows(tableName, rows);
    return;
  }
  const sets = entries.map(([key], index) => `${key} = $${index + 1}`);
  const params = entries.map(([key, value]) => serializePluginCell(value, byName.get(key)!.type));
  const conn = await db;
  await conn.execute(
    `UPDATE ${tableName} SET ${sets.join(', ')}, ${PLUGIN_DB_UPDATED_AT_COLUMN} = $${entries.length + 1}
     WHERE ${PLUGIN_DB_ID_COLUMN} = $${entries.length + 2}`,
    [...params, Date.now(), id],
  );
};

/**
 * 按主键删除一行
 * @param pluginId 插件 id
 * @param table 插件内表名
 * @param id 行主键
 */
export const removePluginRow = async (
  pluginId: string,
  table: string,
  id: number,
): Promise<void> => {
  const tableName = resolvePluginTableName(pluginId, table);
  requireColumns(tableName);
  const db = getDb();
  if (!db) {
    writeFallbackRows(
      tableName,
      readFallbackRows(tableName).filter((item) => item.id !== id),
    );
    return;
  }
  const conn = await db;
  await conn.execute(`DELETE FROM ${tableName} WHERE ${PLUGIN_DB_ID_COLUMN} = $1`, [id]);
};

/**
 * 统计行数（可带等值过滤）
 * @param pluginId 插件 id
 * @param table 插件内表名
 * @param where 等值条件（缺省统计全表）
 * @returns 行数
 */
export const countPluginRows = async (
  pluginId: string,
  table: string,
  where?: PluginDbQuery['where'],
): Promise<number> => {
  const tableName = resolvePluginTableName(pluginId, table);
  const columns = requireColumns(tableName);
  const { sql, params } = buildWhere(tableName, columns, where);
  const db = getDb();
  if (!db) {
    const rows = readFallbackRows(tableName);
    if (!where) return rows.length;
    const conditions = Object.entries(where).filter(([, value]) => value !== undefined);
    return rows.filter((item) =>
      conditions.every(
        ([key, value]) =>
          item.cells[key] ===
          serializePluginCell(value, columns.find((c) => c.name === key)?.type ?? 'text'),
      ),
    ).length;
  }
  const conn = await db;
  const raws = await conn.select<{ n: number }[]>(
    `SELECT COUNT(*) AS n FROM ${tableName}${sql}`,
    params,
  );
  return Number(raws[0]?.n ?? 0);
};

/**
 * 清空一张表（不删表，结构保留）
 * @param pluginId 插件 id
 * @param table 插件内表名
 */
export const clearPluginTable = async (pluginId: string, table: string): Promise<void> => {
  const tableName = resolvePluginTableName(pluginId, table);
  requireColumns(tableName);
  const db = getDb();
  if (!db) {
    writeFallbackRows(tableName, []);
    return;
  }
  const conn = await db;
  await conn.execute(`DELETE FROM ${tableName}`);
};

/**
 * 枚举某插件名下的数据表（卸载弹窗询问「是否一并删表」用）
 * @param pluginId 插件 id
 * @returns 插件内表名数组（未登记过为空数组）
 */
export const listPluginTables = (pluginId: string): string[] => readTableRegistry()[pluginId] ?? [];

/**
 * 删除某插件名下的全部数据表（DROP TABLE + 清浏览器降级数据 + 清登记）
 *
 * 仅在用户于卸载流程中明确选择「一并删表」后调用；表未挂载（无列元信息）时直接 DROP 物理表。
 * @param pluginId 插件 id
 * @returns 是否全部删除成功
 */
export const dropPluginTables = async (pluginId: string): Promise<boolean> => {
  const tables = listPluginTables(pluginId);
  const idSegment = normalizePluginIdSegment(pluginId);
  const db = getDb();
  try {
    if (db) {
      const conn = await db;
      for (const table of tables) {
        await conn.execute(`DROP TABLE IF EXISTS ${PLUGIN_DB_TABLE_PREFIX}${idSegment}_${table}`);
      }
    }
    for (const table of tables) {
      appStorage.removeItem(`${PLUGIN_DB_FALLBACK_KEY_PREFIX}${resolvePluginTableName(pluginId, table)}`);
      const tableName = resolvePluginTableName(pluginId, table);
      tableColumns.delete(tableName);
      ensuredTables.delete(tableName);
    }
    const registry = readTableRegistry();
    delete registry[pluginId];
    appStorage.setItem(PLUGIN_DB_TABLE_REGISTRY_KEY, JSON.stringify(registry));
    return true;
  } catch (error) {
    console.error(`[plugin-db] 删除插件数据表失败（${pluginId}）`, error);
    return false;
  }
};

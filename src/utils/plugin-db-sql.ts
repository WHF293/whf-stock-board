/**
 * 插件通用数据库 · 纯函数层（表名解析 / DDL 生成 / 单元格序列化）
 *
 * 全部为无副作用纯函数：被 api 层消费，也可脱离 Tauri 环境单测（ts-smoke-harness）。
 * 标识符校验是安全边界 —— 插件传入的表名 / 列名必须通过白名单正则才会拼进 SQL，
 * 配合参数化语句，插件侧不存在 SQL 注入面。
 */
import {
  PLUGIN_DB_COLUMN_TYPE_MAP,
  PLUGIN_DB_CREATED_AT_COLUMN,
  PLUGIN_DB_ID_COLUMN,
  PLUGIN_DB_IDENTIFIER_MAX_LENGTH,
  PLUGIN_DB_IDENTIFIER_PATTERN,
  PLUGIN_DB_TABLE_PREFIX,
  PLUGIN_DB_UPDATED_AT_COLUMN,
} from '../constants/plugin-db.constants';
import type { PluginDbColumn, PluginDbColumnType } from '../types/plugin.types';

/** 插件侧读取方向的宿主维护字段（camelCase，库里为 created_at / updated_at 列） */
export interface PluginDbMetaFields {
  /** 行主键 */
  id: number;
  /** 创建时间（毫秒） */
  createdAt: number;
  /** 更新时间（毫秒） */
  updatedAt: number;
}

/**
 * 把插件 id 归一化成表名段（kebab-case 转 snake_case，非法字符剔除）
 * @param pluginId 插件 id
 * @returns 表名段（可能为空串，由调用方校验）
 */
export const normalizePluginIdSegment = (pluginId: string): string =>
  pluginId.toLowerCase().replace(/-/g, '_').replace(/[^a-z0-9_]/g, '');

/**
 * 解析物理表名（`plugin_<插件id段>_<表名>`）
 * @param pluginId 插件 id
 * @param table 插件内表名
 * @returns 物理表名；任一段非法时抛错（防注入兜底，插件永远拼不进任意 SQL）
 */
export const resolvePluginTableName = (pluginId: string, table: string): string => {
  const idSegment = normalizePluginIdSegment(pluginId);
  const invalid =
    !PLUGIN_DB_IDENTIFIER_PATTERN.test(idSegment) ||
    !PLUGIN_DB_IDENTIFIER_PATTERN.test(table) ||
    idSegment.length > PLUGIN_DB_IDENTIFIER_MAX_LENGTH ||
    table.length > PLUGIN_DB_IDENTIFIER_MAX_LENGTH;
  if (invalid) {
    throw new Error(`[plugin-db] 非法表名：pluginId="${pluginId}" table="${table}"`);
  }
  return `${PLUGIN_DB_TABLE_PREFIX}${idSegment}_${table}`;
};

/**
 * 校验列名合法性（表名段白名单 + 长度），不合法抛错
 * @param column 列名
 */
export const assertPluginColumnName = (column: string): void => {
  if (
    !PLUGIN_DB_IDENTIFIER_PATTERN.test(column) ||
    column.length > PLUGIN_DB_IDENTIFIER_MAX_LENGTH
  ) {
    throw new Error(`[plugin-db] 非法列名："${column}"`);
  }
};

/**
 * 校验一组列声明（非空、无重复、列名全部合法），不合法抛错
 * @param columns 列声明列表
 * @returns 列名 → 声明的映射（方便调用方按列序列化）
 */
export const toColumnMap = (columns: readonly PluginDbColumn[]): Map<string, PluginDbColumn> => {
  if (columns.length === 0) {
    throw new Error('[plugin-db] 建表至少需要一列');
  }
  const map = new Map<string, PluginDbColumn>();
  for (const column of columns) {
    assertPluginColumnName(column.name);
    if (map.has(column.name)) {
      throw new Error(`[plugin-db] 重复列名："${column.name}"`);
    }
    map.set(column.name, column);
  }
  return map;
};

/**
 * 生成建表 DDL（含宿主自动维护的 id / created_at / updated_at 三列）
 * @param tableName 物理表名（须先过 resolvePluginTableName）
 * @param columns 列声明
 * @returns 单条 CREATE TABLE IF NOT EXISTS 语句
 */
export const buildCreateTableSql = (
  tableName: string,
  columns: readonly PluginDbColumn[],
): string => {
  const columnLines = columns
    .map((column) => `  ${column.name} ${PLUGIN_DB_COLUMN_TYPE_MAP[column.type]}`)
    .join(',\n');
  return `CREATE TABLE IF NOT EXISTS ${tableName} (
  ${PLUGIN_DB_ID_COLUMN} INTEGER PRIMARY KEY AUTOINCREMENT,
${columnLines},
  ${PLUGIN_DB_CREATED_AT_COLUMN} INTEGER NOT NULL,
  ${PLUGIN_DB_UPDATED_AT_COLUMN} INTEGER NOT NULL
)`;
};

/**
 * 生成列索引 DDL 列表（仅 indexed 列）
 * @param tableName 物理表名
 * @param columns 列声明
 * @returns CREATE INDEX IF NOT EXISTS 语句数组（无索引列时为空）
 */
export const buildCreateIndexSqlList = (
  tableName: string,
  columns: readonly PluginDbColumn[],
): string[] =>
  columns
    .filter((column) => column.indexed === true)
    .map((column) => `CREATE INDEX IF NOT EXISTS idx_${tableName}_${column.name} ON ${tableName}(${column.name})`);

/**
 * 生成补列 DDL（`ALTER TABLE … ADD COLUMN`）
 *
 * 为什么需要：SQLite 的 `CREATE TABLE IF NOT EXISTS` 对**已存在**的表什么都不做，
 * 于是插件给老表新增列时物理列不会自动出现 —— 缺列会让插件对新列的写入直接报
 * 「table has no column named x」。补列与「声明式建表」语义一致：
 * 插件只管声明完整列集，宿主负责把库补齐。
 *
 * 只生成可空列（不带 NOT NULL / UNIQUE / DEFAULT）：SQLite 的 ADD COLUMN 对
 * 带约束的列限制很多，而插件表新增列本就该由插件自己在读取时兜底默认值。
 * @param tableName 物理表名（须先过 resolvePluginTableName）
 * @param column 列声明
 * @returns 单条 ALTER TABLE ADD COLUMN 语句
 */
export const buildAddColumnSql = (tableName: string, column: PluginDbColumn): string =>
  `ALTER TABLE ${tableName} ADD COLUMN ${column.name} ${PLUGIN_DB_COLUMN_TYPE_MAP[column.type]}`;

/**
 * 序列化一个单元格值（写入方向：json 列 stringify，其余原样；undefined 归 null）
 * @param value 原始值
 * @param type 列类型
 * @returns 可写入 SQLite 的值
 */
export const serializePluginCell = (value: unknown, type: PluginDbColumnType): unknown => {
  if (value === undefined) return null;
  if (type === 'json') return JSON.stringify(value);
  return value;
};

/**
 * 反序列化一个单元格值（读取方向：json 列 parse，损坏原文兜底返回原串）
 * @param value 库里读出的值
 * @param type 列类型
 * @returns 插件侧的原始值
 */
export const deserializePluginCell = (value: unknown, type: PluginDbColumnType): unknown => {
  if (type !== 'json') return value;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

/**
 * 复制一行并附带宿主维护字段（读出方向的统一映射）
 *
 * 插件侧统一 camelCase（`id` / `createdAt` / `updatedAt`），
 * 与库里 snake_case 的 created_at / updated_at 列在此处一一对应。
 * @param row 已按列反序列化的业务字段
 * @param meta 宿主维护字段（id / createdAt / updatedAt）
 * @returns 带 id / createdAt / updatedAt 的完整行
 */
export const withMetaColumns = <T extends Record<string, unknown>>(
  row: T,
  meta: PluginDbMetaFields,
): T & PluginDbMetaFields => ({ ...row, ...meta });

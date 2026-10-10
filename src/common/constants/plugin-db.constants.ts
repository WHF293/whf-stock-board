/**
 * 插件通用数据库（ctx.db）常量
 *
 * 每插件独立表：物理表名 = `plugin_<插件id>_<表名>`，插件之间天然隔离；
 * 插件只做「声明式建表 + CRUD」，SQL 一律由宿主生成（安全边界，见 plugin-db-sql.ts）。
 */

/** 插件动态表名前缀 */
export const PLUGIN_DB_TABLE_PREFIX = 'plugin_';

/** 合法标识符形态（表名段 / 列名共用；小写开头，只允许小写字母数字下划线） */
export const PLUGIN_DB_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/;

/** 标识符最大长度（表名段 / 列名共用，防超长 SQL） */
export const PLUGIN_DB_IDENTIFIER_MAX_LENGTH = 48;

/** 主键列名（宿主自动生成） */
export const PLUGIN_DB_ID_COLUMN = 'id';

/** 创建时间列名（毫秒时间戳，宿主自动维护） */
export const PLUGIN_DB_CREATED_AT_COLUMN = 'created_at';

/** 更新时间列名（毫秒时间戳，宿主自动维护） */
export const PLUGIN_DB_UPDATED_AT_COLUMN = 'updated_at';

/**
 * 宿主保留列名 —— 插件**不得**在自己的列声明里出现
 *
 * 这三列由宿主自动维护（主键 + 创建/更新时间），`buildCreateTableSql` 固定追加。
 * 插件若重复声明，生成的建表语句里会出现两个同名列，SQLite 直接报
 * `duplicate column name: updated_at` —— 这个文案指向不了「与宿主保留列冲突」的真实原因，
 * 排查成本极高（本次 dsh-mainline 踩过），因此宿主在声明校验阶段就拒绝并给出明确提示。
 */
export const PLUGIN_DB_RESERVED_COLUMNS: readonly string[] = [
  PLUGIN_DB_ID_COLUMN,
  PLUGIN_DB_CREATED_AT_COLUMN,
  PLUGIN_DB_UPDATED_AT_COLUMN,
];

/**
 * 插件列类型 → SQLite 存储类型映射
 *
 * `json` 列物理上存 TEXT（写入 JSON.stringify、读出 JSON.parse），承载任意可序列化值
 */
export const PLUGIN_DB_COLUMN_TYPE_MAP = {
  text: 'TEXT',
  integer: 'INTEGER',
  real: 'REAL',
  json: 'TEXT',
} as const;

/** 浏览器降级：每张插件表在 appStorage 里的键前缀（`plugin-db:<物理表名>`） */
export const PLUGIN_DB_FALLBACK_KEY_PREFIX = 'plugin-db:';

/** 表登记表在 appStorage 里的键（插件 id → 该插件声明的表名数组，卸载询问 / 删表用） */
export const PLUGIN_DB_TABLE_REGISTRY_KEY = 'plugin-db-tables';

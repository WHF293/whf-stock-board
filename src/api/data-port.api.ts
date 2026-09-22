import { isTauri } from '@tauri-apps/api/core';
import { appDataDir } from '@tauri-apps/api/path';
import { open, save } from '@tauri-apps/plugin-dialog';
import { mkdir, readDir, readTextFile, remove, writeTextFile } from '@tauri-apps/plugin-fs';
import Database from '@tauri-apps/plugin-sql';
import { appStorage } from '../utils/app-local-storage';
import {
  DATA_PORT_AGENT_DB_URL,
  DATA_PORT_BACKUP_DIR,
  DATA_PORT_BACKUP_KEEP,
  DATA_PORT_CHUNK_SIZE,
  DATA_PORT_FILE_PREFIX,
  DATA_PORT_FORMAT_VERSION,
  DATA_PORT_MANIFEST,
} from '../constants/data-port.constants';
import { APP_VERSION } from '../constants/app-info.constants';
import type {
  DataPortCategory,
  DataPortCategorySummary,
  DataPortDbId,
  DataPortFile,
  DataPortImportResult,
  DataPortTableSpec,
} from '../types/data-port.types';

/**
 * 数据迁移导出 / 导入唯一出口（方案：.ai/开发方案/2026-09-22-客户端-数据导出导入与跨机迁移方案.md）
 *
 * 导出 = 遍历 DATA_PORT_MANIFEST 勾选类别逐表 SELECT * / 读 localStorage 命名空间 → 单 JSON 文件；
 * 导入 = VACUUM INTO 备份涉及的库 → replace 表整表覆盖 / upsert 表按主键合并 → localStorage 命名空间回写。
 * 仅 Tauri 桌面端可用（SQLite 是 Tauri 专属；浏览器端无全量数据源，按钮由 UI 禁用）。
 *
 * 已知限制（方案 §8）：plugin-sql 无事务 API，写入为分块多值 INSERT 顺序执行，
 * 中途失败留半截数据 —— 由导入前 VACUUM INTO 快照兜底，导入完成由调用方整页 reload。
 */

/** 库连接单例（按 db id 缓存） */
const dbPromises: Partial<Record<DataPortDbId, Promise<Database>>> = {};

/** DB_URL_BY_ID 常量：db id → tauri-plugin-sql 连接串 */
const DB_URL_BY_ID: Record<DataPortDbId, string> = {
  'stock-board': 'sqlite:stock-board.db',
  agent: DATA_PORT_AGENT_DB_URL,
};

/**
 * SQL 标识符合法性校验（列名白名单兜底，杜绝导出文件内容拼进 SQL）
 * @param name 标识符
 * @returns 是否合法
 */
const isSafeIdentifier = (name: string): boolean => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);

/**
 * 引用 SQL 标识符（双引号）
 * @param name 标识符
 * @returns 带引号标识符
 */
const quoteIdent = (name: string): string => `"${name}"`;

/**
 * 惰性打开指定库（非 Tauri 抛错，调用方先经 isDataPortAvailable 拦截）
 * @param db 库 id
 * @returns 连接 Promise
 */
const getDb = (db: DataPortDbId): Promise<Database> => {
  dbPromises[db] ??= Database.load(DB_URL_BY_ID[db]);
  return dbPromises[db];
};

/**
 * 迁移功能是否可用（仅 Tauri 桌面端）
 * @returns 是否可用
 */
export const isDataPortAvailable = (): boolean => isTauri();

/**
 * 按 manifest 查类别（未登记的 id 返回 null）
 * @param id 类别 id
 * @returns 类别定义或 null
 */
const findCategory = (id: string): DataPortCategory | null =>
  DATA_PORT_MANIFEST.find((c) => c.id === id) ?? null;

/**
 * 统计某类别的当前数据量（导出弹窗展示用）
 * @param category 类别定义
 * @returns 各表行数（sqlite）或各命名空间字符长度（local-storage）
 */
const countCategory = async (category: DataPortCategory): Promise<Record<string, number>> => {
  const counts: Record<string, number> = {};
  if (category.storage === 'sqlite') {
    const conn = await getDb(category.db);
    for (const spec of category.tables ?? []) {
      const rows = await conn.select<{ n: number }[]>(
        `SELECT COUNT(*) AS n FROM ${quoteIdent(spec.table)}`,
      );
      counts[spec.table] = rows[0]?.n ?? 0;
    }
    return counts;
  }
  for (const ns of category.nsKeys ?? []) {
    counts[ns] = appStorage.getItem(ns)?.length ?? 0;
  }
  for (const key of category.independentKeys ?? []) {
    counts[key] = localStorage.getItem(key)?.length ?? 0;
  }
  return counts;
};

/**
 * 统计全部类别的数据量（导出弹窗打开时一次性取）
 * @returns 类别 id → 计数表（非 Tauri 环境返回空表，UI 侧入口已禁用）
 */
export const countAllCategories = async (): Promise<Record<string, Record<string, number>>> => {
  if (!isDataPortAvailable()) return {};
  const result: Record<string, Record<string, number>> = {};
  for (const category of DATA_PORT_MANIFEST) {
    result[category.id] = await countCategory(category);
  }
  return result;
};

/**
 * 生成导出文件名（whf-stock-board-YYYYMMDD-HHmm.json）
 * @returns 文件名
 */
const buildExportFileName = (): string => {
  const now = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${DATA_PORT_FILE_PREFIX}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}.json`
  );
};

/**
 * 弹出系统「另存为」对话框选择导出路径
 * @returns 用户确认的绝对路径；取消为 null
 */
export const pickExportPath = async (): Promise<string | null> => {
  const path = await save({
    defaultPath: buildExportFileName(),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  return path ?? null;
};

/**
 * 收集某类别的导出数据与行数
 * @param category 类别定义
 * @returns 数据体（sqlite: 表 → 行数组；local-storage: ns → 原始串）与计数表
 */
const collectCategory = async (
  category: DataPortCategory,
): Promise<{ data: Record<string, unknown>; summary: DataPortCategorySummary }> => {
  const data: Record<string, unknown> = {};
  const counts: Record<string, number> = {};
  if (category.storage === 'sqlite') {
    const conn = await getDb(category.db);
    for (const spec of category.tables ?? []) {
      const rows = await conn.select<Record<string, unknown>[]>(
        `SELECT * FROM ${quoteIdent(spec.table)}`,
      );
      data[spec.table] = rows;
      counts[spec.table] = rows.length;
    }
  } else {
    for (const ns of category.nsKeys ?? []) {
      const raw = appStorage.getItem(ns);
      if (raw !== null) {
        data[ns] = raw;
        counts[ns] = raw.length;
      }
    }
    for (const key of category.independentKeys ?? []) {
      const raw = localStorage.getItem(key);
      if (raw !== null) {
        data[key] = raw;
        counts[key] = raw.length;
      }
    }
  }
  return { data, summary: { id: category.id, counts } };
};

/**
 * 导出勾选类别到指定路径（单 JSON 文件）
 * @param path 目标文件绝对路径（pickExportPath 返回值）
 * @param selectedIds 勾选的类别 id 列表
 * @returns 文件字符长度（供成功提示展示）；无可导出数据返回 0
 */
export const exportDataPort = async (path: string, selectedIds: readonly string[]): Promise<number> => {
  const data: Record<string, Record<string, unknown>> = {
    'stock-board': {},
    agent: {},
    localStorage: {},
  };
  const categories: DataPortCategorySummary[] = [];
  for (const id of selectedIds) {
    const category = findCategory(id);
    if (!category) continue;
    const { data: categoryData, summary } = await collectCategory(category);
    const bucket =
      category.storage === 'sqlite' ? data[category.db] : data.localStorage;
    Object.assign(bucket, categoryData);
    categories.push(summary);
  }
  const file: DataPortFile = {
    formatVersion: DATA_PORT_FORMAT_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    categories,
    data,
  };
  const text = JSON.stringify(file);
  await writeTextFile(path, text);
  return text.length;
};

/**
 * 弹出系统「打开文件」对话框并解析导出文件
 * @returns 解析后的导出文件；用户取消返回 null
 * @throws Error 文件不可读 / 不是合法 JSON / 格式版本高于当前版本
 */
export const pickAndParseImportFile = async (): Promise<DataPortFile | null> => {
  const selected = await open({
    multiple: false,
    directory: false,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (typeof selected !== 'string') return null;
  const text = await readTextFile(selected);
  let file: DataPortFile;
  try {
    file = JSON.parse(text) as DataPortFile;
  } catch {
    throw new Error('文件不是合法的 JSON，无法解析');
  }
  if (
    typeof file.formatVersion !== 'number' ||
    typeof file.data !== 'object' ||
    file.data === null ||
    !Array.isArray(file.categories)
  ) {
    throw new Error('文件结构不符合导出格式，无法导入');
  }
  if (file.formatVersion > DATA_PORT_FORMAT_VERSION) {
    throw new Error(
      `导出文件格式版本（v${file.formatVersion}）高于当前版本（v${DATA_PORT_FORMAT_VERSION}），请先升级应用`,
    );
  }
  return file;
};

/**
 * 清理单条文本值中的单引号（拼进 VACUUM INTO 字面量前的转义）
 * @param value 原始文本
 * @returns 转义后的文本
 */
const escapeSqlLiteral = (value: string): string => value.replaceAll("'", "''");

/**
 * 备份涉及的库（VACUUM INTO 一致性快照到 appDataDir/backups/pre-import-<ts>/）
 * @param dbIds 需要备份的库
 */
const backupDatabases = async (dbIds: readonly DataPortDbId[]): Promise<void> => {
  if (dbIds.length === 0) return;
  const baseDir = await appDataDir();
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, '-');
  const dir = `${baseDir}/${DATA_PORT_BACKUP_DIR}/pre-import-${stamp}/`;
  await mkdir(dir, { recursive: true }).catch(() => undefined);
  for (const db of dbIds) {
    const target = `${dir}${db}.db`;
    const conn = await getDb(db);
    await conn.execute(`VACUUM INTO '${escapeSqlLiteral(target)}'`);
  }
  await pruneOldBackups(`${baseDir}/${DATA_PORT_BACKUP_DIR}`);
};

/**
 * 清理过期备份（保留最近 DATA_PORT_BACKUP_KEEP 份，目录名含时间戳可排序）
 * @param root 备份根目录绝对路径
 */
const pruneOldBackups = async (root: string): Promise<void> => {
  const entries = await readDir(root).catch(() => []);
  const dirs = entries
    .filter((e) => e.isDirectory && e.name.startsWith('pre-import-'))
    .map((e) => e.name)
    .sort();
  const excess = dirs.slice(0, Math.max(0, dirs.length - DATA_PORT_BACKUP_KEEP));
  for (const name of excess) {
    await remove(`${root}/${name}`, { recursive: true }).catch(() => undefined);
  }
};

/**
 * 从行对象提取合法列名（宽松模式：非法列直接丢弃，兼容版本偏斜）
 * @param rows 数据行
 * @returns 合法列名列表
 */
const pickColumns = (rows: readonly Record<string, unknown>[]): string[] => {
  const seen = new Set<string>();
  const columns: string[] = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (isSafeIdentifier(key) && !seen.has(key)) {
        seen.add(key);
        columns.push(key);
      }
    }
  }
  return columns;
};

/**
 * 分块写入一张表（upsert: ON CONFLICT(pk) DO UPDATE；replace 的清表由调用方统一按 FK 逆序执行）
 * @param conn 数据库连接
 * @param spec 表登记项
 * @param rows 数据行
 * @returns 写入行数
 */
const writeTable = async (
  conn: Database,
  spec: DataPortTableSpec,
  rows: readonly Record<string, unknown>[],
): Promise<number> => {
  const table = quoteIdent(spec.table);
  if (spec.writeMode === 'replace') {
    await conn.execute(`DELETE FROM ${table}`);
  }
  if (rows.length === 0) return 0;
  const columns = pickColumns(rows);
  if (columns.length === 0) return 0;
  const columnList = columns.map(quoteIdent).join(', ');
  const updateSet =
    spec.writeMode === 'upsert' && spec.pk
      ? ` ON CONFLICT(${quoteIdent(spec.pk)}) DO UPDATE SET ` +
        columns
          .filter((c) => c !== spec.pk)
          .map((c) => `${quoteIdent(c)} = excluded.${quoteIdent(c)}`)
          .join(', ')
      : '';
  let written = 0;
  for (let start = 0; start < rows.length; start += DATA_PORT_CHUNK_SIZE) {
    const chunk = rows.slice(start, start + DATA_PORT_CHUNK_SIZE);
    const placeholders = chunk
      .map(
        (_, rowIdx) =>
          `(${columns.map((__, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`).join(', ')})`,
      )
      .join(', ');
    const params: unknown[] = [];
    for (const row of chunk) {
      for (const col of columns) {
        const value = row[col];
        params.push(value === undefined ? null : value);
      }
    }
    const result = await conn.execute(
      `INSERT INTO ${table} (${columnList}) VALUES ${placeholders}${updateSet}`,
      params,
    );
    written += result.rowsAffected ?? 0;
  }
  return written;
};

/**
 * 导入勾选类别（先备份涉及的库，再覆盖 / 合并写入；完成后调用方需整页 reload）
 * @param file 解析后的导出文件
 * @param selectedIds 勾选的类别 id（必须包含在文件里）
 * @returns 写入统计与被跳过的未知类别
 */
export const importDataPort = async (
  file: DataPortFile,
  selectedIds: readonly string[],
): Promise<DataPortImportResult> => {
  const knownIds = new Set(selectedIds);
  const skipped = file.categories
    .map((c) => c.id)
    .filter((id) => !DATA_PORT_MANIFEST.some((m) => m.id === id));
  const selectedCategories = DATA_PORT_MANIFEST.filter((c) => knownIds.has(c.id));
  const sqliteCategories = selectedCategories.filter((c) => c.storage === 'sqlite');
  const dbIds = [...new Set(sqliteCategories.map((c) => c.db))];
  await backupDatabases(dbIds);

  const written: Record<string, number> = {};
  for (const category of selectedCategories) {
    let count = 0;
    if (category.storage === 'sqlite') {
      const conn = await getDb(category.db);
      // 表按登记顺序写（满足 FK 依赖），replace 清表按逆序删（先子后父）
      const tables = [...(category.tables ?? [])];
      for (const spec of tables) {
        if (spec.writeMode === 'replace') {
          await conn.execute(`DELETE FROM ${quoteIdent(spec.table)}`);
        }
      }
      for (const spec of tables) {
        const rows = (file.data[category.db]?.[spec.table] ?? []) as Record<string, unknown>[];
        count += await writeTable(conn, spec, rows);
      }
    } else {
      const nsData = file.data.localStorage ?? {};
      for (const ns of category.nsKeys ?? []) {
        const raw = nsData[ns];
        if (typeof raw === 'string') {
          appStorage.setItem(ns, raw);
          count += 1;
        }
      }
      for (const key of category.independentKeys ?? []) {
        const raw = nsData[key];
        if (typeof raw === 'string') {
          localStorage.setItem(key, raw);
          count += 1;
        }
      }
    }
    written[category.id] = count;
  }
  return { written, skipped };
};

/**
 * 计算导入预览信息（文件里实际包含的类别）
 * @param file 解析后的导出文件
 * @returns 类别 id → 计数表（仅文件中包含的键）
 */
export const summarizeImportFile = (file: DataPortFile): Record<string, Record<string, number>> => {
  const result: Record<string, Record<string, number>> = {};
  for (const summary of file.categories) {
    result[summary.id] = summary.counts;
  }
  return result;
};

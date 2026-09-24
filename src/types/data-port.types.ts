/**
 * 数据迁移（导出 / 导入）类型定义
 *
 * 迁移通道由登记表驱动：`src/constants/data-port.constants.ts` 的 `DATA_PORT_MANIFEST`
 * 按类别登记 SQLite 表与 localStorage 命名空间，导出 / 导入逻辑只遍历 manifest。
 * 新增本地持久化数据必须同步登记（规范见 AGENTS.md「数据迁移登记规范」），
 * 镜像类键（真身在他处）与 weblog 日志表禁止登记。
 */

/** 迁移覆盖的数据库 */
export type DataPortDbId = 'stock-board' | 'agent';

/** 表写入语义 */
export type DataPortWriteMode = 'replace' | 'upsert';

/** 单表登记项（SQLite） */
export interface DataPortTableSpec {
  /** SQL 表名（同时是导出文件里 data[db][table] 的键） */
  table: string;
  /** checkbox 展示名 */
  label: string;
  /**
   * replace：DELETE 全表再插入（镜像数据，整表覆盖）；
   * upsert：ON CONFLICT(pk) DO UPDATE（配置数据，保留本机多余行；不使用
   * INSERT OR REPLACE —— 其「先删后插」语义会触发 FK ON DELETE SET NULL 置空引用）
   */
  writeMode: DataPortWriteMode;
  /** upsert 模式的主键列名（replace 模式忽略） */
  pk?: string;
}

/** 数据迁移类别（manifest 登记项 / 导出弹窗 checkbox 一项） */
export interface DataPortCategory {
  /** 类别 id（导出文件 categories[].id 引用，发布后不可改名） */
  id: string;
  /** checkbox 展示名 */
  label: string;
  /** 所属库（storage 为 local-storage 时忽略） */
  db: DataPortDbId;
  /** 存储类型：sqlite 表组 / localStorage 命名空间组 */
  storage: 'sqlite' | 'local-storage';
  /** SQLite 表组（storage: 'sqlite' 时必填，顺序 = 写入顺序，须满足 FK 依赖） */
  tables?: readonly DataPortTableSpec[];
  /** whf:app 整包内的命名空间白名单（storage: 'local-storage' 时必填） */
  nsKeys?: readonly string[];
  /** whf:app 之外的独立 localStorage key（如 whf:sector-flow-history） */
  independentKeys?: readonly string[];
  /** 导出弹窗默认是否勾选 */
  defaultEnabled: boolean;
  /** 勾选提示（体积 / 不可再生等说明） */
  tip?: string;
}

/** 导出文件里的类别摘要（行数统计，导入前预览用） */
export interface DataPortCategorySummary {
  id: string;
  /** sqlite 表 → 行数；local-storage 类别为各 ns 的字符长度 */
  counts: Record<string, number>;
}

/** 数据迁移导出文件（单 JSON 文件，自含元信息） */
export interface DataPortFile {
  /** 导出格式版本（导入端只接受 <= 当前 DATA_PORT_FORMAT_VERSION） */
  formatVersion: number;
  /** 导出端应用版本 */
  appVersion: string;
  /** 导出时间（ISO 8601） */
  exportedAt: string;
  /** 实际包含的类别与行数 */
  categories: DataPortCategorySummary[];
  /**
   * 数据体：键为 db id（'stock-board' | 'agent'）时值是 表名 → 行数组；
   * 键为 'localStorage' 时值是 命名空间 → 原始 JSON 串（appStorage.getItem 原文，不解析）
   */
  data: Record<string, Record<string, unknown>>;
}

/** 导入结果统计 */
export interface DataPortImportResult {
  /** 各类别写入行数 */
  written: Record<string, number>;
  /** 文件里存在但当前版本无法识别而被跳过的类别 id */
  skipped: string[];
}

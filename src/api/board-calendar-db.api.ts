import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { BOARD_DB_URL, BOARD_SYNC_STATE_KEY } from '../constants/board-calendar.constants';
import type {
  BoardCalendarMeta,
  BoardConstituent,
  BoardDailyRow,
  BoardLimitStock,
  BoardProfile,
  BoardSyncStateKey,
  TradingDatesCache,
} from '../types/board-calendar.types';

/**
 * stock-board.db 唯一落库出口
 *
 * 职责：
 * - 持有 `sqlite:stock-board.db` 连接单例（插件 migration 负责建表，见 src-tauri/src/lib.rs）；
 * - 蛇形行 → 驼峰接口的映射边界（UI 层不接触原始行）；
 * - 浏览器端降级：非 Tauri 环境一律返回空 / no-op，页面据此提示「历史累积需桌面客户端」。
 *
 * 约束：业务代码不允许绕过本文件直接 `load()` stock-board.db。
 *
 * 说明：@tauri-apps/plugin-sql 未暴露事务 API（连接来自内部连接池，
 * 手动 BEGIN/COMMIT 无法保证同一连接），故与既有 `use-agent-db` 一致，
 * 批量写入采用分块多值 INSERT 顺序执行。
 */

/** 连接单例（Database.load 自带插件 migration，建表在 Rust 侧） */
let dbPromise: Promise<Database> | null = null;

/** 单条 SQL 的最大行数（多值 INSERT 分块大小，控制占位符总数） */
const INSERT_CHUNK_ROWS = 100;

/** DB 原始行（蛇形列，类型宽松） */
type Row = Record<string, unknown>;

/**
 * 行取值兜底（字符串）
 * @param v DB 原始值
 * @returns 字符串值
 */
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/**
 * 行取值兜底（数值，空值按 0）
 * @param v DB 原始值
 * @returns 数值
 */
const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0) || 0);

/**
 * 行取值兜底（可空数值）
 * @param v DB 原始值
 * @returns 数值或 null
 */
const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/**
 * 行取值兜底（布尔，0/1 → false/true）
 * @param v DB 原始值
 * @returns 布尔值
 */
const bool = (v: unknown): boolean => v === 1 || v === true;

/**
 * 获取 stock-board.db 连接（懒加载单例）
 * @returns 连接实例；浏览器端（非 Tauri）为 null
 */
export const getBoardDb = async (): Promise<Database | null> => {
  if (!isTauri()) {
    return null;
  }
  if (dbPromise === null) {
    // 只做 load：本库 5 张表无任何外键约束，故不需要 PRAGMA foreign_keys
    // （且 load 仅需 sql:allow-load，不会因缺少其它权限而让**读**路径一起失败）
    const created = Database.load(BOARD_DB_URL);
    dbPromise = created;
    // 首次连接失败时清空单例，允许后续重试（否则全部调用都会命中已 reject 的 Promise）
    created.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
};

/**
 * 当前环境是否支持本地库（决定页面是否降级为「仅当日、不累积」）
 * @returns true 表示可用（桌面客户端）
 */
export const isBoardDbAvailable = (): boolean => isTauri();

/**
 * 生成多值 INSERT 的 VALUES 占位符片段
 * @param rowCount 行数
 * @param colCount 每行列数
 * @returns 形如 `($1,$2),($3,$4)` 的片段
 */
const buildValuesClause = (rowCount: number, colCount: number): string => {
  const groups: string[] = [];
  for (let r = 0; r < rowCount; r += 1) {
    const slots: string[] = [];
    for (let c = 0; c < colCount; c += 1) {
      slots.push(`$${r * colCount + c + 1}`);
    }
    groups.push(`(${slots.join(',')})`);
  }
  return groups.join(',');
};

/**
 * 数组分块
 * @param items 原始数组
 * @param size 每块大小
 * @returns 分块后的二维数组
 */
const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }
  return result;
};

/**
 * 日期格式校验（防止把外部字符串拼进 SQL）
 * @param date 交易日
 * @returns 是否合法
 */
const isValidDate = (date: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(date);

/* --------------------------------- 行映射 --------------------------------- */

/**
 * board_profile 行 → BoardProfile
 * @param r DB 原始行
 * @returns 板块档案
 */
const toProfile = (r: Row): BoardProfile => ({
  code: str(r.code),
  name: str(r.name),
  sortOrder: num(r.sort_order),
  consCount: num(r.cons_count),
  updatedAt: num(r.updated_at),
});

/**
 * board_daily 行 → BoardDailyRow
 * @param r DB 原始行
 * @returns 板块日聚合
 */
const toDaily = (r: Row): BoardDailyRow => ({
  tradeDate: str(r.trade_date),
  boardCode: str(r.board_code),
  boardName: str(r.board_name),
  changePercent: numOrNull(r.change_percent),
  amount: numOrNull(r.amount),
  limitUp: num(r.limit_up),
  limitDown: num(r.limit_down),
  upCount: num(r.up_count),
  downCount: num(r.down_count),
  flatCount: num(r.flat_count),
  consCount: num(r.cons_count),
  score: num(r.score),
  scoreRate: num(r.score_rate),
  dataLevel: num(r.data_level),
  snapshotAt: num(r.snapshot_at),
  isFinal: bool(r.is_final),
});

/**
 * board_limit_stock 行 → BoardLimitStock
 * @param r DB 原始行
 * @returns 涨跌停个股
 */
const toLimitStock = (r: Row): BoardLimitStock => ({
  tradeDate: str(r.trade_date),
  boardCode: str(r.board_code),
  symbol: str(r.symbol),
  name: str(r.name),
  limitType: num(r.limit_type),
  changePercent: numOrNull(r.change_percent),
  price: numOrNull(r.price),
  amount: numOrNull(r.amount),
  turnoverRate: numOrNull(r.turnover_rate),
  sealTime: (r.seal_time as string | null) ?? null,
  openTimes: numOrNull(r.open_times),
  limitStreak: numOrNull(r.limit_streak),
});

/**
 * board_calendar_meta 行 → BoardCalendarMeta
 * @param r DB 原始行
 * @returns 采集台账
 */
const toMeta = (r: Row): BoardCalendarMeta => ({
  tradeDate: str(r.trade_date),
  dataLevel: num(r.data_level),
  isFinal: bool(r.is_final),
  limitUpCnt: num(r.limit_up_cnt),
  limitDownCnt: num(r.limit_down_cnt),
  constituentSyncedAt: num(r.constituent_synced_at),
  updatedAt: num(r.updated_at),
});

/* --------------------------------- 板块档案 --------------------------------- */

/**
 * 批量写入板块档案（含成分股数与行序）
 * @param profiles 板块档案（板块池全部板块）
 */
export const upsertBoardProfiles = async (profiles: BoardProfile[]): Promise<void> => {
  const db = await getBoardDb();
  if (!db || profiles.length === 0) return;
  const sql =
    `INSERT INTO board_profile (code, name, sort_order, cons_count, updated_at) VALUES ` +
    `${buildValuesClause(profiles.length, 5)} ` +
    `ON CONFLICT(code) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order, ` +
    `cons_count = excluded.cons_count, updated_at = excluded.updated_at`;
  const params = profiles.flatMap((p) => [
    p.code,
    p.name,
    p.sortOrder,
    p.consCount,
    p.updatedAt,
  ]);
  await db.execute(sql, params);
};

/**
 * 读取全部板块档案（按行序升序）
 * @returns 板块档案数组
 */
export const listBoardProfiles = async (): Promise<BoardProfile[]> => {
  const db = await getBoardDb();
  if (!db) return [];
  const rows = await db.select<Row[]>('SELECT * FROM board_profile ORDER BY sort_order, code');
  return rows.map(toProfile);
};

/* -------------------------------- 成分股映射 -------------------------------- */

/**
 * 重建成分股映射（按板块先删后插）
 *
 * 实测 31 个一级行业合计 5621 条，按 INSERT_CHUNK_ROWS 分块写。
 * 追加的热门板块与一级行业重叠时，同一 symbol 会有多行（主键含 board_code），
 * 故 `INSERT OR REPLACE` 只会覆盖「同板块同股票」那一条，不会互相顶掉。
 * @param boardCode 板块代码
 * @param items 该板块成分股（symbol / name / market）
 */
export const replaceConstituents = async (
  boardCode: string,
  items: Array<Pick<BoardConstituent, 'symbol' | 'stockName' | 'market'>>,
): Promise<void> => {
  const db = await getBoardDb();
  if (!db) return;
  await db.execute('DELETE FROM board_constituent WHERE board_code = $1', [boardCode]);
  const updatedAt = Date.now();
  for (const part of chunk(items, INSERT_CHUNK_ROWS)) {
    const sql =
      `INSERT OR REPLACE INTO board_constituent (board_code, symbol, stock_name, market, updated_at) VALUES ` +
      `${buildValuesClause(part.length, 5)}`;
    await db.execute(
      sql,
      part.flatMap((item) => [boardCode, item.symbol, item.stockName, item.market, updatedAt]),
    );
  }
};

/**
 * 读取「个股 → 板块」映射（涨停 / 跌停归组用）
 *
 * ⚠️ **一对多**：板块池含追加的热门板块（半导体 / 航天航空 / 机器人 / 光伏设备 / 新能源），
 * 一只票同时属于其一级行业与命中的追加板块（`board_constituent` 主键为
 * (board_code, symbol)），故这里必须返回数组——
 * 退化成单个字符串会让两只板块互相覆盖（后写入的赢），涨停家数随机偏到某一边。
 * @returns symbol → boardCode 列表（顺序不定）
 */
export const listConstituentBoardMap = async (): Promise<Map<string, string[]>> => {
  const db = await getBoardDb();
  if (!db) return new Map();
  const rows = await db.select<Row[]>('SELECT symbol, board_code FROM board_constituent');
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const symbol = str(row.symbol);
    const code = str(row.board_code);
    const list = map.get(symbol);
    if (list) {
      list.push(code);
    } else {
      map.set(symbol, [code]);
    }
  }
  return map;
};

/**
 * 统计各板块的成分股条数（按板块分组）
 *
 * 用途：板块池新增板块后，7 天新鲜度窗口内的「整表重建」会被跳过，
 * 新板块的成分股映射就会一直缺到下一个窗口——采集侧据此只补「条数为 0」的板块。
 * @returns boardCode → 条数（无记录的板块不在 Map 中）
 */
export const countConstituentsByBoard = async (): Promise<Map<string, number>> => {
  const db = await getBoardDb();
  if (!db) return new Map();
  const rows = await db.select<Row[]>(
    'SELECT board_code, COUNT(*) AS total FROM board_constituent GROUP BY board_code',
  );
  const map = new Map<string, number>();
  for (const row of rows) {
    map.set(str(row.board_code), num(row.total));
  }
  return map;
};

/**
 * 统计成分股映射条数
 * @returns 条数
 */
export const countConstituents = async (): Promise<number> => {
  const db = await getBoardDb();
  if (!db) return 0;
  const rows = await db.select<Row[]>('SELECT COUNT(*) AS total FROM board_constituent');
  return num(rows[0]?.total);
};

/**
 * 读取成分股映射最近同步时间
 * @returns 时间戳（毫秒）；从未同步过为 0
 */
export const getConstituentSyncedAt = async (): Promise<number> => {
  const db = await getBoardDb();
  if (!db) return 0;
  const rows = await db.select<Row[]>(
    'SELECT MAX(updated_at) AS synced_at FROM board_constituent',
  );
  return num(rows[0]?.synced_at);
};

/* -------------------------------- 板块日聚合 -------------------------------- */

/**
 * 批量 upsert 板块日聚合（当日 / 回补日各一整轮板块池）
 * @param rows 板块日聚合行
 */
export const upsertBoardDaily = async (rows: BoardDailyRow[]): Promise<void> => {
  const db = await getBoardDb();
  if (!db || rows.length === 0) return;
  const sql =
    `INSERT INTO board_daily (trade_date, board_code, board_name, change_percent, amount, ` +
    `limit_up, limit_down, up_count, down_count, flat_count, cons_count, score, score_rate, ` +
    `data_level, snapshot_at, is_final) VALUES ${buildValuesClause(rows.length, 16)} ` +
    `ON CONFLICT(trade_date, board_code) DO UPDATE SET board_name = excluded.board_name, ` +
    `change_percent = excluded.change_percent, amount = excluded.amount, ` +
    `limit_up = excluded.limit_up, limit_down = excluded.limit_down, ` +
    `up_count = excluded.up_count, down_count = excluded.down_count, ` +
    `flat_count = excluded.flat_count, cons_count = excluded.cons_count, ` +
    `score = excluded.score, score_rate = excluded.score_rate, ` +
    `data_level = excluded.data_level, snapshot_at = excluded.snapshot_at, ` +
    `is_final = excluded.is_final`;
  const params = rows.flatMap((row) => [
    row.tradeDate,
    row.boardCode,
    row.boardName,
    row.changePercent,
    row.amount,
    row.limitUp,
    row.limitDown,
    row.upCount,
    row.downCount,
    row.flatCount,
    row.consCount,
    row.score,
    row.scoreRate,
    row.dataLevel,
    row.snapshotAt,
    row.isFinal ? 1 : 0,
  ]);
  await db.execute(sql, params);
};

/**
 * 读取指定交易日的板块日聚合
 * @param dates 交易日列表（`YYYY-MM-DD`）
 * @returns 板块日聚合行
 */
export const listBoardDailyByDates = async (dates: string[]): Promise<BoardDailyRow[]> => {
  const db = await getBoardDb();
  if (!db) return [];
  const valid = dates.filter(isValidDate);
  if (valid.length === 0) return [];
  const result: BoardDailyRow[] = [];
  for (const part of chunk(valid, INSERT_CHUNK_ROWS)) {
    const quoted = part.map((date) => `'${date}'`).join(',');
    const rows = await db.select<Row[]>(
      `SELECT * FROM board_daily WHERE trade_date IN (${quoted}) ORDER BY trade_date DESC, board_code`,
    );
    result.push(...rows.map(toDaily));
  }
  return result;
};

/**
 * 读取库内已有数据的交易日（倒序）
 * @returns 交易日数组（`YYYY-MM-DD`）
 */
export const listBoardDailyDates = async (): Promise<string[]> => {
  const db = await getBoardDb();
  if (!db) return [];
  const rows = await db.select<Row[]>(
    'SELECT DISTINCT trade_date FROM board_daily ORDER BY trade_date DESC',
  );
  return rows.map((row) => str(row.trade_date));
};

/**
 * 读取「已达指定数据级别」的交易日（倒序）
 *
 * 用途：板块池变更（新增 / 移除板块）后要重跑历史回补窗口，而
 * **完整快照日（data_level = 1）绝不能被回补行（data_level = 0）覆盖**——
 * 回补只有涨跌停、没有涨跌家数，重写会把这些日子的涨跌家数抹成 0。
 * 故此时用本函数把「完整快照日」当作已有数据处理（跳过），只重跑仅回补过的那些天。
 * @param dataLevel 数据级别（BOARD_DATA_LEVEL.FULL / PARTIAL）
 * @returns 交易日数组（`YYYY-MM-DD`）
 */
export const listBoardDailyDatesByDataLevel = async (dataLevel: number): Promise<string[]> => {
  const db = await getBoardDb();
  if (!db) return [];
  const rows = await db.select<Row[]>(
    'SELECT DISTINCT trade_date FROM board_daily WHERE data_level = $1 ORDER BY trade_date DESC',
    [dataLevel],
  );
  return rows.map((row) => str(row.trade_date));
};

/* ------------------------------- 涨跌停个股明细 ------------------------------- */

/**
 * 重建某交易日的涨跌停个股明细（先删当日再插）
 * @param tradeDate 交易日
 * @param rows 涨跌停个股（归属板块已按映射表填好）
 */
export const replaceLimitStocks = async (
  tradeDate: string,
  rows: BoardLimitStock[],
): Promise<void> => {
  const db = await getBoardDb();
  if (!db || !isValidDate(tradeDate)) return;
  await db.execute('DELETE FROM board_limit_stock WHERE trade_date = $1', [tradeDate]);
  for (const part of chunk(rows, INSERT_CHUNK_ROWS)) {
    const sql =
      `INSERT OR REPLACE INTO board_limit_stock (trade_date, board_code, symbol, name, limit_type, ` +
      `change_percent, price, amount, turnover_rate, seal_time, open_times, limit_streak) VALUES ` +
      `${buildValuesClause(part.length, 12)}`;
    await db.execute(
      sql,
      part.flatMap((row) => [
        row.tradeDate,
        row.boardCode,
        row.symbol,
        row.name,
        row.limitType,
        row.changePercent,
        row.price,
        row.amount,
        row.turnoverRate,
        row.sealTime,
        row.openTimes,
        row.limitStreak,
      ]),
    );
  }
};

/**
 * 读取某板块某交易日的涨跌停个股明细（弹窗表格）
 * @param tradeDate 交易日
 * @param boardCode 板块代码
 * @returns 涨跌停个股（涨停在前，按封板时间升序）
 */
export const listLimitStocks = async (
  tradeDate: string,
  boardCode: string,
): Promise<BoardLimitStock[]> => {
  const db = await getBoardDb();
  if (!db || !isValidDate(tradeDate)) return [];
  const rows = await db.select<Row[]>(
    `SELECT * FROM board_limit_stock WHERE trade_date = $1 AND board_code = $2 ` +
      `ORDER BY limit_type DESC, seal_time IS NULL, seal_time, symbol`,
    [tradeDate, boardCode],
  );
  return rows.map(toLimitStock);
};

/* --------------------------------- 采集台账 --------------------------------- */

/**
 * 读取某交易日的采集台账
 * @param tradeDate 交易日
 * @returns 台账；不存在时为 null
 */
export const getCalendarMeta = async (tradeDate: string): Promise<BoardCalendarMeta | null> => {
  const db = await getBoardDb();
  if (!db || !isValidDate(tradeDate)) return null;
  const rows = await db.select<Row[]>('SELECT * FROM board_calendar_meta WHERE trade_date = $1', [
    tradeDate,
  ]);
  return rows.length > 0 ? toMeta(rows[0]) : null;
};

/**
 * upsert 采集台账
 * @param meta 台账（constituentSyncedAt 传 0 表示本次不更新该字段）
 */
export const upsertCalendarMeta = async (meta: BoardCalendarMeta): Promise<void> => {
  const db = await getBoardDb();
  if (!db || !isValidDate(meta.tradeDate)) return;
  await db.execute(
    `INSERT INTO board_calendar_meta (trade_date, data_level, is_final, limit_up_cnt, limit_down_cnt, ` +
      `constituent_synced_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) ` +
      `ON CONFLICT(trade_date) DO UPDATE SET data_level = excluded.data_level, ` +
      `is_final = excluded.is_final, limit_up_cnt = excluded.limit_up_cnt, ` +
      `limit_down_cnt = excluded.limit_down_cnt, updated_at = excluded.updated_at, ` +
      `constituent_synced_at = CASE WHEN excluded.constituent_synced_at > 0 ` +
      `THEN excluded.constituent_synced_at ELSE board_calendar_meta.constituent_synced_at END`,
    [
      meta.tradeDate,
      meta.dataLevel,
      meta.isFinal ? 1 : 0,
      meta.limitUpCnt,
      meta.limitDownCnt,
      meta.constituentSyncedAt,
      meta.updatedAt,
    ],
  );
};

/* ------------------------------- 增量采集状态 ------------------------------- */

/** 增量状态原始记录 */
interface SyncStateRecord {
  /** 原始值（未解析） */
  value: string;
  /** 写入时间戳（毫秒） */
  updatedAt: number;
}

/**
 * 读取增量状态（board_sync_state 单键）
 * @param key 状态键
 * @returns 原始记录；不存在时为 null
 */
const readSyncState = async (key: BoardSyncStateKey): Promise<SyncStateRecord | null> => {
  const db = await getBoardDb();
  if (!db) return null;
  const rows = await db.select<Row[]>(
    'SELECT value, updated_at FROM board_sync_state WHERE key = $1',
    [key],
  );
  if (rows.length === 0) return null;
  return { value: str(rows[0].value), updatedAt: num(rows[0].updated_at) };
};

/**
 * 写入增量状态（board_sync_state 单键）
 * @param key 状态键
 * @param value 序列化后的值
 */
const writeSyncState = async (key: BoardSyncStateKey, value: string): Promise<void> => {
  const db = await getBoardDb();
  if (!db) return;
  await db.execute(
    'INSERT INTO board_sync_state (key, value, updated_at) VALUES ($1, $2, $3) ' +
      'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    [key, value, Date.now()],
  );
};

/**
 * 读取交易日轴缓存（避免每次采集都请求腾讯日 K）
 * @returns 交易日轴缓存；无缓存 / 内容损坏时为 null
 */
export const readTradingDatesCache = async (): Promise<TradingDatesCache | null> => {
  const record = await readSyncState(BOARD_SYNC_STATE_KEY.TRADE_DATES);
  if (record === null) return null;
  try {
    const parsed: unknown = JSON.parse(record.value);
    if (!Array.isArray(parsed)) return null;
    const dates = parsed.filter(
      (item): item is string => typeof item === 'string' && isValidDate(item),
    );
    return dates.length > 0 ? { dates, updatedAt: record.updatedAt } : null;
  } catch {
    // 缓存损坏（手改 / 写一半）→ 当作无缓存，下次重新拉取即可
    console.warn('[board-calendar] 交易日轴缓存解析失败，将重新拉取');
    return null;
  }
};

/**
 * 写入交易日轴缓存
 * @param dates 交易日轴（升序）
 */
export const writeTradingDatesCache = async (dates: string[]): Promise<void> => {
  await writeSyncState(BOARD_SYNC_STATE_KEY.TRADE_DATES, JSON.stringify(dates));
};

/**
 * 读取涨跌停池可回溯边界
 *
 * 边界 = 首次探测到空池的日期（候选日期升序 ⇒ 更早的日期同样不可达）。
 * @returns 边界日期（`YYYY-MM-DD`）；未探明时为 null
 */
export const readPoolBoundaryDate = async (): Promise<string | null> => {
  const record = await readSyncState(BOARD_SYNC_STATE_KEY.POOL_BOUNDARY_DATE);
  if (record === null || !isValidDate(record.value)) return null;
  return record.value;
};

/**
 * 写入涨跌停池可回溯边界
 * @param date 边界日期（`YYYY-MM-DD`）
 */
export const writePoolBoundaryDate = async (date: string): Promise<void> => {
  if (!isValidDate(date)) return;
  await writeSyncState(BOARD_SYNC_STATE_KEY.POOL_BOUNDARY_DATE, date);
};

/**
 * 读取板块池签名（板块代码按默认行序拼接）
 * @returns 签名；从未写过时为 null
 */
export const readBoardPoolSignature = async (): Promise<string | null> => {
  const record = await readSyncState(BOARD_SYNC_STATE_KEY.BOARD_POOL);
  return record === null ? null : record.value;
};

/**
 * 写入板块池签名
 * @param signature 板块代码按默认行序拼接的签名
 */
export const writeBoardPoolSignature = async (signature: string): Promise<void> => {
  await writeSyncState(BOARD_SYNC_STATE_KEY.BOARD_POOL, signature);
};

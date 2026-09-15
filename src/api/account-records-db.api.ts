import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { mergeSymbolTradeRecords } from '../utils/merge-symbol-trade-records';
import type { AccountTradeRecord, ImportKind } from '../types/account.types';

/**
 * 账户成交流水落库出口（stock-board.db，表见 src-tauri/src/lib.rs v4 迁移）
 *
 * 交割单 / 对账单两表同构（account_trade_record / account_statement_record），
 * 由 kind 映射表名；dedupe_key 唯一约束保证重复导入同一文件不产生重复行；
 * 浏览器端降级：非 Tauri 环境写入 no-op / 读取返回空
 */

/** 连接单例 */
let dbPromise: Promise<Database> | null = null;

/**
 * 取连接（仅 Tauri 环境）
 * @returns 连接 Promise；浏览器环境返回 null
 */
const getDb = (): Promise<Database> | null => {
  if (!isTauri()) return null;
  dbPromise ??= Database.load('sqlite:stock-board.db');
  return dbPromise;
};

/** kind → 表名 */
const TABLE_BY_KIND: Record<ImportKind, string> = {
  trade: 'account_trade_record',
  statement: 'account_statement_record',
};

/**
 * 去重键：账户 + 类型 + 日期时间 + 代码 + 成交编号
 * （同一文件重复导入、或交割单与对账单重叠期间，均不会产生重复行）
 * @param record 流水记录
 * @param kind 导入类型
 * @returns 去重键
 */
const buildDedupeKey = (record: AccountTradeRecord, kind: ImportKind): string =>
  [record.accountId, kind, record.tradeDate, record.tradeTime, record.symbol, record.dealNo].join(
    '|',
  );

/**
 * 批量写入成交流水（INSERT OR IGNORE，返回实际新增行数）
 * @param records 解析后的记录
 * @param kind 导入类型（决定目标表）
 * @returns 新增行数
 */
export const insertTradeRecords = async (
  records: AccountTradeRecord[],
  kind: ImportKind,
): Promise<number> => {
  const db = getDb();
  if (!db || records.length === 0) return 0;
  const table = TABLE_BY_KIND[kind];
  const conn = await db;
  let inserted = 0;
  for (const r of records) {
    const result = await conn.execute(
      `INSERT OR IGNORE INTO ${table} ` +
        '(id, account_id, trade_date, trade_time, symbol, stock_name, action, quantity, price, ' +
        'amount, balance, net_amount, after_amount, stamp_tax, commission, transfer_fee, ' +
        'entrust_fee, service_fee, contract_no, deal_no, market, dedupe_key, imported_at) ' +
        'VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)',
      [
        r.id,
        r.accountId,
        r.tradeDate,
        r.tradeTime,
        r.symbol,
        r.stockName,
        r.action,
        r.quantity,
        r.price,
        r.amount,
        r.balance,
        r.netAmount,
        r.afterAmount,
        r.stampTax,
        r.commission,
        r.transferFee,
        r.entrustFee,
        r.serviceFee,
        r.contractNo,
        r.dealNo,
        r.market,
        buildDedupeKey(r, kind),
        r.importedAt,
      ],
    );
    inserted += result.rowsAffected ?? 0;
  }
  return inserted;
};

/**
 * 数据库行 -> 流水记录（两表同构，共用映射）
 * @param r 数据行
 * @returns 流水记录
 */
const mapRow = (r: Record<string, unknown>): AccountTradeRecord => ({
  id: String(r.id),
  accountId: String(r.account_id),
  tradeDate: String(r.trade_date),
  tradeTime: String(r.trade_time),
  symbol: String(r.symbol),
  stockName: String(r.stock_name),
  action: String(r.action),
  quantity: Number(r.quantity),
  price: Number(r.price),
  amount: Number(r.amount),
  balance: r.balance === null ? null : Number(r.balance),
  netAmount: Number(r.net_amount),
  afterAmount: r.after_amount === null ? null : Number(r.after_amount),
  stampTax: Number(r.stamp_tax),
  commission: Number(r.commission),
  transferFee: Number(r.transfer_fee),
  entrustFee: Number(r.entrust_fee),
  serviceFee: Number(r.service_fee),
  contractNo: String(r.contract_no ?? ''),
  dealNo: String(r.deal_no ?? ''),
  market: String(r.market ?? ''),
  importedAt: Number(r.imported_at),
});

/**
 * 读取某账户的成交流水（按日期时间升序）
 * @param accountId 账户 id
 * @param kind 导入类型
 * @returns 流水记录
 */
export const listTradeRecords = async (
  accountId: string,
  kind: ImportKind,
): Promise<AccountTradeRecord[]> => {
  const db = getDb();
  if (!db) return [];
  const rows = await (
    await db
  ).select<Record<string, unknown>[]>(
    `SELECT * FROM ${TABLE_BY_KIND[kind]} WHERE account_id = $1 ORDER BY trade_date, trade_time`,
    [accountId],
  );
  return rows.map(mapRow);
};

/**
 * 读取个股的全部成交记录（供个股详情页「交易记录」）
 *
 * 交割单表覆盖更长历史（实测 2024-10 起）全量保留，对账单表只补充其缺失部分；
 * 合并与跨表去重口径见 utils/merge-symbol-trade-records
 * @param symbol 个股符号（sh600519 / 600519 形态均可）
 * @returns 成交记录（按日期时间倒序，最新在前）
 */
export const listTradeRecordsBySymbol = async (symbol: string): Promise<AccountTradeRecord[]> => {
  const db = getDb();
  if (!db) return [];
  const code = symbol.replace(/^(sh|sz|bj)/i, '');
  const conn = await db;
  const [tradeRows, statementRows] = await Promise.all([
    conn.select<Record<string, unknown>[]>(
      'SELECT * FROM account_trade_record WHERE symbol = $1',
      [code],
    ),
    conn.select<Record<string, unknown>[]>(
      'SELECT * FROM account_statement_record WHERE symbol = $1',
      [code],
    ),
  ]);
  return mergeSymbolTradeRecords(tradeRows.map(mapRow), statementRows.map(mapRow));
};

/**
 * 删除某账户的全部成交流水（两类表一起清，账户删除时级联）
 * @param accountId 账户 id
 */
export const deleteTradeRecordsByAccount = async (accountId: string): Promise<void> => {
  const db = getDb();
  if (!db) return;
  const conn = await db;
  await conn.execute('DELETE FROM account_trade_record WHERE account_id = $1', [accountId]);
  await conn.execute('DELETE FROM account_statement_record WHERE account_id = $1', [accountId]);
};

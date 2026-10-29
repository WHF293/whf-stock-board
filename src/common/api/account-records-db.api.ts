import { isTauri } from '@tauri-apps/api/core';
import Database from '@tauri-apps/plugin-sql';
import { mergeSymbolTradeRecords } from '../utils/merge-symbol-trade-records';
import type { AccountTradeRecord, ImportKind } from '../types/account.types.ts';

/**
 * 账户成交流水只读出口（stock-board.db，表见 src-tauri/src/lib.rs v4 迁移）
 *
 * 交割单 / 对账单两表同构（account_trade_record / account_statement_record），
 * 由 kind 映射表名。手工文件导入已下线，本模块仅保留读取与级联删除：
 * 现存数据为历史导入存量，后续由投资账本官方 MCP 同步接管写路径。
 * 浏览器端降级：非 Tauri 环境读取返回空
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

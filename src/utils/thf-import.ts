import type { AccountTradeRecord } from '../types/account.types';

/**
 * 同花顺导出文件（交割单 / 对账单）解析
 *
 * 文件实为 **GBK 编码的 TSV 文本**（扩展名 .xls 但非 Excel 二进制）：
 * 首行为表头，随后每行一条成交记录；交割单与对账单列序不同
 * （对账单多「备注」、交割单多「余额」），因此按**表头名**取列，不依赖列序。
 */

/** 表头名 → 记录字段（蛇形/变体在此统一收敛） */
const HEADER_ALIASES: Record<string, keyof ParsedRowSource> = {
  成交日期: 'tradeDate',
  成交时间: 'tradeTime',
  证券代码: 'symbol',
  证券名称: 'stockName',
  操作: 'action',
  成交数量: 'quantity',
  成交编号: 'dealNo',
  成交均价: 'price',
  成交金额: 'amount',
  余额: 'balance',
  发生金额: 'netAmount',
  后资金额: 'afterAmount',
  印花税: 'stampTax',
  合同编号: 'contractNo',
  交易市场: 'market',
  佣金: 'commission',
  过户费: 'transferFee',
  委托费: 'entrustFee',
  服务佣金及其他: 'serviceFee',
};

/** 原始行（表头名 → 单元格文本） */
type ParsedRowSource = Record<string, string>;

/** 解析错误（表头不识别 / 空文件等） */
export class ThfParseError extends Error {}

/**
 * YYYYMMDD → YYYY-MM-DD（非法输入原样返回）
 * @param raw 单元格原文（如 20260911）
 * @returns 标准日期（如 2026-09-11）
 */
const normalizeDate = (raw: string): string => {
  const m = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : raw;
};

/**
 * 单元格 → 数值（空串/非法返回兜底值）
 * @param raw 单元格原文
 * @param fallback 空值兜底
 * @returns 数值
 */
const toNumber = (raw: string | undefined, fallback = 0): number => {
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

/**
 * 解析同花顺导出文件（GBK TSV）为成交流水
 * @param file 导入的 File
 * @param accountId 所属账户 id
 * @returns 解析后的记录（含 id / importedAt，按日期时间升序）
 * @throws ThfParseError 表头无任何可识别列 / 无有效数据行
 */
export const parseThfTradeFile = async (
  file: File,
  accountId: string,
): Promise<AccountTradeRecord[]> => {
  // 同花顺为 GBK 编码；TextDecoder 原生支持 gbk，异常时退回 utf-8
  const buffer = await file.arrayBuffer();
  let text: string;
  try {
    text = new TextDecoder('gbk').decode(buffer);
  } catch {
    text = new TextDecoder('utf-8').decode(buffer);
  }

  const lines = text.split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length < 2) {
    throw new ThfParseError('文件为空或缺少数据行');
  }

  // 首行表头 → 列下标映射（列序无关；按别名表识别）
  const headers = lines[0].split('\t').map((h) => h.trim());
  const headerByIndex: (keyof ParsedRowSource | null)[] = headers.map(
    (h) => HEADER_ALIASES[h] ?? null,
  );
  if (headerByIndex.every((h) => h === null)) {
    throw new ThfParseError('未识别的表头，请确认导出的是同花顺交割单 / 对账单');
  }

  const now = Date.now();
  const records: AccountTradeRecord[] = [];
  for (const line of lines.slice(1)) {
    const cells = line.split('\t');
    const row: ParsedRowSource = {};
    headerByIndex.forEach((field, index) => {
      if (field) row[field] = (cells[index] ?? '').trim();
    });
    // 无日期 / 无代码的行视为无效行跳过（如可能的汇总行）
    if (!row.tradeDate || !row.symbol) continue;
    records.push({
      id: crypto.randomUUID(),
      accountId,
      tradeDate: normalizeDate(row.tradeDate),
      tradeTime: row.tradeTime ?? '',
      symbol: row.symbol,
      stockName: row.stockName ?? '',
      action: row.action ?? '',
      quantity: toNumber(row.quantity),
      price: toNumber(row.price),
      amount: toNumber(row.amount),
      balance: row.balance === undefined || row.balance === '' ? null : toNumber(row.balance),
      netAmount: toNumber(row.netAmount),
      afterAmount:
        row.afterAmount === undefined || row.afterAmount === ''
          ? null
          : toNumber(row.afterAmount),
      stampTax: toNumber(row.stampTax),
      commission: toNumber(row.commission),
      transferFee: toNumber(row.transferFee),
      entrustFee: toNumber(row.entrustFee),
      serviceFee: toNumber(row.serviceFee),
      contractNo: row.contractNo ?? '',
      dealNo: row.dealNo ?? '',
      market: row.market ?? '',
      importedAt: now,
    });
  }

  if (records.length === 0) {
    throw new ThfParseError('未解析到有效成交记录');
  }
  // 时间升序（同文件倒序导出，展示与汇总按正序更直观）
  records.sort((a, b) =>
    `${a.tradeDate}${a.tradeTime}`.localeCompare(`${b.tradeDate}${b.tradeTime}`),
  );
  return records;
};

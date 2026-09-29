import type { AccountTradeRecord } from '../types/account.types';

/**
 * 表格 → Excel 导出（SheetJS xlsx，动态 import 按需加载）
 *
 * 统一导出 .xlsx；列定义即导出列（跳过前端不展示的内部字段）
 */

/** 单数据集工作表的兜底 sheet 名 */
const DEFAULT_SHEET_NAME = '数据';

/** Excel 工作表名长度上限（Excel 规范） */
const SHEET_NAME_MAX_CHARS = 31;

/** Excel 工作表名非法字符（Excel 规范禁止 : \ / ? * [ ]） */
const SHEET_NAME_ILLEGAL_PATTERN = /[:\\/?*[\]]/g;

/** 列定义（label 为表头文案，key 为行字段名） */
interface ExportColumn {
  /** 表头文案 */
  label: string;
  /** 行字段名 */
  key: string;
}

/** 多 sheet 导出的单个工作表定义 */
export interface ExcelSheet {
  /** 工作表名（超长 / 非法字符自动清理，重名自动加序号） */
  name: string;
  /** 行数据 */
  rows: Record<string, unknown>[];
  /** 列定义 */
  columns: ExportColumn[];
}

/** 明细表列（交割单 / 对账单通用，对齐同花顺字段命名） */
export const TRADE_DETAIL_COLUMNS: { label: string; key: keyof AccountTradeRecord }[] = [
  { label: '日期', key: 'tradeDate' },
  { label: '时间', key: 'tradeTime' },
  { label: '代码', key: 'symbol' },
  { label: '名称', key: 'stockName' },
  { label: '操作', key: 'action' },
  { label: '成交数量', key: 'quantity' },
  { label: '成交均价', key: 'price' },
  { label: '成交金额', key: 'amount' },
  { label: '发生金额', key: 'netAmount' },
  { label: '印花税', key: 'stampTax' },
  { label: '佣金', key: 'commission' },
  { label: '过户费', key: 'transferFee' },
  { label: '委托费', key: 'entrustFee' },
  { label: '服务费', key: 'serviceFee' },
  { label: '合同编号', key: 'contractNo' },
  { label: '交易市场', key: 'market' },
];

/** 汇总表列（按股票 / 按月分组头） */
export interface TradeGroupSummary {
  /** 分组名（股票名称 / YYYY-MM） */
  name: string;
  /** 成交笔数 */
  count: number;
  /** 买入数量（正数合计） */
  buyQuantity: number;
  /** 卖出数量（绝对值合计） */
  sellQuantity: number;
  /** 买入金额 */
  buyAmount: number;
  /** 卖出金额 */
  sellAmount: number;
  /** 费用合计（佣金+印花税+过户费+委托费+服务费） */
  fee: number;
  /** 净发生金额（卖出入金 − 买入出金，含费用） */
  netAmount: number;
}

/** 汇总表列定义 */
export const TRADE_SUMMARY_COLUMNS: { label: string; key: keyof TradeGroupSummary }[] = [
  { label: '名称', key: 'name' },
  { label: '笔数', key: 'count' },
  { label: '买入数量', key: 'buyQuantity' },
  { label: '卖出数量', key: 'sellQuantity' },
  { label: '买入金额', key: 'buyAmount' },
  { label: '卖出金额', key: 'sellAmount' },
  { label: '费用合计', key: 'fee' },
  { label: '净发生金额', key: 'netAmount' },
];

/**
 * 按记录数组计算分组汇总
 * @param records 组内流水
 * @param name 分组展示名
 * @returns 汇总行
 */
export const summarizeRecords = (
  records: AccountTradeRecord[],
  name: string,
): TradeGroupSummary => {
  const buy = records.filter((r) => r.quantity > 0);
  const sell = records.filter((r) => r.quantity < 0);
  const sum = (rows: AccountTradeRecord[], key: 'quantity' | 'amount' | 'netAmount'): number =>
    rows.reduce((total, r) => total + Math.abs(r[key] as number), 0);
  return {
    name,
    count: records.length,
    buyQuantity: sum(buy, 'quantity'),
    sellQuantity: sum(sell, 'quantity'),
    buyAmount: sum(buy, 'amount'),
    sellAmount: sum(sell, 'amount'),
    fee: records.reduce(
      (total, r) => total + r.stampTax + r.commission + r.transferFee + r.entrustFee + r.serviceFee,
      0,
    ),
    netAmount: records.reduce((total, r) => total + r.netAmount, 0),
  };
};

/**
 * 行数据按列定义转为 sheet 行（label 为键，缺失字段补空串）
 * @param rows 行对象数组
 * @param columns 列定义
 * @returns sheet 行数组
 */
const toSheetRows = (
  rows: Record<string, unknown>[],
  columns: ExportColumn[],
): Record<string, unknown>[] =>
  rows.map((row) =>
    Object.fromEntries(columns.map((col) => [col.label, row[col.key] ?? ''])),
  );

/**
 * 清理工作表名：非法字符替换为空格、截断到长度上限，清空后按序号兜底
 * @param raw 原始名
 * @param index 工作表序号（兜底名用）
 * @returns 合法工作表名
 */
const buildSheetName = (raw: string, index: number): string => {
  const cleaned = raw.replace(SHEET_NAME_ILLEGAL_PATTERN, ' ').trim();
  return cleaned.length > 0
    ? cleaned.slice(0, SHEET_NAME_MAX_CHARS)
    : `${DEFAULT_SHEET_NAME}${index + 1}`;
};

/**
 * 工作表名去重（重名追加 -2 / -3 序号，追加后再次截断防超长）
 * @param base 候选名
 * @param used 已用名集合
 * @returns 未被占用的唯一名
 */
const uniqueSheetName = (base: string, used: Set<string>): string => {
  if (!used.has(base)) {
    return base;
  }
  let seq = 2;
  let candidate: string;
  do {
    const suffix = `-${seq}`;
    candidate = base.slice(0, SHEET_NAME_MAX_CHARS - suffix.length) + suffix;
    seq += 1;
  } while (used.has(candidate));
  return candidate;
};

/**
 * 导出行为 Excel 文件（.xlsx）
 * @param rows 行对象数组（key 需与 columns 匹配）
 * @param columns 列定义
 * @param fileName 导出文件名（不含扩展名）
 */
export const exportRowsToExcel = async (
  rows: Record<string, unknown>[],
  columns: { label: string; key: string }[],
  fileName: string,
): Promise<void> => {
  await exportSheetsToExcel([{ name: DEFAULT_SHEET_NAME, rows, columns }], fileName);
};

/**
 * 导出多个数据集为多工作表 Excel 文件（.xlsx）
 * @param sheets 工作表定义列表（name 为工作表名，rows / columns 同单表导出）
 * @param fileName 导出文件名（不含扩展名）
 */
export const exportSheetsToExcel = async (
  sheets: ExcelSheet[],
  fileName: string,
): Promise<void> => {
  const XLSX = await import('xlsx');
  const book = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  for (const [index, sheet] of sheets.entries()) {
    const name = uniqueSheetName(buildSheetName(sheet.name, index), usedNames);
    usedNames.add(name);
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(toSheetRows(sheet.rows, sheet.columns)), name);
  }
  XLSX.writeFile(book, `${fileName}.xlsx`);
};

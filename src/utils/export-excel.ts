import type { AccountTradeRecord } from '../types/account.types';

/**
 * 表格 → Excel 导出（SheetJS xlsx，动态 import 按需加载）
 *
 * 统一导出 .xlsx；列定义即导出列（跳过前端不展示的内部字段）
 */

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
  const XLSX = await import('xlsx');
  const data = rows.map((row) =>
    Object.fromEntries(columns.map((col) => [col.label, row[col.key] ?? ''])),
  );
  const sheet = XLSX.utils.json_to_sheet(data);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, '数据');
  XLSX.writeFile(book, `${fileName}.xlsx`);
};

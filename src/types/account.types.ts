/**
 * 股票账户类型
 */

/** 股票账户（UI 阶段：仅账户档案；持仓/成交待交割单字段定稿后入库 SQLite） */
export interface StockAccount {
  /** 账户唯一 id（uuid） */
  id: string;
  /** 账户名称（展示用，创建时去重） */
  name: string;
  /** 备注（可选） */
  note?: string;
  /** 创建时间戳（毫秒） */
  createdAt: number;
}

/** 对账单导入档案（一期落导入档案 + 原文，结构化解析待字段定稿） */
export interface AccountStatement {
  /** 唯一 id（uuid） */
  id: string;
  /** 所属账户 id */
  accountId: string;
  /** 导入文件名 */
  fileName: string;
  /** 对账期间起（YYYY-MM-DD，解析待实现时可空） */
  periodStart?: string | null;
  /** 对账期间止（YYYY-MM-DD） */
  periodEnd?: string | null;
  /** 文件原始文本（先存原文，供后续解析） */
  rawContent?: string | null;
  /** 导入时间戳（毫秒） */
  importedAt: number;
}

/** 导入类型：trade 交割单 / statement 对账单 */
export type ImportKind = 'trade' | 'statement';

/** 交割单 / 对账单导入确认载荷 */
export interface TradeImportPayload {
  /** 目标账户 id */
  accountId: string;
  /** 导入类型 */
  kind: ImportKind;
  /** 导入文件（原始 File，供父层解析 GBK TSV） */
  file: File;
  /** 导入文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
}

/**
 * 成交流水记录（交割单 / 对账单两表同构，字段对齐同花顺导出表头）
 *
 * 数量保留文件原符号：买入为正、卖出为负；发生金额正 = 入金、负 = 出金
 */
export interface AccountTradeRecord {
  /** 唯一 id（uuid，导入时生成） */
  id: string;
  /** 所属账户 id */
  accountId: string;
  /** 成交日期（YYYY-MM-DD） */
  tradeDate: string;
  /** 成交时间（HH:MM:SS） */
  tradeTime: string;
  /** 6 位证券代码 */
  symbol: string;
  /** 证券名称 */
  stockName: string;
  /** 操作原文（证券买入 / 证券卖出 等） */
  action: string;
  /** 成交数量（买入正 / 卖出负） */
  quantity: number;
  /** 成交均价 */
  price: number;
  /** 成交金额 */
  amount: number;
  /** 余额（交割单列；对账单无此列为 null） */
  balance: number | null;
  /** 发生金额（正入负出） */
  netAmount: number;
  /** 后资金额 */
  afterAmount: number | null;
  /** 印花税 */
  stampTax: number;
  /** 佣金 */
  commission: number;
  /** 过户费 */
  transferFee: number;
  /** 委托费 */
  entrustFee: number;
  /** 服务佣金及其他 */
  serviceFee: number;
  /** 合同编号 */
  contractNo: string;
  /** 成交编号 */
  dealNo: string;
  /** 交易市场（上海Ａ股 / 深圳Ａ股 等） */
  market: string;
  /** 导入时间戳（毫秒） */
  importedAt: number;
}

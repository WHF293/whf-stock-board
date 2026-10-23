/**
 * 股票账户类型
 */

/** 股票账户（档案由前端维护；成交数据由投资账本 MCP 同步与历史导入存量提供） */
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

/** 数据来源表：trade 交割单 / statement 对账单（历史导入存量，两表同构） */
export type ImportKind = 'trade' | 'statement';

/**
 * 成交流水记录（交割单 / 对账单两表同构，字段对齐同花顺导出表头；
 * 手工文件导入已下线，现存数据为历史导入存量，后续由投资账本 MCP 同步接管）
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

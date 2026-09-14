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

/** 交割单导入确认载荷（解析入库字段待定，先透传账户与文件信息） */
export interface TradeImportPayload {
  /** 目标账户 id */
  accountId: string;
  /** 导入文件名 */
  fileName: string;
  /** 文件大小（字节） */
  fileSize: number;
}

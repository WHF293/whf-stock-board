/**
 * 自选股条目
 */
export interface WatchlistStock {
  /** 归一化符号（sh600519 形态，入库前由 normalizeSymbol 保证） */
  symbol: string;
  /** 股票名称 */
  name: string;
  /** 加入时间戳（毫秒） */
  addedAt: number;
}

/**
 * 自选股分组
 */
export interface WatchlistGroup {
  /** 分组唯一 id */
  id: string;
  /** 分组名称 */
  name: string;
  /** 分组内的自选股，数组顺序即展示顺序 */
  stocks: WatchlistStock[];
}

/**
 * 批量添加：一条从用户输入解析出来的代码候选
 */
export interface BatchSymbolCandidate {
  /** 用户输入的原文（浮窗提示里回显，别用归一化后的形态） */
  input: string;
  /** 归一化后的完整符号（sh600519 形态） */
  symbol: string;
}

/**
 * 批量添加：经上游确认存在、可以入库的标的
 */
export interface BatchAddStock extends BatchSymbolCandidate {
  /** 上游返回的真实名称（弹窗只给出代码，名称只能从行情接口取） */
  name: string;
}

/**
 * 批量添加：解析 + 匹配的完整结果
 */
export interface BatchAddResolveResult {
  /** 可入库的标的（保序） */
  items: BatchAddStock[];
  /** 查不到对应股票的原始输入（保序，含格式非法被拦下的） */
  missing: string[];
}

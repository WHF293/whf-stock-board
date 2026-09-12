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

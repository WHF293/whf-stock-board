/**
 * 市场宽度 · ARMS 类型（快照统计 + 本地积累序列）
 *
 * 数据管道：全市场快照（FullQuote[]）→ MarketBreadth（当日统计）
 * → BreadthPoint（分钟点，同分钟去重）→ BreadthDayBar（收盘后聚合的日 bar）。
 * 历史无免费上游源，日线由本地按日积累（15:00 后快照定稿聚合），无法回填。
 */

/** 当日市场宽度统计（ARMS 为成交量口径，与通达信主流一致） */
export interface MarketBreadth {
  /** 上涨家数 */
  upCount: number;
  /** 下跌家数 */
  downCount: number;
  /** 平盘家数 */
  flatCount: number;
  /** 上涨股成交量合计（手） */
  upVol: number;
  /** 下跌股成交量合计（手） */
  downVol: number;
  /** 涨跌比 A/D = 上涨家数 ÷ 下跌家数（下跌为 0 时 null） */
  ad: number | null;
  /**
   * 阿姆氏指标 ARMS = (上涨家数 ÷ 下跌家数) ÷ (上涨成交量 ÷ 下跌成交量)
   * （分母为 0 或家数为 0 时 null，展示「--」）
   */
  arms: number | null;
}

/** 市场宽度分钟点（分时曲线的数据点；time 已取整到分钟） */
export interface BreadthPoint {
  /** 分钟时间戳（毫秒，已向下取整到分钟） */
  time: number;
  /** 上涨家数 */
  upCount: number;
  /** 下跌家数 */
  downCount: number;
  /** 平盘家数 */
  flatCount: number;
  /** 上涨股成交量合计（手） */
  upVol: number;
  /** 下跌股成交量合计（手） */
  downVol: number;
  /** ARMS 值（无法计算时 null） */
  arms: number | null;
}

/** 市场宽度日 bar（每交易日 15:00 后由当日最后一个分钟点聚合落库） */
export interface BreadthDayBar {
  /** 交易日（本地日键 YYYY-MM-DD） */
  date: string;
  /** 收盘上涨家数 */
  upCount: number;
  /** 收盘下跌家数 */
  downCount: number;
  /** 收盘上涨股成交量合计（手） */
  upVol: number;
  /** 收盘下跌股成交量合计（手） */
  downVol: number;
  /** 收盘 ARMS 值（无法计算时 null） */
  arms: number | null;
}

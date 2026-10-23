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
  /** 活跃股家数（日换手率 > 阈值，阈值见 constants 的 BREADTH_ACTIVE_TURNOVER_THRESHOLD） */
  activeCount: number;
  /** 换手率有效（正常交易）家数（活跃占比的分母） */
  activeTotal: number;
  /** 活跃占比（%，活跃家数 ÷ 有效家数 ×100；无有效样本为 null） */
  activeRatio: number | null;
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
  /** 活跃股家数（换手率 > 阈值；2026-10-23 前落库的旧点无此字段） */
  activeCount?: number;
  /** 换手率有效（正常交易）家数（2026-10-23 前落库的旧点无此字段） */
  activeTotal?: number;
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
  /** 收盘活跃股家数（换手率 > 阈值；2026-10-23 前落库的旧 bar 无此字段） */
  activeCount?: number;
  /** 收盘换手率有效（正常交易）家数（2026-10-23 前落库的旧 bar 无此字段） */
  activeTotal?: number;
}

/** 五大市场广度指标序列（ADL / ADR / OBOS / ARMS平滑 / MCO，逐日对齐） */
export interface BreadthIndicatorSeries {
  /** 交易日键序列（YYYY-MM-DD 升序，其余数组按此下标对齐） */
  dates: string[];
  /** ADL 腾落线（Σ(上涨-下跌家数)，自本地首条 bar 累加，仅相对意义） */
  adl: Array<number | null>;
  /** ADL 的 MA 均线 */
  adlMa: Array<number | null>;
  /** ADR 涨跌比率（N 日上涨家数总和 ÷ N 日下跌家数总和；下跌总和为 0 时 null） */
  adr: Array<number | null>;
  /** OBOS 超买超卖（N 日上涨家数总和 − N 日下跌家数总和） */
  obos: Array<number | null>;
  /** OBOS 的 MA 均线 */
  obosMa: Array<number | null>;
  /** ARMS 平滑均线（日 bar ARMS 的 MA；窗口内无有效 ARMS 时 null） */
  armsMa: Array<number | null>;
  /** MCO 麦克莱伦震荡指标（EMA(DIF,19) − EMA(DIF,39)，DIF = 上涨 − 下跌家数） */
  mco: Array<number | null>;
  /** MCO 信号线（MCO 的 MA） */
  mcoSignal: Array<number | null>;
  /** 活跃占比（%，换手率 > 阈值家数 ÷ 换手率有效家数 ×100；旧 bar 无字段为 null） */
  activeRatio: Array<number | null>;
}

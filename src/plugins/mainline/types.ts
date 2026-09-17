/**
 * 插件 dsh-mainline（股票主线）· 插件内类型
 *
 * 判定层（`judge.ts`）是纯函数层：输入 `BoardSeries` + 沪深成交额序列，
 * 输出 `MainlineVerdict` —— 便于冒烟断言与将来回测（历史 bundle 直接喂进去重算标签）。
 */
import type { MainlineConfidence, MainlinePhase } from './constants';

/** 板块清单里的一项（同花顺行业板块） */
export interface ThsBoardRef {
  /** 板块代码（同花顺 88xxxx，如 881121 = 半导体） */
  code: string;
  /** 板块名称 */
  name: string;
}

/** 板块单日行情（由同花顺板块日 K 解析而来） */
export interface BoardDaily {
  /** 交易日 YYYY-MM-DD */
  date: string;
  /** 收盘点位 */
  close: number;
  /** 当日涨跌幅（%），由相邻收盘价比值算出 */
  changePercent: number;
  /** 当日成交额（元） */
  amount: number;
}

/** 板块日线序列（按日期升序） */
export interface BoardSeries extends ThsBoardRef {
  /** 逐日行情（升序，尾部为最新） */
  days: BoardDaily[];
}

/** 沪深两市单日总成交额（来源：宿主 fetchMarketTurnover，单位元） */
export interface MarketTurnoverPoint {
  /** 交易日 YYYY-MM-DD */
  date: string;
  /** 两市合计成交额（元） */
  totalAmount: number;
}

/** 板块指标面板（原始指标，供界面直接展示，不做二次加工） */
export interface BoardMetrics {
  /** 数据截止日（序列最后一天） */
  asOf: string;
  /** 历史样本交易日数 */
  historyDays: number;
  /** 当日涨跌幅（%） */
  latestChange: number;
  /** 近 5 日累计涨跌幅（%） */
  change5: number;
  /** 近 20 日累计涨跌幅（%） */
  change20: number;
  /** 当日成交额（元）；无数据为 null */
  amount: number | null;
  /** 当日成交额 ÷ 沪深两市总成交额（%）；缺全市场数据为 null */
  turnoverShare: number | null;
  /** 成交占比在其自身历史上的分位（0-100）；样本不足为 null */
  sharePercentile: number | null;
  /** 量能倍数 = 近 5 日均额 ÷ 近 20 日均额；样本不足为 null */
  amountRatio: number | null;
  /** 收盘价在近 60 日区间中的分位（0-100）；样本不足为 null */
  pricePercentile: number | null;
}

/** 单板块判定结论（阶段标签 + 风险提示 + 指标面板） */
export interface MainlineVerdict {
  /** 板块代码 */
  code: string;
  /** 板块名称 */
  name: string;
  /** 阶段 */
  phase: MainlinePhase;
  /** 阶段中文标签 */
  phaseLabel: string;
  /** 阶段说明 */
  phaseDesc: string;
  /** 是否命中「主线候选」（成交占比分位或量能倍数超阈值） */
  candidate: boolean;
  /** 置信度（由样本天数决定） */
  confidence: MainlineConfidence;
  /** 风险提示（状态语言，不含买卖指令） */
  warnings: readonly string[];
  /** 原始指标面板 */
  metrics: BoardMetrics;
}

/** 一次扫描的元信息（落库，供下次启动直接展示与增量更新） */
export interface MainlineScanMeta {
  /** 本次扫描完成时间（毫秒时间戳） */
  scannedAt: number;
  /** 数据截止交易日（各板块最新交易日的众数） */
  asOf: string;
  /** 成功板块数与总板块数 */
  boardCount: number;
  /** 沪深两市当日总成交额（元）；缺失为 null */
  marketAmount: number | null;
}

/** 本地快照（启动时读库得到，无需联网） */
export interface MainlineSnapshot {
  /** 各板块日线序列 */
  boards: BoardSeries[];
  /** 沪深成交额序列 */
  market: MarketTurnoverPoint[];
  /** 扫描元信息；从未扫描过为 null */
  meta: MainlineScanMeta | null;
}

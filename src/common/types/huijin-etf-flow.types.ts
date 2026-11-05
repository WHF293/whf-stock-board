/**
 * 「每日汇金持仓变化（估算）」模块类型：份额快照、占比基准、估算行与日序列
 */

/** 单只 ETF 某一日收盘（或盘中最新）份额快照 */
export interface HuijinSharePoint {
  /** 总份额（份；东财 f38 / SSE TOT_VOL×1e4 统一为此口径） */
  shares: number;
  /** 单位净值近似价（元/份；东财 f20 总市值 ÷ f38 份额反推，SSE 快照无价格时为 null） */
  price: number | null;
  /** 快照抓取时间戳（毫秒） */
  fetchedAt: number;
}

/** 单日份额快照（key = YYYY-MM-DD） */
export interface HuijinShareSnapshot {
  /** 快照日期（YYYY-MM-DD，交易日口径） */
  date: string;
  /** 各 ETF 份额（6 位纯代码索引，缺失项即该日无数据） */
  points: Record<string, HuijinSharePoint>;
}

/** 份额历史存储整包（独立 localStorage key，结构版本不兼容时弃置重建） */
export interface HuijinShareStore {
  /** 结构版本 */
  version: 1;
  /** 逐日快照（日期升序，尾部截断至 HUIJIN_HISTORY_MAX_DAYS） */
  days: HuijinShareSnapshot[];
}

/** 季报「持有人结构」披露记录（cyrjg 解析结果，最近报告期） */
export interface FundHolderStructureRecord {
  /** 报告期（季报截止日 YYYY-MM-DD） */
  reportDate: string;
  /** 机构持有比例（%） */
  institutionalRatioPct: number | null;
  /** 个人持有比例（%） */
  personalRatioPct: number | null;
  /** 内部持有比例（%） */
  internalRatioPct: number | null;
  /** 期末总份额（亿份） */
  totalSharesYi: number | null;
}

/** 占比基准来源 */
export const HUIJIN_BASELINE_SOURCE = {
  /** 常量覆盖表手填（定期报告前十大持有人口径的汇金精确占比） */
  OVERRIDE: 'override',
  /** 季报「机构持有比例」披露值（宽基机构盘以汇金系为主，近似口径） */
  INSTITUTIONAL: 'institutional',
} as const;

/** 占比基准来源类型 */
export type HuijinBaselineSource =
  (typeof HUIJIN_BASELINE_SOURCE)[keyof typeof HUIJIN_BASELINE_SOURCE];

/** 单只 ETF 的占比基准（估算模型的输入之一） */
export interface HuijinEtfBaseline {
  /** 6 位纯代码 */
  code: string;
  /** 占比（%，0-100） */
  ratioPct: number;
  /** 基准报告期（季报截止日 YYYY-MM-DD；覆盖表无披露日时为空串） */
  reportDate: string;
  /** 季报期末总份额（亿份，披露口径，供交叉校验展示；覆盖表来源时为 null） */
  reportTotalSharesYi: number | null;
  /** 基准来源 */
  source: HuijinBaselineSource;
  /** 抓取时间戳（毫秒） */
  fetchedAt: number;
}

/** 估算明细行（表格展示态；est* 为 null 表示未参与估算） */
export interface HuijinFlowEstimateRow {
  /** 6 位纯代码 */
  code: string;
  /** 展示名称 */
  name: string;
  /** 当日总份额变化（亿份；前值缺失为 null） */
  sharesDeltaYi: number | null;
  /** 估算汇金份额变化（亿份 = 总份额变化 × 占比） */
  estSharesDeltaYi: number | null;
  /** 估算资金变动（亿元 = 估算份额变化 × 当日单价） */
  estAmountYi: number | null;
  /** 占比基准（%） */
  ratioPct: number | null;
  /** 基准来源 */
  ratioSource: HuijinBaselineSource | null;
  /** 基准报告期 */
  reportDate: string | null;
  /** 未参与估算原因（null = 已参与） */
  skipReason: string | null;
}

/** 当日汇总（合计只含参与估算的行） */
export interface HuijinFlowSummary {
  /** 估算资金变动合计（亿元，正 = 流入） */
  estAmountYi: number;
  /** 估算份额变化合计（亿份） */
  estSharesDeltaYi: number;
  /** 参与估算的 ETF 数 */
  estimatedCount: number;
  /** 明细总行数 */
  totalCount: number;
}

/** 历史曲线日序列点（该日全部参与估算 ETF 的合计） */
export interface HuijinFlowDayPoint {
  /** 日期（YYYY-MM-DD） */
  date: string;
  /** 估算资金变动合计（亿元） */
  estAmountYi: number;
}

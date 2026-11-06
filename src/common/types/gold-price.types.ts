/** 金价模块类型（2026-11-07 新增，数据源金投网行情中心） */

/** 金店品牌行情 code 映射条目（gold-price.constants 的 GOLD_BRAND_CODES） */
export interface GoldBrandCodeDef {
  /** 品牌 key（卡片切换下拉的 value） */
  key: string;
  /** 品牌展示名 */
  label: string;
  /** 足金饰品价行情 code（金投网，黄金价格口径） */
  ornament: string;
  /** 投资金条价行情 code（品牌未在金投开设金条行情时缺省） */
  bar?: string;
}

/** 金店品牌单类报价（缺行 = null，展示 `--`） */
export interface GoldBrandQuote {
  /** 品牌 key（gold-price.constants 的 GOLD_BRAND_CODES key） */
  key: string;
  /** 品牌展示名 */
  label: string;
  /** 足金饰品价（元/克；上游缺行为 null） */
  ornamentPrice: number | null;
  /** 投资金条价（元/克；品牌无金条行情或缺行为 null） */
  barPrice: number | null;
  /** 较上次调价的涨跌幅（%；金店日更价上游多数为 0） */
  changePercent: number | null;
}

/** 当日金价摘要行（伦敦金 + 折合 + 国内基准） */
export interface GoldSpotSummary {
  /** 伦敦金现（美元/盎司） */
  xauUsd: number | null;
  /** 伦敦金涨跌幅（%） */
  xauChangePercent: number | null;
  /** 折合人民币（元/克；汇率源缺席为 null） */
  xauCnyPerGram: number | null;
  /** 国内基准金价（中国黄金基础金价，元/克） */
  basisPrice: number | null;
  /** 上游报价时间戳（毫秒，取金店 code 的最新 time） */
  quotedAt: number | null;
}

/** 总览「当日金价」卡的一次完整快照（data-cache 落 key） */
export interface GoldDashboardData {
  /** 品牌报价列表（顺序 = GOLD_BRAND_CODES 声明序） */
  brands: GoldBrandQuote[];
  /** 摘要行 */
  spot: GoldSpotSummary;
}

/** 品牌足金价单日历史点（品牌走势图用） */
export interface GoldHistoryPoint {
  /** 当日价（元/克） */
  price: number;
  /** 较前一交易日涨跌额（元/克） */
  change: number;
  /** 当日零点时间戳（毫秒） */
  time: number;
}

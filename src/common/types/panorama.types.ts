/**
 * 行情全景页数据类型
 */

/**
 * 全景条目（板块 / 指数 / 商品通用，仅名称 + 涨跌幅）
 */
export interface PanoramaItem {
  /** 名称（板块名 / 指数名 / 品种名） */
  name: string;
  /** 涨跌幅（百分数数值；无数据为 null） */
  changePercent: number | null;
}

/**
 * 全球宏观分组（分组标题 + 该组条目）
 */
export interface PanoramaMacroGroup {
  /** 分组标题（如「贵金属」） */
  label: string;
  /** 组内条目（按配置关键词顺序） */
  items: PanoramaItem[];
}

/**
 * 全球指数轻量报价（市场总览指数卡展开区用，名称 + 现价 + 涨跌幅）
 */
export interface GlobalIndexQuote {
  /** 指数名称（上游 f14，如「恒生指数」） */
  name: string;
  /** 指数代码（上游 f12，如 `HSI`） */
  code: string;
  /** 最新价（无数据为 null） */
  price: number | null;
  /** 涨跌幅%（无数据为 null） */
  changePercent: number | null;
}

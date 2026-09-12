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

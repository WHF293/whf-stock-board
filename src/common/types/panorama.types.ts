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
 * 全景 ulist 配置条目（secid + 展示名，2026-11-03 起缺行兜底用：
 * 上游未返回时名称仍显示、涨跌幅渲染为 `--`，展示名以配置为准不再取上游 f14）
 */
export interface PanoramaSecidEntry {
  /** 东财 secid（市场码.代码，如 `105.NVDA` / `176.8035`） */
  secid: string;
  /** 展示名（命中与缺行统一使用，保证显示稳定） */
  name: string;
}

/**
 * 国外科技巨头分组配置（按市场分组：美国 / 日本 / 韩国）
 */
export interface PanoramaTechGroupConfig {
  /** 分组标题（市场名） */
  label: string;
  /** 组内标的（展示顺序 = 配置顺序） */
  entries: readonly PanoramaSecidEntry[];
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

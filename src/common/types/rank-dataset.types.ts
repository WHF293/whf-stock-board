/**
 * 盘面雷达页「AI 分析」使用的榜单数据集类型
 */

/** 榜单数据段：一个可交给 AI 分析的表格数据集 */
export interface RankDataset {
  /** 数据段标题（AI 分析为小节标题，如「涨停池」「盘口异动」） */
  title: string;
  /** 列定义（label 为表头文案，key 为行字段名） */
  columns: { label: string; key: string }[];
  /** 行数据（key 与 columns 对应；值可为字符串 / 数值 / null） */
  rows: Record<string, unknown>[];
}

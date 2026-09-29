/**
 * 「今天炒什么」热股榜单的类型定义
 *
 * 五个平台（同花顺 / 东财 / 财联社 / 通达信 / 雪球）的榜单条目字段各异
 * （热度口径、标签体系、排名变化含义都不同），本文件定义归一化后的统一形态，
 * 卡片列表 / 放大弹窗 / AI 分析提示词只消费这里的类型
 */

/** 归一化后的热股榜单条目 */
export interface HotBoardItem {
  /** 完整符号（sh600519 形态，点击打开个股详情停靠面板） */
  symbol: string;
  /** 6 位纯代码（列表次行展示） */
  code: string;
  /** 股票名称 */
  name: string;
  /** 现价（源未提供为 null，如东财榜单行情补齐失败） */
  price: number | null;
  /** 涨跌幅 %（源未提供为 null） */
  changePct: number | null;
  /** 热度数值（源未提供为 null；展示时优先 heatLabel） */
  heat: number | null;
  /** 热度展示文案（如「64.2万热度」「538.50万人气」；空串 = 该源无热度口径） */
  heatLabel: string;
  /** 榜单名次（1 起，按上游返回顺序） */
  rank: number;
  /** 排名变化（正 = 上升 / 负 = 下降；null = 持平或该榜无此口径） */
  rankChange: number | null;
  /** 标签（概念板块 / 连板天数等，按上游原序） */
  tags: string[];
}

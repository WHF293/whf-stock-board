/**
 * 板块相关类型统一出口：re-export stock-sdk
 *
 * 概念板块与行业板块同构（SDK 内 ConceptBoard = IndustryBoard），
 * 成分股代码为 6 位纯代码形态，跳详情时需归一化带市场前缀
 */
export type {
  IndustryBoard,
  ConceptBoard,
  IndustryBoardConstituent,
  ConceptBoardConstituent,
} from 'stock-sdk';

/**
 * 板块热力图数据项（图表组件消费的视图模型）
 */
export interface HeatmapBoard {
  /** 板块代码（BK1027 形态，下钻拉成分股用） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 涨跌幅（百分数数值） */
  changePercent: number;
  /** 面积权重（总市值或成交额） */
  weight: number;
}

/**
 * K 线画线工具类型
 */

/** 画线形状名（klinecharts 10 内置 overlay 注册名的子集，见 kline-drawing.constants.ts） */
export type KlineDrawingShape =
  | 'segment'
  | 'rayLine'
  | 'horizontalStraightLine'
  | 'rect'
  | 'parallelStraightLine'
  | 'fibonacciLine';

/** 一条画线的可序列化快照（存时间戳锚点，不存 K 线索引——增量补尾后索引会错位） */
export interface KlineDrawingRecord {
  /** klinecharts overlay id（恢复时按 id 幂等，避免重复恢复） */
  id: string;
  /** 形状名（内置 overlay 注册名） */
  name: KlineDrawingShape;
  /** 锚点序列（时间戳毫秒 + 价格；Partial<Point> 的可持久化子集） */
  points: { timestamp: number; value: number }[];
}

/** 一票一周期的画线集合（DB 行形态，data_json 的反序列化结果） */
export interface KlineDrawingBundle {
  /** 完整符号（`sh600519` 形态） */
  symbol: string;
  /** K 线周期（同 SinaKlinePeriod 口径） */
  period: string;
  /** 全部形状快照 */
  shapes: KlineDrawingRecord[];
}

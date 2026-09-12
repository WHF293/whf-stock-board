import type { HEATMAP_VIEW_MODE } from '../constants/heatmap.constants';
import type { HeatmapBoard, IndustryBoardConstituent } from './board.types';

/**
 * 板块热力展示形式（由 HEATMAP_VIEW_MODE const 对象派生）
 */
export type HeatmapViewMode = (typeof HEATMAP_VIEW_MODE)[keyof typeof HEATMAP_VIEW_MODE];

/**
 * 板块下钻视图状态（热力图 / 列表两种展示形式共享同一份状态）
 */
export interface HeatmapDrillView {
  /** 下钻目标板块（状态条仅需标识信息） */
  board: Pick<HeatmapBoard, 'code' | 'name'>;
  /** 成分股（已过滤无效值、按成交额降序、截取 Top N；保留完整字段供列表消费） */
  constituents: IndustryBoardConstituent[];
}

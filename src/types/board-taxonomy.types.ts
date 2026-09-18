import type { IndustryBoard } from './board.types';
import type { BoardCategoryKey } from '../constants/board-taxonomy.constants';

/**
 * 板块风格大类相关类型（A股全景 · 行业板块归类）
 */

/**
 * 板块按风格大类分区后的展示分组（平铺模式消费）
 */
export interface BoardCategoryGroup {
  /** 风格大类 key；null = 上游新增但映射表尚未收录的板块 */
  key: BoardCategoryKey | null;
  /** 分区标题；未收录分区为「未归类」 */
  label: string;
  /** 该分区内的板块行（保持传入顺序） */
  rows: IndustryBoard[];
}

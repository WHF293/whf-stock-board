/**
 * 全局命令面板（Ctrl+K）常量
 *
 * 面板是打断性 UI：分组上限与最近使用条数都收敛，避免列表过长失去「快」的意义
 */

import { PALETTE_ITEM_KIND, type PaletteItem } from '../types/command-palette.types';

/** 结果分组渲染顺序（个股最高频动作，恒置顶） */
export const PALETTE_GROUP_ORDER = [
  PALETTE_ITEM_KIND.STOCK,
  PALETTE_ITEM_KIND.PAGE,
  PALETTE_ITEM_KIND.COMMAND,
] as const;

/** 分组标题文案 */
export const PALETTE_GROUP_LABELS: Record<PaletteItem['kind'], string> = {
  [PALETTE_ITEM_KIND.STOCK]: '个股',
  [PALETTE_ITEM_KIND.PAGE]: '页面',
  [PALETTE_ITEM_KIND.COMMAND]: '命令',
};

/** 最近使用最多保留条数（空输入态展示，超出挤掉最旧） */
export const PALETTE_RECENT_MAX = 8;

/** 前端过滤组（页面 / 命令）的单组上限——超过说明关键词太宽，靠得分截断 */
export const PALETTE_FILTERED_GROUP_MAX = 8;

/** 远程个股搜索单次取前 N 条（与旧搜索弹窗行为一致，腾讯源无分页） */
export const PALETTE_STOCK_RESULTS_MAX = 8;

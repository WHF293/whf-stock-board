/**
 * K 线画线工具常量
 *
 * 形状清单 = klinecharts 10 内置 overlay 注册名（实测核对 index.esm.js 注册表）；
 * 分时 / 五日（timeline 模式）不支持画线，工具条由调用方置灰
 */

import type { KlineDrawingShape } from '../types/kline-drawing.types.ts';

/** 画线形状选项（工具条渲染顺序 = 数组顺序） */
export const KLINE_DRAWING_SHAPES: readonly { name: KlineDrawingShape; label: string }[] = [
  { name: 'segment', label: '线段' },
  { name: 'rayLine', label: '射线' },
  { name: 'horizontalStraightLine', label: '水平线' },
  { name: 'rect', label: '矩形' },
  { name: 'parallelStraightLine', label: '平行通道' },
  { name: 'fibonacciLine', label: '斐波那契' },
] as const;

/** 画线防抖落库时长（毫秒）：绘制过程频繁变更，不能每次 createOverlay 都写 */
export const KLINE_DRAWING_SAVE_DEBOUNCE_MS = 800;

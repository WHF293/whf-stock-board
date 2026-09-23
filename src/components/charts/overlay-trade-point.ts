import { registerOverlay } from 'klinecharts';
import { readTrendColors } from '../../utils/trend-colors';
import type { TradeMarkType } from '../../utils/trade-marks';

/**
 * klinecharts 自定义覆盖物：成交 BS/T 标注点
 *
 * 形状 = 三段组合：锚点小圆点 + 竖向连接线 + 远端圆角矩形徽标（内嵌白色字母）。
 * 一个覆盖物实例 = 一个标注点（totalStep: 2 单点形态），由 KlineChart
 * 在数据 / 标注变化时批量 createOverlay / removeOverlay；
 * 颜色实时读涨跌主题色（B=涨色 / S=跌色 / T=橙，切主题即时跟随），
 * 徽标延伸方向由 extendData.side 决定（KlineChart 按分钟级「成交价 vs 昨收」、
 * 蜡烛「成交价 vs 开盘价」算好传入）。
 */

/** 覆盖物名（removeOverlay 过滤用） */
export const TRADE_POINT_OVERLAY = 'tradePoint';

/** 覆盖物扩展数据 */
export interface TradePointExtend {
  /** 标注类型 */
  type: TradeMarkType;
  /** 徽标延伸方向：above = 从锚点向上延伸 / below = 向下延伸 */
  side: 'above' | 'below';
}

/** T 点固定橙色（买涨卖跌之外的第三语义） */
const T_COLOR = '#f97316';

/** 锚点小圆点半径（px；4 的 2/3 ≈ 2.7，2026-09-23 按视觉反馈缩小） */
const DOT_RADIUS = 2.7;

/** 连接线长度（px） */
const STEM_LENGTH = 18;

/** 连接线宽度（px） */
const STEM_SIZE = 1.5;

/** 徽标矩形边长（px） */
const BADGE_SIZE = 16;

/** 徽标圆角（px） */
const BADGE_RADIUS = 5;

/** 徽标字母字号（px） */
const BADGE_FONT_SIZE = 10;

registerOverlay<TradePointExtend>({
  name: TRADE_POINT_OVERLAY,
  // 单点形态：第 2 步即完成（程序化创建时直接给齐 points 即渲染）
  totalStep: 2,
  needDefaultXAxisFigure: false,
  needDefaultYAxisFigure: false,
  createPointFigures: ({ overlay, coordinates }) => {
    const coordinate = coordinates[0];
    if (!coordinate) return [];
    const extend =
      (overlay.extendData as TradePointExtend | undefined) ?? { type: 'B', side: 'below' };
    const trend = readTrendColors();
    const color =
      extend.type === 'B' ? trend.up : extend.type === 'S' ? trend.down : T_COLOR;
    const dir = extend.side === 'above' ? -1 : 1;
    const stemStartY = coordinate.y + dir * DOT_RADIUS;
    const stemEndY = coordinate.y + dir * (DOT_RADIUS + STEM_LENGTH);
    const badgeCenterY = stemEndY + dir * (BADGE_SIZE / 2);
    return [
      {
        type: 'circle',
        attrs: { x: coordinate.x, y: coordinate.y, r: DOT_RADIUS },
        // borderColor 覆盖默认蓝边（klinecharts 覆盖物默认样式是蓝系）
        styles: { style: 'fill', color, borderColor: color },
      },
      {
        type: 'line',
        attrs: {
          coordinates: [
            { x: coordinate.x, y: stemStartY },
            { x: coordinate.x, y: stemEndY },
          ],
        },
        styles: { style: 'stroke', color, size: STEM_SIZE },
      },
      {
        type: 'rect',
        attrs: {
          x: coordinate.x - BADGE_SIZE / 2,
          y: badgeCenterY - BADGE_SIZE / 2,
          width: BADGE_SIZE,
          height: BADGE_SIZE,
        },
        styles: { style: 'fill', color, borderRadius: BADGE_RADIUS },
      },
      {
        type: 'text',
        attrs: {
          x: coordinate.x,
          y: badgeCenterY,
          text: extend.type,
          align: 'center',
          baseline: 'middle',
        },
        // ⚠️ backgroundColor 必须显式置透明：klinecharts 默认给文字画蓝色背景块，
        // 会盖住上面自绘的徽标矩形（drawText 内部先 drawRect 再 fillText）
        styles: {
          color: '#ffffff',
          size: BADGE_FONT_SIZE,
          weight: 'bold',
          backgroundColor: 'transparent',
        },
      },
    ];
  },
});

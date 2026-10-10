/**
 * 全局水印常量
 */

/** 水印文案 */
export const WATERMARK_TEXT = '数据仅供个人学习参考';

/** 水印默认开关 */
export const WATERMARK_ENABLED_DEFAULT = true;

/** 水印文字颜色（固定灰，亮暗底均可辨识且不喧宾夺主） */
export const WATERMARK_FILL = 'rgba(128, 138, 150, 0.16)';

/** 水印平铺单元尺寸（像素） */
export const WATERMARK_TILE = {
  WIDTH: 260,
  HEIGHT: 150,
} as const;

/** 水印文字倾斜角度（度） */
export const WATERMARK_ROTATE_DEG = -18;

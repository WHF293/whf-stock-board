/**
 * 数值格式化共享常量
 */
export const NUMBER_PLACEHOLDER = '--';

/** 价格默认小数位数 */
export const PRICE_DEFAULT_DIGITS = 2;

/** 计量单位文案 */
export const AMOUNT_UNITS = {
  WAN: '万',
  YI: '亿',
  WANYI: '万亿',
} as const;

/** 进率：万 -> 亿 */
export const WAN_PER_YI = 10_000;

/** 进率：万 -> 万亿 */
export const WAN_PER_WANYI = 100_000_000;

/** 进率：元 -> 亿 */
export const YUAN_PER_YI = 100_000_000;

import { AMOUNT_UNITS, NUMBER_PLACEHOLDER, WAN_PER_WANYI, WAN_PER_YI } from '../constants/format.constants';

/**
 * 格式化成交额（入参单位为万，按量级自动切万亿 / 亿 / 万展示）
 * @param valueWan 成交额原值（单位：万）
 * @returns 形如 `1.23万亿` / `456.78亿` / `9.01万` 的文案；无法格式化时为 `--`
 */
export const formatAmount = (valueWan: number | null | undefined): string => {
  if (valueWan === null || valueWan === undefined || Number.isNaN(valueWan)) {
    return NUMBER_PLACEHOLDER;
  }
  const abs = Math.abs(valueWan);
  if (abs >= WAN_PER_WANYI) {
    return `${(valueWan / WAN_PER_WANYI).toFixed(2)}${AMOUNT_UNITS.WANYI}`;
  }
  if (abs >= WAN_PER_YI) {
    return `${(valueWan / WAN_PER_YI).toFixed(2)}${AMOUNT_UNITS.YI}`;
  }
  return `${valueWan.toFixed(2)}${AMOUNT_UNITS.WAN}`;
};

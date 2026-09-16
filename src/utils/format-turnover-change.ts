import { YUAN_PER_YI } from '../constants/format.constants';

/** 量能放大时的方向词 */
const VOLUME_UP_LABEL = '放量';

/** 量能收缩时的方向词 */
const VOLUME_DOWN_LABEL = '缩量';

/** 量能持平（变化额为 0）时的方向词 */
const VOLUME_FLAT_LABEL = '持平';

/**
 * 拼接「较上日」展示文案：量能方向 + 变化额（亿元）+ 变化率
 * @param changeAmount 两市总成交额较上一交易日变化额（元）；无前值（首日）为 null
 * @param changePct 两市总成交额较上一交易日变化率（%）；无前值（首日）为 null
 * @returns 形如 `放量 1234.56亿（14.10%）` / `缩量 567.89亿（-1.10%）` / `持平 0.00亿（0.00%）`；无前值时为 null
 */
export const formatTurnoverChange = (
  changeAmount: number | null,
  changePct: number | null,
): string | null => {
  if (changeAmount === null || changePct === null) {
    return null;
  }
  const amountYi = (Math.abs(changeAmount) / YUAN_PER_YI).toFixed(2);
  const direction =
    changeAmount > 0
      ? VOLUME_UP_LABEL
      : changeAmount < 0
        ? VOLUME_DOWN_LABEL
        : VOLUME_FLAT_LABEL;
  return `${direction} ${amountYi}亿（${changePct.toFixed(2)}%）`;
};

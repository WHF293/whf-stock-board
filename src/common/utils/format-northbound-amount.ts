import {
  NORTHBOUND_MILLION_TO_YUAN,
  NORTHBOUND_WAN_TO_YUAN,
  NORTHBOUND_YI_YUAN,
} from '../constants/northbound.constants.ts';

/** 上游金额单位口径 */
export type NorthboundAmountSource = 'yuan' | 'wan' | 'million';

/**
 * 沪深港通金额格式化：按上游单位换算为元后分「亿 / 万」两档展示
 *
 * @param root0 入参对象
 * @param root0.value 上游数值（null / NaN 展示「--」）
 * @param root0.source 上游单位：yuan 元；wan 万元（summary、minute）；
 *   million 百万元（资金历史表）
 * @returns 形如「-15.21 亿」「3,062.4 万」「--」的展示串
 */
export const formatNorthboundAmount = ({
  value,
  source,
}: {
  value: number | null;
  source: NorthboundAmountSource;
}): string => {
  if (value === null || Number.isNaN(value)) {
    return '--';
  }
  const unit =
    source === 'wan' ? NORTHBOUND_WAN_TO_YUAN : source === 'million' ? NORTHBOUND_MILLION_TO_YUAN : 1;
  const yuan = value * unit;
  if (Math.abs(yuan) >= NORTHBOUND_YI_YUAN) {
    return `${(yuan / NORTHBOUND_YI_YUAN).toFixed(2)} 亿`;
  }
  const wan = yuan / NORTHBOUND_WAN_TO_YUAN;
  return `${wan.toLocaleString('zh-CN', { maximumFractionDigits: 1 })} 万`;
};

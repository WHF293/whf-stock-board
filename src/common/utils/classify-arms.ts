/**
 * 依据 ARMS 值判定五档状态（强势/偏强/平衡/偏弱/弱势）
 *
 * 阈值口径见 market-breadth.constants.ts；强势/偏强为红档（上涨方量能占优）、
 * 偏弱/弱势为绿档（下跌方量能占优），与 A 股涨跌配色对齐
 */
import {
  ARMS_FAVORABLE_MAX,
  ARMS_NEUTRAL_MAX,
  ARMS_STATE,
  ARMS_STATE_LABEL,
  ARMS_STRONG_MAX,
  ARMS_WEAK_MIN,
  type ArmsStateKey,
} from '../constants/market-breadth.constants.ts';

/** ARMS 状态判定结果 */
export interface ArmsStateResult {
  /** 状态 key（ARMS_STATE 之一） */
  key: ArmsStateKey;
  /** 中文状态文案 */
  label: string;
  /** 语义色调：up 红（强）/ down 绿（弱）/ flat 灰（平衡），供 UI 类名映射 */
  tone: 'up' | 'down' | 'flat';
}

/**
 * 判定 ARMS 五档状态
 * @param arms ARMS 值（null 时返回 null，由调用方展示「--」）
 * @returns 状态判定结果；无法判定为 null
 */
export const classifyArms = (arms: number | null): ArmsStateResult | null => {
  if (arms === null || !Number.isFinite(arms)) return null;
  let key: ArmsStateKey;
  if (arms < ARMS_STRONG_MAX) key = ARMS_STATE.STRONG;
  else if (arms < ARMS_FAVORABLE_MAX) key = ARMS_STATE.FAVORABLE;
  else if (arms < ARMS_NEUTRAL_MAX) key = ARMS_STATE.NEUTRAL;
  else if (arms < ARMS_WEAK_MIN) key = ARMS_STATE.UNFAVORABLE;
  else key = ARMS_STATE.WEAK;
  const tone = key === ARMS_STATE.NEUTRAL ? 'flat' : arms < ARMS_NEUTRAL_MAX ? 'up' : 'down';
  return { key, label: ARMS_STATE_LABEL[key], tone };
};

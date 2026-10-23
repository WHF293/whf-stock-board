import {
  ARMS_NEUTRAL_LINE,
  BREADTH_ACTIVE_COLD,
  BREADTH_ACTIVE_OVERHEAT,
  BREADTH_ADR_OVERBOUGHT,
  BREADTH_ADR_OVERSOLD,
  BREADTH_MCO_OVERBOUGHT,
  BREADTH_MCO_OVERSOLD,
} from '../constants/market-breadth.constants.ts';
import type { BreadthIndicatorKind } from '../constants/market-breadth.constants.ts';

/**
 * 五大广度指标当前值 → 一句白话解读（这个值说明今天市场是好是坏）
 *
 * 2026-10-22 王总指定：非专业用户看不出数值好坏。原实现内嵌在
 * BreadthIndicatorChart（tooltip hover 用），抽出公共化后「当日总结」弹窗
 * （MarketBreadthView）按指标罗列最新解读时复用同一份口径。
 */

/** 解读行语义色档位（跟随涨跌配色主题消费） */
export type BreadthInterpretTone = 'up' | 'down' | 'flat';

/** 解读结果：一句白话 + 语义色档位 */
export interface BreadthInterpretation {
  text: string;
  tone: BreadthInterpretTone;
}

/**
 * 指标当前值 → 白话解读
 * @param kind 指标种类（adl / adr / obos / arms / mco / active）
 * @param value 主指标当前值
 * @param ma 同一天的均线值（仅 ADL 用：与均线比强弱）
 * @returns 解读文案 + 语义色；值为空返回 null
 */
export const interpretBreadthValue = (
  kind: BreadthIndicatorKind,
  value: number | null,
  ma?: number | null,
): BreadthInterpretation | null => {
  if (value === null || Number.isNaN(value)) {
    return null;
  }
  switch (kind) {
    case 'adl':
      if (ma != null && !Number.isNaN(ma)) {
        return value >= ma
          ? { text: '高于均线：上涨家数累积占优，市场偏强', tone: 'up' }
          : { text: '低于均线：下跌家数累积占优，市场偏弱', tone: 'down' };
      }
      return { text: '相对值：持续走高 = 上涨家数累积占优，市场偏强', tone: 'flat' };
    case 'adr':
      if (value >= BREADTH_ADR_OVERBOUGHT) {
        return { text: `≥${BREADTH_ADR_OVERBOUGHT} 超买：短期涨势过热，提防回调`, tone: 'down' };
      }
      if (value <= BREADTH_ADR_OVERSOLD) {
        return { text: `≤${BREADTH_ADR_OVERSOLD} 超卖：短期跌势过度，可能孕育反弹`, tone: 'up' };
      }
      if (value > 1) return { text: '大于 1：上涨家数占优，市场偏强', tone: 'up' };
      if (value < 1) return { text: '小于 1：下跌家数占优，市场偏弱', tone: 'down' };
      return { text: '多空均衡', tone: 'flat' };
    case 'obos':
      if (value > 0) return { text: '正值：近 10 日上涨家数多于下跌，多头偏强', tone: 'up' };
      if (value < 0) return { text: '负值：近 10 日下跌家数多于上涨，空头偏强', tone: 'down' };
      return { text: '多空均衡', tone: 'flat' };
    case 'arms':
      if (value < 0.8) return { text: '低于 0.8：多头强势（上涨放量）', tone: 'up' };
      if (value > 1.2) return { text: '高于 1.2：空头占优（下跌放量）', tone: 'down' };
      if (value < ARMS_NEUTRAL_LINE) return { text: '略低于 1：偏多头', tone: 'up' };
      if (value > ARMS_NEUTRAL_LINE) return { text: '略高于 1：偏空头', tone: 'down' };
      return { text: '多空均衡', tone: 'flat' };
    case 'mco':
      if (value >= BREADTH_MCO_OVERBOUGHT) {
        return { text: '进入超买区：短线情绪过热，提防回落', tone: 'down' };
      }
      if (value <= BREADTH_MCO_OVERSOLD) {
        return { text: '进入超卖区：短线情绪冰点，可能修复', tone: 'up' };
      }
      if (value > 0) return { text: '零轴上方：市场偏强', tone: 'up' };
      if (value < 0) return { text: '零轴下方：市场偏弱', tone: 'down' };
      return { text: '中性', tone: 'flat' };
    case 'active':
      if (value >= BREADTH_ACTIVE_OVERHEAT) {
        return { text: `≥${BREADTH_ACTIVE_OVERHEAT}%：交投过热，短线情绪亢奋，提防退潮`, tone: 'down' };
      }
      if (value <= BREADTH_ACTIVE_COLD) {
        return { text: `≤${BREADTH_ACTIVE_COLD}%：交投冰点，观望情绪浓，题材难接力`, tone: 'up' };
      }
      return { text: '交投平稳：活跃度处于常规区间', tone: 'flat' };
  }
};

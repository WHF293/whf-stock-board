import type { SignalType } from 'stock-sdk';

/**
 * 技术信号常量：SignalType -> 中文标签 + 涨跌方向（代替魔法串散落）
 */
export const SIGNAL_META: Record<SignalType, { label: string; direction: 'up' | 'down' }> = {
  ma_golden_cross: { label: 'MA金叉', direction: 'up' },
  ma_death_cross: { label: 'MA死叉', direction: 'down' },
  macd_golden_cross: { label: 'MACD金叉', direction: 'up' },
  macd_death_cross: { label: 'MACD死叉', direction: 'down' },
  kdj_golden_cross: { label: 'KDJ金叉', direction: 'up' },
  kdj_death_cross: { label: 'KDJ死叉', direction: 'down' },
  kdj_overbought: { label: 'KDJ超买', direction: 'down' },
  kdj_oversold: { label: 'KDJ超卖', direction: 'up' },
  rsi_overbought: { label: 'RSI超买', direction: 'down' },
  rsi_oversold: { label: 'RSI超卖', direction: 'up' },
  boll_break_upper: { label: '突破上轨', direction: 'up' },
  boll_break_lower: { label: '跌破下轨', direction: 'down' },
  sar_reversal_up: { label: 'SAR转多', direction: 'up' },
  sar_reversal_down: { label: 'SAR转空', direction: 'down' },
};

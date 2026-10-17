import type { CompareSeriesInput, CompareStatsItem } from '../types/compare.types';

/**
 * 对比统计：区间涨跌幅 / 最大回撤 / 年化波动率
 *
 * 口径（与归一化一致，均为「相对自身区间起点」）：
 * - 区间涨跌幅 = 末收盘 / 首收盘 - 1；
 * - 最大回撤 = max(1 - 收盘 / 前期峰值)，恒为非正值；
 * - 年化波动率 = 日收益率（对数收益）标准差 × √250；有效样本 < 2 时为 null。
 * @param input 单票日 K 收盘序列（时间升序，已按区间截尾）
 * @returns 统计项（序列不足 2 个有效值时返回占位项：涨跌幅 / 回撤为 0、波动率 null）
 */
export const calcCompareStats = (input: CompareSeriesInput): CompareStatsItem => {
  const closes = input.closes.map((point) => point.close).filter((close) => close > 0);
  const placeholder: CompareStatsItem = {
    symbol: input.symbol,
    name: input.name,
    changePct: 0,
    maxDrawdownPct: 0,
    annualVolPct: null,
  };
  if (closes.length < 2) return placeholder;

  const changePct = (closes[closes.length - 1]! / closes[0]! - 1) * 100;

  let peak = closes[0]!;
  let maxDrawdownPct = 0;
  for (const close of closes) {
    if (close > peak) peak = close;
    const drawdownPct = (1 - close / peak) * 100;
    if (drawdownPct < maxDrawdownPct) maxDrawdownPct = drawdownPct;
  }

  const returns: number[] = [];
  for (let index = 1; index < closes.length; index += 1) {
    returns.push(Math.log(closes[index]! / closes[index - 1]!));
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance =
    returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (returns.length - 1);
  const annualVolPct = Math.sqrt(variance) * Math.sqrt(250) * 100;

  return { symbol: input.symbol, name: input.name, changePct, maxDrawdownPct, annualVolPct };
};

/**
 * 批量统计（保持输入顺序，供统计表直接渲染）
 * @param inputs 各票日 K 序列
 * @returns 每票统计项（输入顺序）
 */
export const calcCompareStatsList = (inputs: CompareSeriesInput[]): CompareStatsItem[] =>
  inputs.map((input) => calcCompareStats(input));

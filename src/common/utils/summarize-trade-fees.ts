import type { TzzbStockTrade } from '../types/tzzb.types.ts';

/**
 * 交易摩擦账本汇总（纯函数，不碰网络）
 *
 * 口径见 .ai/开发方案/2026-11-02-前端-账户操作复盘与行为分析开发方案.md §4.1：
 * - 印花税上游无独立字段，按 feeTotal − commission − transferFee 差值推断（UI 须标注「推断」）；
 * - 换手率 = Σ成交额 ÷ 区间平均总资产；
 * - 费用拖累比 = 总费用 ÷ max(|区间已实现盈亏|, 总费用)，分母下限防除零。
 */

/** 摩擦账本汇总结果 */
export interface TradeFeeSummary {
  /** 费用总额（Σ feeTotal） */
  total: number;
  /** 佣金（Σ commission） */
  commission: number;
  /** 过户费（Σ transferFee） */
  transferFee: number;
  /** 推断印花税（Σ(feeTotal − commission − transferFee)，可能含其他杂费） */
  stampDuty: number;
  /** 流水笔数 */
  tradeCount: number;
  /** 成交额合计（Σ amount，买卖双向） */
  turnoverAmount: number;
  /** 月度费用趋势（按成交日期月份聚合，升序） */
  monthly: TradeFeeMonthPoint[];
  /** 换手率（倍数口径，如 4.12 = 412%）；缺区间平均总资产时为 null */
  turnoverRate: number | null;
  /** 费用拖累比（0~1+）；缺区间已实现盈亏时为 null */
  dragRatio: number | null;
}

/** 月度费用点 */
export interface TradeFeeMonthPoint {
  /** 月份 yyyy-MM */
  month: string;
  /** 当月费用合计 */
  total: number;
}

/** 摩擦账本计算上下文（换手率 / 拖累比的分母来源，缺省则对应指标为 null） */
export interface TradeFeeContext {
  /** 区间平均总资产（netValueTrend.totalAsset 均值） */
  avgTotalAsset?: number | null;
  /** 区间已实现盈亏（已清仓回合 profit 合计） */
  realizedProfit?: number | null;
}

/**
 * 汇总交易流水的费用结构
 * @param trades 股票逐笔流水（全量，非单页）
 * @param context 换手率 / 拖累比分母上下文
 * @returns 摩擦账本汇总；空流水返回 total 为 0 的空汇总（monthly 为空数组）
 */
export const summarizeTradeFees = (
  trades: TzzbStockTrade[],
  context: TradeFeeContext = {},
): TradeFeeSummary => {
  let total = 0;
  let commission = 0;
  let transferFee = 0;
  let turnoverAmount = 0;
  const monthMap = new Map<string, number>();

  for (const trade of trades) {
    total += trade.feeTotal;
    commission += trade.commission;
    transferFee += trade.transferFee;
    turnoverAmount += trade.amount;
    if (trade.date.length >= 7) {
      const month = trade.date.slice(0, 7);
      monthMap.set(month, (monthMap.get(month) ?? 0) + trade.feeTotal);
    }
  }

  const monthly = [...monthMap.entries()]
    .map(([month, monthTotal]) => ({ month, total: monthTotal }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const avgTotalAsset = context.avgTotalAsset ?? null;
  const realizedProfit = context.realizedProfit ?? null;
  const turnoverRate =
    avgTotalAsset !== null && avgTotalAsset > 0 ? turnoverAmount / avgTotalAsset : null;
  const dragRatio =
    realizedProfit !== null
      ? total / Math.max(Math.abs(realizedProfit), total)
      : null;

  return {
    total,
    commission,
    transferFee,
    stampDuty: total - commission - transferFee,
    tradeCount: trades.length,
    turnoverAmount,
    monthly,
    turnoverRate,
    dragRatio,
  };
};

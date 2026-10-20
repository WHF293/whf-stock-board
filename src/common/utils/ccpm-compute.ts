import { CCPM_HEDGE_RATIO_THRESHOLD } from '../constants/futures.constants.ts';
import type {
  CcpmAggregateRow,
  CcpmBehaviorTag,
  CcpmInstrumentTotals,
  CcpmMemberRow,
  CcpmMemberStats,
  CcpmProductDayData,
} from '../types/futures.types.ts';

/**
 * 单合约指标计算：净持仓 / 净增减 / 多空占比 / 行为标签
 *
 * 空值口径：任一侧未上榜时净持仓仍可算（一侧按 0），但占比为 null；
 * 标签仅在有完整多空两侧数据时判定（字段说明文档约定：NULL 席位不参与标签，
 * 数据缺失会导致误判）。
 *
 * @param rows 三榜并集归并后的原始行（同一合约）
 * @param totals 该合约整体合计（占比分母 = 上榜样本，非全市场）
 * @returns 计算指标后的行（与入参同序）
 */
export const computeCcpmMemberStats = (
  rows: readonly CcpmMemberRow[],
  totals: CcpmInstrumentTotals,
): CcpmMemberStats[] =>
  rows.map((row) => {
    const hasBuy = row.buyPos !== null;
    const hasSell = row.sellPos !== null;
    const netPos = hasBuy || hasSell ? (row.buyPos ?? 0) - (row.sellPos ?? 0) : null;
    const netChg =
      row.buyChg !== null || row.sellChg !== null ? (row.buyChg ?? 0) - (row.sellChg ?? 0) : null;
    const buyRatio = hasBuy && totals.buy > 0 ? ((row.buyPos ?? 0) / totals.buy) * 100 : null;
    const sellRatio = hasSell && totals.sell > 0 ? ((row.sellPos ?? 0) / totals.sell) * 100 : null;
    const result = hasBuy && hasSell
      ? detectBehaviorTag({
          buyPos: row.buyPos ?? 0,
          sellPos: row.sellPos ?? 0,
          buyChg: row.buyChg ?? 0,
          sellChg: row.sellChg ?? 0,
        })
      : null;
    return {
      ...row,
      netPos,
      netChg,
      buyRatio,
      sellRatio,
      tag: result?.tag ?? null,
      tagReason: result?.reason ?? '多空任一侧未上榜，不参与标签判定',
    };
  });

/**
 * 行为标签判定（单合约与聚合口径共用同一规则）
 *
 * 规则（字段说明文档约定）：
 * - 净头寸占比低（|多−空| / max(多,空) < 阈值）且多空双向同步增仓（chg 同号且非零）→ 对冲
 * - 净头寸占比高 → 偏多 / 偏空（按多空孰大）
 * - 全平仓 / 无方向 → null
 *
 * @param input 多空持仓与增减（聚合口径传合并后的总量）
 * @param input.buyPos 多头持仓
 * @param input.sellPos 空头持仓
 * @param input.buyChg 多头增减
 * @param input.sellChg 空头增减
 * @returns 标签与判定依据（依据供 tooltip 展示）；无法判定时标签为 null、依据说明原因
 */
const detectBehaviorTag = (input: {
  buyPos: number;
  sellPos: number;
  buyChg: number;
  sellChg: number;
}): { tag: CcpmBehaviorTag | null; reason: string } => {
  const { buyPos, sellPos, buyChg, sellChg } = input;
  const maxSide = Math.max(buyPos, sellPos);
  if (maxSide <= 0) {
    return { tag: null, reason: '多空两侧均无持仓，无法判定' };
  }
  const ratio = Math.abs(buyPos - sellPos) / maxSide;
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const threshold = `${(CCPM_HEDGE_RATIO_THRESHOLD * 100).toFixed(0)}%`;
  // 对冲特征：净头寸占比低 + 多空双向同步增仓（chg 同号且非零）
  if (ratio < CCPM_HEDGE_RATIO_THRESHOLD) {
    if (buyChg !== 0 && sellChg !== 0 && Math.sign(buyChg) === Math.sign(sellChg)) {
      const action = buyChg > 0 ? '增' : '减';
      const signed = (v: number): string => `${v > 0 ? '+' : ''}${v.toLocaleString('en-US')}`;
      return {
        tag: 'hedge',
        reason: `净头寸占比 ${pct}（< 阈值 ${threshold}），且多空双向同步${action}仓（多 ${signed(buyChg)} / 空 ${signed(sellChg)}）→ 对冲`,
      };
    }
    return {
      tag: null,
      reason: `净头寸占比 ${pct}（< 阈值 ${threshold}），但多空未同步增减仓，方向不明`,
    };
  }
  return buyPos > sellPos
    ? { tag: 'long', reason: `净头寸占比 ${pct}（≥ 阈值 ${threshold}），多单 > 空单 → 偏多` }
    : { tag: 'short', reason: `净头寸占比 ${pct}（≥ 阈值 ${threshold}），空单 > 多单 → 偏空` };
};

/**
 * 按会员聚合（跨合约 / 跨品种通用）：同一会员所有上榜行的字段累加
 *
 * 缺失侧按 0 计入总量（未上榜 ≠ 无持仓，只是无披露），完整性由
 * coveredCount / totalCount 表达——isPartial 时页面必须红字提示部分头寸。
 *
 * @param data 参与聚合的品种单日数据列表（同品种传单元素数组，跨品种传多品种）
 * @param memberName 目标会员（不传 = 全部会员）
 * @returns 聚合行列表（按 totalNet 降序），单会员时数组长度 1
 */
export const aggregateCcpmByMember = (
  data: readonly CcpmProductDayData[],
  memberName?: string,
): CcpmAggregateRow[] => {
  // 防御：剔除 undefined / 缺 instruments 的畸形项（上游漏填不应炸整页）
  const safeData = data.filter((day) => !!day && Array.isArray(day.instruments));
  if (safeData.length !== data.length) {
    console.warn('[futures] aggregateCcpmByMember 丢弃畸形入参', data.length - safeData.length, '项');
  }
  const totalCount = safeData.reduce((sum, day) => sum + day.instruments.length, 0);
  const byMember = new Map<
    string,
    {
      totalBuy: number;
      totalSell: number;
      totalBuyChg: number;
      totalSellChg: number;
      totalVolume: number;
      covered: Set<string>;
    }
  >();

  for (const day of safeData) {
    for (const row of day.rows) {
      if (memberName !== undefined && row.memberName !== memberName) {
        continue;
      }
      let entry = byMember.get(row.memberName);
      if (!entry) {
        entry = {
          totalBuy: 0,
          totalSell: 0,
          totalBuyChg: 0,
          totalSellChg: 0,
          totalVolume: 0,
          covered: new Set<string>(),
        };
        byMember.set(row.memberName, entry);
      }
      entry.totalBuy += row.buyPos ?? 0;
      entry.totalSell += row.sellPos ?? 0;
      entry.totalBuyChg += row.buyChg ?? 0;
      entry.totalSellChg += row.sellChg ?? 0;
      // 跨品种口径的成交量量纲不可比（不同指数流动性），仅同品种口径有单品种数据时累加
      if (data.length === 1) {
        entry.totalVolume += row.volume ?? 0;
      }
      entry.covered.add(`${day.product}|${row.instrumentId}`);
    }
  }

  return [...byMember.entries()]
    .map(([name, entry]) => {
      const result = detectBehaviorTag({
        buyPos: entry.totalBuy,
        sellPos: entry.totalSell,
        buyChg: entry.totalBuyChg,
        sellChg: entry.totalSellChg,
      });
      return {
        memberName: name,
        totalBuy: entry.totalBuy,
        totalSell: entry.totalSell,
        totalNet: entry.totalBuy - entry.totalSell,
        totalBuyChg: entry.totalBuyChg,
        totalSellChg: entry.totalSellChg,
        totalNetChg: entry.totalBuyChg - entry.totalSellChg,
        totalVolume: entry.totalVolume,
        coveredCount: entry.covered.size,
        totalCount,
        isPartial: entry.covered.size < totalCount,
        // 聚合口径同样打行为标签（合并后的多空总量与增减走同一判定规则）
        tag: result.tag,
        tagReason: result.reason,
      };
    })
    .sort((a, b) => Math.abs(b.totalNet) - Math.abs(a.totalNet));
};

/**
 * 筛选某合约的行（保持 CSV 顺序，供排序前使用）
 * @param data 品种单日数据
 * @param instrumentId 合约代码；不传 = 全部合约
 * @returns 原始行子集
 */
export const filterCcpmRowsByInstrument = (
  data: CcpmProductDayData,
  instrumentId?: string,
): CcpmMemberRow[] =>
  instrumentId === undefined
    ? [...data.rows]
    : data.rows.filter((row) => row.instrumentId === instrumentId);

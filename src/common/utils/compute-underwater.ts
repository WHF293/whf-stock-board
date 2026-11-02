import dayjs from 'dayjs';
import type { TzzbAssetPoint, TzzbStockTrade } from '../types/tzzb.types.ts';

/**
 * 回撤水下序列与回撤段计算（纯函数，方案 §4.4）
 *
 * navIndex → running max → underwater = nav ÷ peak − 1（恒 ≤ 0）；
 * 回撤段 = 峰值日（水下开始）→ 谷底 → 修复日（净值回到前高），
 * 区间末日仍未回前高的段标记「未修复」。
 * dayjs 仅用于自然日差值，无时区副作用。
 */

/** 单段回撤 */
export interface UnderwaterSegment {
  /** 峰值日（回撤起点）yyyy-MM-dd */
  peakDate: string;
  /** 谷底日 yyyy-MM-dd */
  troughDate: string;
  /** 峰→谷最大回撤幅度（正数小数，0.0523 = 5.23%） */
  depth: number;
  /** 峰→谷下行自然日 */
  durationDays: number;
  /** 修复日（净值回到前高）；null = 截至区间末日仍未修复 */
  recoveredDate: string | null;
  /** 谷→修复自然日；未修复为 null */
  recoveryDays: number | null;
  /** 回撤期间操作（仅调用方提供流水时统计） */
  activity: UnderwaterTradeActivity | null;
}

/** 回撤期间的买卖活动（流水统计） */
export interface UnderwaterTradeActivity {
  /** 买入笔数 */
  buys: number;
  /** 卖出笔数 */
  sells: number;
  /** 买入金额合计（元） */
  buyAmount: number;
  /** 卖出金额合计（元） */
  sellAmount: number;
}

/** 水下计算结果 */
export interface UnderwaterResult {
  /** 逐点水下深度（nav ÷ peak − 1，≤0；与输入等长） */
  underwater: number[];
  /** 回撤段（按时间升序） */
  segments: UnderwaterSegment[];
  /** 最深段在 segments 中的下标；无回撤时为 -1 */
  maxSegmentIndex: number;
}

/**
 * yyyyMMdd → yyyy-MM-dd（资产曲线日期口径转流水/展示口径）
 * @param d yyyyMMdd 日期串
 * @returns yyyy-MM-dd 日期串
 */
const fmtDate = (d: string): string =>
  `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;

/**
 * 计算水下序列与回撤段
 * @param points 资产趋势点（按日期升序；TzzbPnlSummary.assetTrend）
 * @param trades 可选全量股票流水（统计各回撤段内的买卖活动）
 * @returns 水下序列（输入为空时返回空结果）
 */
export const computeUnderwater = (
  points: TzzbAssetPoint[],
  trades?: TzzbStockTrade[] | null,
): UnderwaterResult => {
  const n = points.length;
  if (n === 0) return { underwater: [], segments: [], maxSegmentIndex: -1 };

  const underwater: number[] = new Array<number>(n);
  let peakVal = points[0].navIndex;
  let peakIdx = 0;
  /** 当前未修复回撤段的谷底（无回撤时为 null） */
  let cur: { troughIdx: number; troughVal: number } | null = null;
  const segments: UnderwaterSegment[] = [];

  /**
   * 收段：recoveredIdx 为 null 表示区间末仍未修复
   * @param recoveredIdx 修复日在序列中的下标（未修复传 null）
   */
  const closeSegment = (recoveredIdx: number | null): void => {
    if (!cur) return;
    const peakDate = fmtDate(points[peakIdx].date);
    const troughDate = fmtDate(points[cur.troughIdx].date);
    const endIdx = recoveredIdx ?? n - 1;
    segments.push({
      peakDate,
      troughDate,
      depth: -Math.min(...underwater.slice(peakIdx, endIdx + 1)),
      durationDays: dayjs(troughDate).diff(dayjs(peakDate), 'day'),
      recoveredDate: recoveredIdx === null ? null : fmtDate(points[recoveredIdx].date),
      recoveryDays:
        recoveredIdx === null
          ? null
          : dayjs(fmtDate(points[recoveredIdx].date)).diff(dayjs(troughDate), 'day'),
      activity: summarizeActivity(
        trades,
        peakDate,
        recoveredIdx === null ? fmtDate(points[n - 1].date) : fmtDate(points[recoveredIdx].date),
      ),
    });
    cur = null;
  };

  for (let i = 0; i < n; i++) {
    const nav = points[i].navIndex;
    if (nav >= peakVal) {
      // 回到前高（含持平）：收段并刷新峰值
      closeSegment(i);
      peakVal = nav;
      peakIdx = i;
      underwater[i] = 0;
    } else {
      underwater[i] = nav / peakVal - 1;
      if (!cur) cur = { troughIdx: i, troughVal: nav };
      else if (nav < cur.troughVal) {
        cur = { troughIdx: i, troughVal: nav };
      }
    }
  }
  closeSegment(null); // 末尾仍在水下的段

  const maxSegmentIndex = segments.reduce(
    (best, s, i) => (s.depth > (segments[best]?.depth ?? 0) ? i : best),
    -1,
  );
  return { underwater, segments, maxSegmentIndex };
};

/**
 * 统计窗口内买卖活动（action 含「买」/「卖」判定方向，金额取绝对值）
 * @param trades 全量流水（null / undefined 跳过）
 * @param from 窗口起（含）
 * @param to 窗口止（含）
 * @returns 活动统计；无流水输入时返回 null
 */
const summarizeActivity = (
  trades: TzzbStockTrade[] | null | undefined,
  from: string,
  to: string,
): UnderwaterTradeActivity | null => {
  if (!trades || trades.length === 0) return null;
  const hit = trades.filter((t) => t.date >= from && t.date <= to);
  const buys = hit.filter((t) => t.action.includes('买'));
  const sells = hit.filter((t) => t.action.includes('卖'));
  return {
    buys: buys.length,
    sells: sells.length,
    buyAmount: buys.reduce((s, t) => s + Math.abs(t.amount), 0),
    sellAmount: sells.reduce((s, t) => s + Math.abs(t.amount), 0),
  };
};

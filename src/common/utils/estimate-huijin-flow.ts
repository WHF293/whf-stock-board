import {
  HUIJIN_YI_SHARES,
  HUIJIN_ESTIMATE_SKIP_NO_PREV,
  HUIJIN_ESTIMATE_SKIP_NO_BASELINE,
} from '../constants/huijin-etf-flow.constants.ts';
import type {
  HuijinEtfBaseline,
  HuijinFlowDayPoint,
  HuijinFlowEstimateRow,
  HuijinShareSnapshot,
} from '../types/huijin-etf-flow.types.ts';

/**
 * 汇金持仓变化估算纯函数（无副作用、无网络依赖，可被冒烟直跑）
 *
 * 模型：估算汇金份额变化 = 当日 ETF 总份额变化 × 最近季报机构持有比例
 * （宽基 ETF 机构盘以汇金系为绝对主导的近似口径）；估算资金变动 = 份额变化 × 当日单价。
 * 前值缺失 / 基准缺失 / 单价缺失均整行不估算（est* 为 null），绝不凑数。
 */

/** 估算入参（一行估算所需的最小输入） */
export interface EstimateRowInput {
  /** ETF 名称 */
  name: string;
  /** 前一交易日快照点（缺失 = 首日，无法计算变化） */
  prevPoint: { shares: number; price: number | null } | null;
  /** 当日快照点 */
  todayPoint: { shares: number; price: number | null };
  /** 占比基准（缺失 = 未披露 / 取数失败） */
  baseline: Pick<HuijinEtfBaseline, 'ratioPct' | 'reportDate' | 'source'> | null;
}

/**
 * 数值取整到指定位数（消除浮点尾差，-0 归 0）
 * @param value 原值
 * @param digits 小数位
 * @returns 取整后数值
 */
const roundTo = (value: number, digits: number): number =>
  Math.abs(Number(value.toFixed(digits))) === 0
    ? 0
    : Number(value.toFixed(digits));

/**
 * 估算单只 ETF 的当日汇金变化行
 * @param code 6 位纯代码
 * @param input 估算入参
 * @returns 明细行（est* 为 null 表示未参与估算，skipReason 说明原因）
 */
export const estimateHuijinFlowRow = (
  code: string,
  input: EstimateRowInput,
): HuijinFlowEstimateRow => {
  const base: HuijinFlowEstimateRow = {
    code,
    name: input.name,
    sharesDeltaYi: null,
    estSharesDeltaYi: null,
    estAmountYi: null,
    ratioPct: input.baseline?.ratioPct ?? null,
    ratioSource: input.baseline?.source ?? null,
    reportDate: input.baseline?.reportDate ?? null,
    skipReason: null,
  };
  if (!input.prevPoint) {
    return { ...base, skipReason: HUIJIN_ESTIMATE_SKIP_NO_PREV };
  }
  const sharesDeltaYi = roundTo(
    (input.todayPoint.shares - input.prevPoint.shares) / HUIJIN_YI_SHARES,
    4,
  );
  if (!input.baseline) {
    return { ...base, sharesDeltaYi, skipReason: HUIJIN_ESTIMATE_SKIP_NO_BASELINE };
  }
  const estSharesDeltaYi = roundTo((sharesDeltaYi * input.baseline.ratioPct) / 100, 4);
  const price = input.todayPoint.price ?? input.prevPoint.price;
  // 估算资金变动（亿元）= 估算份额变化（亿份）× 单价（元/份），量纲天然成立
  const estAmountYi = price !== null ? roundTo(estSharesDeltaYi * price, 2) : null;
  return { ...base, sharesDeltaYi, estSharesDeltaYi, estAmountYi };
};

/**
 * 从份额历史估算某一日的全部明细行
 * @param snapshots 份额历史（日期升序）
 * @param date 目标日期（通常为最新一天）
 * @param names 代码 -> 名称映射
 * @param baselines 代码 -> 占比基准映射（取不到的代码按无基准处理）
 * @returns 明细行数组（快照中出现过该日或前一日快照的代码都出现）
 */
export const buildHuijinEstimateRows = (
  snapshots: readonly HuijinShareSnapshot[],
  date: string,
  names: ReadonlyMap<string, string>,
  baselines: Readonly<Record<string, HuijinEtfBaseline>>,
): HuijinFlowEstimateRow[] => {
  const index = snapshots.findIndex((day) => day.date === date);
  if (index < 0) {
    return [];
  }
  const today = snapshots[index]!;
  const prev = index > 0 ? snapshots[index - 1]! : null;
  const codes = new Set([...Object.keys(today.points), ...Object.keys(prev?.points ?? {})]);
  return [...codes].map((code) =>
    estimateHuijinFlowRow(code, {
      name: names.get(code) ?? code,
      prevPoint: prev?.points[code] ?? null,
      todayPoint: today.points[code]!,
      baseline: baselines[code] ?? null,
    }),
  );
};

/**
 * 汇总明细行（合计只含参与估算的行，est* 非 null）
 * @param rows 明细行数组
 * @returns 当日汇总
 */
export const buildHuijinFlowSummary = (
  rows: readonly HuijinFlowEstimateRow[],
): { estAmountYi: number; estSharesDeltaYi: number; estimatedCount: number; totalCount: number } => {
  const estimated = rows.filter((row) => row.estAmountYi !== null || row.estSharesDeltaYi !== null);
  return {
    estAmountYi: roundTo(
      estimated.reduce((sum, row) => sum + (row.estAmountYi ?? 0), 0),
      2,
    ),
    estSharesDeltaYi: roundTo(
      estimated.reduce((sum, row) => sum + (row.estSharesDeltaYi ?? 0), 0),
      2,
    ),
    estimatedCount: estimated.length,
    totalCount: rows.length,
  };
};

/**
 * 构建历史曲线日序列（每日全组合计；缺基准日按 0 计入会失真——
 * 改为跳过：只有当日全部「已估算」行才计入该日，保证曲线口径一致）
 * @param snapshots 份额历史（日期升序）
 * @param names 代码 -> 名称映射
 * @param baselines 代码 -> 占比基准映射
 * @returns 日序列点（亿元，正 = 流入）
 */
export const buildHuijinDailySeries = (
  snapshots: readonly HuijinShareSnapshot[],
  names: ReadonlyMap<string, string>,
  baselines: Readonly<Record<string, HuijinEtfBaseline>>,
): HuijinFlowDayPoint[] => {
  const points: HuijinFlowDayPoint[] = [];
  for (let index = 1; index < snapshots.length; index += 1) {
    const today = snapshots[index]!;
    const rows = buildHuijinEstimateRows(snapshots, today.date, names, baselines);
    const estimated = rows.filter((row) => row.estAmountYi !== null);
    // 该日无任何可估算行（基准全缺）时不落点，避免画 0 假曲线
    if (estimated.length === 0) {
      continue;
    }
    points.push({
      date: today.date,
      estAmountYi: roundTo(
        estimated.reduce((sum, row) => sum + (row.estAmountYi ?? 0), 0),
        2,
      ),
    });
  }
  return points;
};

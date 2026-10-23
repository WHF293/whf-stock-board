import {
  ROTATION_MIN_LIMIT_UP,
  ROTATION_MIN_SCORE_RATE_DEFAULT,
} from '../constants/board-rotation.constants.ts';
import {
  HOT_BOARD_SW_PARENT,
  SEESAW_BALANCE_THRESHOLD,
  STYLE_DEFENSIVE_BOARD_CODES,
  SW_LEVEL1_CODE_SET,
} from '../constants/style-seesaw.constants.ts';
import type { BoardDailyRow } from '../types/board-calendar.types.ts';
import type {
  SeesawBias,
  SeesawBoardRow,
  SeesawBucketDay,
  SeesawDayPoint,
  SeesawModel,
  SeesawOptions,
} from '../types/style-seesaw.types.ts';

/**
 * 风格跷跷板渲染模型构建（纯函数）
 *
 * 输入板块日历既有落库行（board_daily），输出两桶逐日聚合视图模型，
 * 单测可直接对输入输出写，不碰 Vue。
 *
 * 口径（2026-10-23 王总确认方向，详见 .ai/开发方案/2026-10-23-前端-风险偏好跷跷板页面开发方案.md）：
 * - 进攻端（高情绪抱团）：当日达标的板块（涨停 ≥ minLimitUp 且得分率 ≥ minScoreRate，
 *   与题材轮动上榜口径同源、阈值联动）经追加板块→申万一级归属映射归并后的行业集合；
 * - 防守端（高股息红利）：静态行业映射集合；
 * - 两桶冲突（同一申万一级当日既成主线又在防守集合）→ 抱团优先，防守端剔除；
 * - 聚合只走 31 个申万一级行业行（完整划分零重叠），桶级成交额 / 涨停家数求和无重复计算；
 * - 桶级涨跌幅 = 桶内行业涨跌幅等权平均（跳过 null；全缺记 null）；
 * - 累计涨跌幅基期归零：首个交易日为 0，其后逐日累加当日等权涨跌幅，缺数日不累加；
 * - 倾向判定：两端均值差 > +阈值 进攻占优 / < -阈值 防守占优 / 其余均衡（缺数 null）。
 */

/**
 * 桶内聚合：等权涨跌幅 / 成交额求和 / 涨停家数求和 / 行业明细
 * @param rows 桶内申万一级行业行（同一交易日）
 * @returns 聚合结果（空集合返回 boards 为空数组、均值为 null 的桶）
 */
const aggregateBucket = (rows: BoardDailyRow[]): SeesawBucketDay => {
  const changeValues = rows
    .map((row) => row.changePercent)
    .filter((value): value is number => value !== null);
  const amountValues = rows
    .map((row) => row.amount)
    .filter((value): value is number => value !== null);

  const boards: SeesawBoardRow[] = rows
    .map((row) => ({
      code: row.boardCode,
      name: row.boardName,
      changePercent: row.changePercent,
      amount: row.amount,
      limitUp: row.limitUp,
      scoreRate: row.scoreRate,
    }))
    .sort(
      (a, b) => (b.changePercent ?? -Infinity) - (a.changePercent ?? -Infinity) ||
        a.code.localeCompare(b.code),
    );

  return {
    changePercentAvg:
      changeValues.length > 0
        ? changeValues.reduce((sum, value) => sum + value, 0) / changeValues.length
        : null,
    amountSum:
      amountValues.length > 0
        ? amountValues.reduce((sum, value) => sum + value, 0)
        : null,
    limitUpSum: rows.reduce((sum, row) => sum + row.limitUp, 0),
    cumulativeChange: 0,
    boards,
  };
};

/**
 * buildStyleSeesaw 主入口
 * @param dailyRows 板块 × 交易日聚合行（board_daily，可含任意日期范围，函数内部按日期轴对齐）
 * @param options 可调口径（默认取常量）
 * @returns 渲染模型（days 升序）；无任何数据时 days 为空数组
 */
export const buildStyleSeesaw = (
  dailyRows: readonly BoardDailyRow[],
  options: SeesawOptions = {},
): SeesawModel => {
  const minLimitUp = options.minLimitUp ?? ROTATION_MIN_LIMIT_UP;
  const minScoreRate = options.minScoreRate ?? ROTATION_MIN_SCORE_RATE_DEFAULT;
  const balanceThreshold = options.balanceThreshold ?? SEESAW_BALANCE_THRESHOLD;
  const defensiveCodes = new Set(options.defensiveCodes ?? STYLE_DEFENSIVE_BOARD_CODES);

  /* ---------------- 日期索引（升序） ---------------- */

  const dailyByDate = new Map<string, BoardDailyRow[]>();
  for (const row of dailyRows) {
    const list = dailyByDate.get(row.tradeDate);
    if (list) {
      list.push(row);
    } else {
      dailyByDate.set(row.tradeDate, [row]);
    }
  }
  const dates = [...dailyByDate.keys()].sort();

  /* ---------------- 逐日两桶聚合 ---------------- */

  let cumAggressive = 0;
  let cumDefensive = 0;
  const days: SeesawDayPoint[] = dates.map((date) => {
    const dayRows = dailyByDate.get(date) ?? [];
    const rowByCode = new Map(dayRows.map((row) => [row.boardCode, row]));

    // 抱团候选：36 板块池中达标的板块 → 归并到申万一级行业
    const aggressiveCodes = new Set<string>();
    for (const row of dayRows) {
      if (row.limitUp < minLimitUp || row.scoreRate < minScoreRate) continue;
      const parent = HOT_BOARD_SW_PARENT[row.boardCode];
      const code = parent ?? (SW_LEVEL1_CODE_SET.has(row.boardCode) ? row.boardCode : null);
      if (code !== null) aggressiveCodes.add(code);
    }

    // 两桶冲突 → 抱团优先（防守端剔除当日主线行业）
    const defensiveCodesOfday = new Set(
      [...defensiveCodes].filter((code) => !aggressiveCodes.has(code)),
    );

    const aggressive = aggregateBucket(
      [...aggressiveCodes].map((code) => rowByCode.get(code)).filter((row) => row !== undefined),
    );
    const defensive = aggregateBucket(
      [...defensiveCodesOfday]
        .map((code) => rowByCode.get(code))
        .filter((row) => row !== undefined),
    );

    // 累计涨跌幅（基期归零；缺数日不累加，曲线持平）
    if (aggressive.changePercentAvg !== null) cumAggressive += aggressive.changePercentAvg;
    aggressive.cumulativeChange = cumAggressive;
    if (defensive.changePercentAvg !== null) cumDefensive += defensive.changePercentAvg;
    defensive.cumulativeChange = cumDefensive;

    // 倾向判定：两端均值差对比阈值
    let bias: SeesawBias | null = null;
    if (aggressive.changePercentAvg !== null && defensive.changePercentAvg !== null) {
      const diff = aggressive.changePercentAvg - defensive.changePercentAvg;
      bias = diff > balanceThreshold ? 'aggressive' : diff < -balanceThreshold ? 'defensive' : 'balanced';
    }

    return { tradeDate: date, aggressive, defensive, bias };
  });

  return { days };
};

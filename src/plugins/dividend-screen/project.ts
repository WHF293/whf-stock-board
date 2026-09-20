/**
 * 插件 dsh-dividend-screen（股息筛选）· 推算层（纯函数）
 *
 * 把「排行快照 + 三个报告期业绩 + 多期分红 + 负债率」合成一行可展示的推算结论。
 * 全部逻辑无副作用，冒烟测试用真实上游数值断言（荣晟环保 2026 中报实测案）。
 *
 * 推算模型（用户口径：**保留去年分红率**）：
 * - 去年分红率 = 去年分红总额 ÷ 去年全年归母净利（可为 >100% 的特别分红，照算并标记）；
 * - 增长系数 = 今年中报净利 ÷ 去年中报净利（去年基数缺失或 ≤0 → 不可比，不推算）；
 * - 预计今年净利 = 去年全年净利 × 增长系数（线性外推，季节性行业会失真，页面明示）；
 * - 推算每股分红 = 去年分红率 × 预计今年净利 ÷ 总股本；
 * - 推算股息率 = 推算每股分红 ÷ 现价。
 *
 * 规则引擎指标（同批合成）：
 * - 连续分红年数：从去年年报往前数连续有现金分红的年度数；
 * - 现金流覆盖倍数 = 每股经营现金流 ÷ 每股分红（每股比值等价于总额比值）；
 * - 负债率：取最新已披露报告期（扫描层已择新）。
 *
 * 状态判定按顺序短路：中报未披露 → 中报亏损 → 增长不可比 → 无可比分红率 → 可推算。
 */
import { DIVIDEND_PROJECT_STATUS } from './constants';
import type { ProjectStatus } from './constants';
import type {
  DebtSnapshot,
  DividendAggregate,
  DividendScreenRow,
  PerfRow,
  RankBaseRow,
} from './types';

/** buildScreenRow 的输入集合（可选部分缺席 = 该数据源未披露 / 未采集） */
export interface ScreenRowInputs {
  /** 排行快照行 */
  base: RankBaseRow;
  /** 今年中报业绩（undefined = 未披露） */
  h1?: PerfRow | undefined;
  /** 去年中报业绩（undefined = 未披露） */
  h1Last?: PerfRow | undefined;
  /** 去年年报业绩（分红率分母、全年净利基数与每股经营现金流来源） */
  fyLast?: PerfRow | undefined;
  /** 去年年度分红聚合（undefined = 去年无现金分红方案） */
  divLast?: DividendAggregate | undefined;
  /** 今年中期分红聚合（信息展示用） */
  divInterim?: DividendAggregate | undefined;
  /** 近 5 个年度 + 中期的分红聚合（键 = `YYYY-MM-DD`；undefined = 未采集分红史） */
  fyDividends?: Map<string, DividendAggregate> | undefined;
  /** 去年年报的报告期（连续分红年数的起数锚点，如 `2025-12-31`） */
  fyLastDate?: string | undefined;
  /** 最新负债率快照（undefined = 未采集） */
  debt?: DebtSnapshot | undefined;
}

/**
 * 解析推算状态（纯函数，判定顺序即优先级）
 * @param netProfitH1 今年中报净利（null = 未披露）
 * @param netProfitH1Last 去年中报净利（null = 未披露）
 * @param payoutLast 去年分红率（null = 不可得）
 * @returns 推算状态
 */
export const resolveProjectStatus = (
  netProfitH1: number | null,
  netProfitH1Last: number | null,
  payoutLast: number | null,
): ProjectStatus => {
  if (netProfitH1 === null) return DIVIDEND_PROJECT_STATUS.NO_REPORT;
  if (netProfitH1 <= 0) return DIVIDEND_PROJECT_STATUS.H1_LOSS;
  if (netProfitH1Last === null || netProfitH1Last <= 0) {
    return DIVIDEND_PROJECT_STATUS.BASE_INVALID;
  }
  if (payoutLast === null) return DIVIDEND_PROJECT_STATUS.NO_PAYOUT;
  return DIVIDEND_PROJECT_STATUS.OK;
};

/**
 * 从去年年报往前数连续现金分红的年度数（纯函数）
 *
 * 锚年（去年年报）无分红 = 0；分红史未采集返回 null（规则按数据缺失处理）；
 * 中途某年缺记录（未分红或停牌等）即停。入参的 Map 直接复用扫描返回的
 * 「报告期 → 聚合」分桶（里面含中期报告期，但本函数只查 `YYYY-12-31` 键，天然忽略）。
 * @param fyDividends 报告期 → 分红聚合
 * @param fyLastDate 锚年报告期（如 `2025-12-31`）
 * @returns 连续分红年数；分红史未采集为 null
 */
export const countConsecutiveDividendYears = (
  fyDividends: Map<string, DividendAggregate> | undefined,
  fyLastDate: string | undefined,
): number | null => {
  if (!fyDividends || !fyLastDate) return null;
  const anchorYear = Number(fyLastDate.slice(0, 4));
  if (!Number.isFinite(anchorYear)) return null;
  let years = 0;
  for (let offset = 0; offset < 100; offset += 1) {
    const aggregate = fyDividends.get(`${anchorYear - offset}-12-31`);
    if (aggregate === undefined || aggregate.dps <= 0) break;
    years += 1;
  }
  return years;
};

/**
 * 合成一行推算结论（纯函数）
 * @param inputs 输入集合（各数据源缺席语义见 `ScreenRowInputs`）
 * @returns 落库展示行
 */
export const buildScreenRow = (inputs: ScreenRowInputs): DividendScreenRow => {
  const { base, h1, h1Last, fyLast, divLast, divInterim, fyDividends, fyLastDate, debt } = inputs;

  // 去年每股分红：无记录 = 0（真实业务值，不是缺失）
  const dpsLast = divLast?.dps ?? 0;
  // 去年分红总额：优先用分红方案公告时的股本（与每股口径同源），缺股本时退排行快照的现值
  const dividendShares = divLast?.totalShares ?? base.totalShares;
  const dividendTotalLast =
    divLast !== undefined && dividendShares !== null ? dpsLast * dividendShares : null;

  const netProfitFyLast = fyLast?.netProfit ?? null;
  const payoutLast =
    dividendTotalLast !== null && dividendTotalLast > 0 && netProfitFyLast !== null && netProfitFyLast > 0
      ? dividendTotalLast / netProfitFyLast
      : null;

  const netProfitH1 = h1?.netProfit ?? null;
  const netProfitH1Last = h1Last?.netProfit ?? null;
  const growthH1 =
    netProfitH1 !== null && netProfitH1Last !== null && netProfitH1Last > 0
      ? netProfitH1 / netProfitH1Last
      : null;

  const status = resolveProjectStatus(netProfitH1, netProfitH1Last, payoutLast);
  const ok = status === DIVIDEND_PROJECT_STATUS.OK;

  // 推算链：只在状态为可推算时展开（任何一环缺失都保持 null，界面显示状态徽标）
  const projectedNetProfit =
    ok && netProfitFyLast !== null && growthH1 !== null ? netProfitFyLast * growthH1 : null;
  const projectedDividendTotal =
    ok && projectedNetProfit !== null && payoutLast !== null ? payoutLast * projectedNetProfit : null;
  const projectedDps =
    ok &&
    projectedDividendTotal !== null &&
    base.totalShares !== null &&
    base.totalShares > 0
      ? projectedDividendTotal / base.totalShares
      : null;
  const projectedYield =
    projectedDps !== null && base.price !== null && base.price > 0
      ? (projectedDps / base.price) * 100
      : null;

  const yieldLast =
    base.price !== null && base.price > 0 ? (dpsLast / base.price) * 100 : null;

  // 规则引擎指标：连续分红年数 / 现金流覆盖（每股比值，股本约掉）
  const dividendYears = countConsecutiveDividendYears(fyDividends, fyLastDate);
  const ocfPerShareLast = fyLast?.ocfPerShare ?? null;
  const cashCoverLast =
    ocfPerShareLast !== null && dpsLast > 0 ? ocfPerShareLast / dpsLast : null;

  return {
    code: base.code,
    name: base.name,
    industry: h1?.industry || fyLast?.industry || '',
    price: base.price,
    changePercent: base.changePercent,
    marketCap: base.marketCap,
    pb: base.pb,
    peTtm: base.peTtm,
    totalShares: base.totalShares,
    ttmYield: base.ttmYield,
    dpsLast,
    dividendTotalLast,
    netProfitFyLast,
    payoutLast,
    netProfitH1,
    netProfitH1Last,
    netProfitYoY: h1?.netProfitYoY ?? null,
    revenueYoY: h1?.revenueYoY ?? null,
    growthH1,
    projectedNetProfit,
    projectedDps,
    projectedYield,
    yieldLast,
    interimDps: divInterim?.dps ?? null,
    dividendYears,
    ocfPerShareLast,
    cashCoverLast,
    debtRatio: debt?.ratio ?? null,
    status,
  };
};

/**
 * 落库行的默认排序（纯函数）
 *
 * 推算股息率降序为第一优先（本插件的核心产出），不可推算的行沉底后按
 * TTM 股息率降序排（它们仍有「市面排行」的参考价值）。
 * @param rows 落库行
 * @returns 排序后的新数组（不改入参）
 */
export const sortScreenRows = (rows: readonly DividendScreenRow[]): DividendScreenRow[] =>
  [...rows].sort((a, b) => {
    const aYield = a.projectedYield ?? Number.NEGATIVE_INFINITY;
    const bYield = b.projectedYield ?? Number.NEGATIVE_INFINITY;
    if (aYield !== bYield) return bYield - aYield;
    const aTtm = a.ttmYield ?? Number.NEGATIVE_INFINITY;
    const bTtm = b.ttmYield ?? Number.NEGATIVE_INFINITY;
    return bTtm - aTtm;
  });

/**
 * 插件 dsh-flow-cycle（资金周期）纯函数判定层
 *
 * 只做数据整形：区间截取、基准交易日轴对齐（缺日 null）、区间净额合计与完整度标注。
 * 无副作用、无网络依赖，可被冒烟测试直跑（与 dsh-mainline/judge.ts 同思路）。
 */
import type {
  FlowCycleBoard,
  FlowCycleBoardHistory,
  FlowCycleCompleteness,
  FlowCycleHotBoard,
  FlowCycleSummary,
} from './types';

/**
 * 从历史序列截取最近 period 个交易日
 * @param history 原始历史（日期升序）
 * @param period 期间档位（交易日数）
 * @returns 截取后的序列（不足 period 时返回全部）
 */
const slicePeriod = (history: FlowCycleBoardHistory, period: number): FlowCycleBoardHistory => ({
  ...history,
  points: history.points.slice(-period),
});

/**
 * 判定数据完整度（截取后不足期间档位视为 partial）
 * @param length 截取后的逐日点数
 * @param period 期间档位
 * @returns 完整度
 */
const judgeCompleteness = (length: number, period: number): FlowCycleCompleteness =>
  length >= period ? 'complete' : 'partial';

/**
 * 把逐日历史聚合为页面消费的板块周期数据（对齐基准交易日轴）
 * @param histories 各板块原始历史（日期升序；失败板块已被 api 层跳过）
 * @param hotByCode 热点排行索引（合并名称与当日涨跌幅）
 * @param period 期间档位（交易日数）
 * @returns 期间聚合结果（板块按区间净额降序；无数据时 boards 为空数组）
 */
export const buildFlowCycleSummary = (
  histories: readonly FlowCycleBoardHistory[],
  hotByCode: ReadonlyMap<string, FlowCycleHotBoard>,
  period: number,
): FlowCycleSummary => {
  const sliced = histories.map((history) => slicePeriod(history, period));

  // 基准交易日轴：取各板块截取后最长的一组日期（同 A 股日历，仅次新板块历史更短）
  let baseDates: string[] = [];
  for (const history of sliced) {
    if (history.points.length > baseDates.length) {
      baseDates = history.points.map((point) => point.date);
    }
  }

  const boards: FlowCycleBoard[] = sliced.map((history) => {
    const hot = hotByCode.get(history.code);
    const netByDate = new Map(history.points.map((point) => [point.date, point.net]));
    const aligned = baseDates.map((date) => ({
      date,
      net: netByDate.get(date) ?? null,
    }));
    const name = hot?.name ?? history.name;
    const code = hot?.code ?? history.code;
    return {
      code,
      name,
      history: aligned,
      netSum: history.points.reduce((sum, point) => sum + point.net, 0),
      completeness: judgeCompleteness(history.points.length, period),
      changePercent: hot?.changePercent ?? null,
    };
  });

  boards.sort((a, b) => b.netSum - a.netSum);

  return {
    dates: baseDates,
    boards,
    tradeDays: baseDates.length,
    // 区间合计只统计完整板块：partial 板块的求和窗口与基准轴不一致，混入会是假合计
    netTotal: boards.reduce(
      (sum, board) => (board.completeness === 'complete' ? sum + board.netSum : sum),
      0,
    ),
  };
};

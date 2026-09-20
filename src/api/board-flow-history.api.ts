/**
 * 板块逐日资金流历史 api（Agent MCP 工具 `get_board_flow_history` 数据源）
 *
 * 上游（实测口径见 constants 头注释）：
 * - 热点名单：东财 clist 按 f174（10 日主力净额）排行，行业 t:2 + 概念 t:3 两源各取前
 *   BOARD_FLOW_HOT_CANDIDATES 合并排序；
 * - 逐日历史：fflow/daykline（klt=101）**直连 push2his**（push2delay 只有当日 1 条，勿改道），
 *   mapWithConcurrency(3) 限流 + 相邻请求 BOARD_FLOW_REQUEST_GAP_MS 错峰
 *   （2026-09-20 实测：30 连发无间隔会触发 push2his 对本机 IP 的 TCP RST 封禁）；
 * - push2his 被临时封禁时单板块失败跳过，由调用方按返回条目自行提示。
 *
 * 附带纯函数聚合 `buildBoardFlowSummary`：区间截取、基准交易日轴对齐（缺日 null）、
 * 区间净额合计与完整度标注。无副作用。
 */
import {
  BOARD_FLOW_BOARD_LIMIT,
  BOARD_FLOW_CLIST_URL_TEMPLATE,
  BOARD_FLOW_CONCURRENCY,
  BOARD_FLOW_DAYKLINE_COLUMN,
  BOARD_FLOW_DAYKLINE_URL_TEMPLATE,
  BOARD_FLOW_FS_CONCEPT,
  BOARD_FLOW_FS_INDUSTRY,
  BOARD_FLOW_FID_10D,
  BOARD_FLOW_HOT_CANDIDATES,
  BOARD_FLOW_REQUEST_GAP_MS,
  BOARD_FLOW_SECID_PREFIX,
} from '../constants/board-flow-history.constants';
import type {
  BoardFlowCompleteness,
  BoardFlowHotBoard,
  BoardFlowHistory,
  BoardFlowSummary,
  BoardFlowSummaryBoard,
} from '../types/board-flow-history.types';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { delay } from '../utils/delay';
import { proxyFetch } from './proxy-fetch';

/** clist 响应体（只取所需字段） */
interface ClistResponse {
  data: {
    diff: Array<{
      f12: string;
      f14: string;
      f3?: number | string | null;
      f164?: number | string | null;
      f174?: number | string | null;
    }> | null;
  } | null;
}

/** daykline 响应体（只取所需字段） */
interface DayKlineResponse {
  data: {
    code: string;
    name?: string;
    klines?: string[];
  } | null;
}

/**
 * 解析 clist 数值字段（fltt=2 下数字或 '-'，非法一律归 null）
 * @param raw 原始值
 * @returns 数值或 null
 */
const parseNum = (raw: number | string | null | undefined): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
};

/**
 * 拉取单一板块类型的净额排行（fid 固定 f174）
 * @param fs clist 的 fs 参数（m:90+t:2 行业 / m:90+t:3 概念）
 * @returns 排行行列表（接口异常返回空数组，由双源合并兜底）
 */
const fetchHotBoardPage = async (fs: string): Promise<BoardFlowHotBoard[]> => {
  const url = BOARD_FLOW_CLIST_URL_TEMPLATE.replace('{pz}', String(BOARD_FLOW_HOT_CANDIDATES))
    .replace('{fid}', BOARD_FLOW_FID_10D)
    .replace('{fs}', fs);
  const response = await proxyFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`board-flow clist ${fs} HTTP ${response.status}`);
  }
  const payload = (await response.json()) as ClistResponse;
  return (payload.data?.diff ?? []).map((row) => ({
    code: String(row.f12 ?? ''),
    name: String(row.f14 ?? ''),
    changePercent: parseNum(row.f3),
    net10d: parseNum(row.f174),
    net5d: parseNum(row.f164),
  }));
};

/**
 * 拉取热点板块名单：行业 + 概念两源按 10 日主力净额合并排序取前 N
 * @returns 热点板块列表（区间净额绝对值口径，净流入在前）
 */
export const fetchBoardFlowHotBoards = async (): Promise<BoardFlowHotBoard[]> => {
  const [industry, concept] = await Promise.all([
    fetchHotBoardPage(BOARD_FLOW_FS_INDUSTRY),
    fetchHotBoardPage(BOARD_FLOW_FS_CONCEPT).catch(() => []),
  ]);
  return [...industry, ...concept]
    .filter((row) => row.code.startsWith('BK'))
    .sort((a, b) => (b.net10d ?? 0) - (a.net10d ?? 0))
    .slice(0, BOARD_FLOW_BOARD_LIMIT);
};

/**
 * 拉取单个板块的逐日主力净流入历史（daykline 全量，截取由聚合层负责）
 * @param bkCode 板块代码（BK 编号）
 * @returns 历史序列（klines 为空或无有效点时抛错）
 */
export const fetchBoardFlowHistory = async (bkCode: string): Promise<BoardFlowHistory> => {
  const url = BOARD_FLOW_DAYKLINE_URL_TEMPLATE.replace(
    '{secid}',
    encodeURIComponent(`${BOARD_FLOW_SECID_PREFIX}${bkCode}`),
  );
  const response = await proxyFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`board-flow daykline ${bkCode} HTTP ${response.status}`);
  }
  const payload = (await response.json()) as DayKlineResponse;
  const points: BoardFlowHistory['points'] = [];
  for (const line of payload.data?.klines ?? []) {
    const columns = line.split(',');
    const date = columns[BOARD_FLOW_DAYKLINE_COLUMN.DATE]?.trim() ?? '';
    const net = Number(columns[BOARD_FLOW_DAYKLINE_COLUMN.MAIN]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(net)) {
      points.push({ date, net });
    }
  }
  if (points.length === 0) {
    throw new Error(`board-flow daykline ${bkCode} 无有效数据`);
  }
  return { code: bkCode, name: payload.data?.name ?? bkCode, points };
};

/**
 * 批量拉取板块逐日资金流历史（并发 3 限流 + 每请求前 500ms 错峰，单板块失败跳过不中断）
 * @param codes 板块代码列表（BK 编号）
 * @param options 可选项
 * @param options.onHistory 单板块历史到位回调（仅成功条目触发）
 * @returns 成功拉到的历史（完成顺序，调用方按需排序）
 */
export const fetchBoardFlowHistories = async (
  codes: readonly string[],
  options?: { onHistory?: (history: BoardFlowHistory) => void },
): Promise<BoardFlowHistory[]> => {
  const results = await mapWithConcurrency(
    codes,
    async (code) => {
      // 每个 worker 内相邻请求间隔 500ms：3 并发下整体节奏约 2.5 请求/秒，
      // 避免 30 连发无间隔触发 push2his 风控（对本机 IP TCP RST，见 constants.ts 头注释）
      await delay(BOARD_FLOW_REQUEST_GAP_MS);
      const history = await fetchBoardFlowHistory(code).catch(() => null);
      if (history) {
        options?.onHistory?.(history);
      }
      return history;
    },
    { concurrency: BOARD_FLOW_CONCURRENCY },
  );
  return results.filter((history): history is BoardFlowHistory => history !== null);
};

/**
 * 从历史序列截取最近 period 个交易日
 * @param history 原始历史（日期升序）
 * @param period 期间档位（交易日数）
 * @returns 截取后的序列（不足 period 时返回全部）
 */
const slicePeriod = (history: BoardFlowHistory, period: number): BoardFlowHistory => ({
  ...history,
  points: history.points.slice(-period),
});

/**
 * 判定数据完整度（截取后不足期间档位视为 partial）
 * @param length 截取后的逐日点数
 * @param period 期间档位
 * @returns 完整度
 */
const judgeCompleteness = (length: number, period: number): BoardFlowCompleteness =>
  length >= period ? 'complete' : 'partial';

/**
 * 把逐日历史聚合为区间周期数据（对齐基准交易日轴）
 * @param histories 各板块原始历史（日期升序；失败板块已被 api 层跳过）
 * @param hotByCode 热点排行索引（合并名称与当日涨跌幅）
 * @param period 期间档位（交易日数）
 * @returns 期间聚合结果（板块按区间净额降序；无数据时 boards 为空数组）
 */
export const buildBoardFlowSummary = (
  histories: readonly BoardFlowHistory[],
  hotByCode: ReadonlyMap<string, BoardFlowHotBoard>,
  period: number,
): BoardFlowSummary => {
  const sliced = histories.map((history) => slicePeriod(history, period));

  // 基准交易日轴：取各板块截取后最长的一组日期（同 A 股日历，仅次新板块历史更短）
  let baseDates: string[] = [];
  for (const history of sliced) {
    if (history.points.length > baseDates.length) {
      baseDates = history.points.map((point) => point.date);
    }
  }

  const boards: BoardFlowSummaryBoard[] = sliced.map((history) => {
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

/**
 * 插件 dsh-flow-cycle（资金周期）数据 api
 *
 * 上游（实测口径 2026-09-19，详见 constants.ts 头注释）：
 * - 热点名单：东财 clist 按 f174（10 日主力净额）排行，行业 t:2 + 概念 t:3 两源各取前
 *   FLOW_CYCLE_HOT_CANDIDATES 合并排序——名单与期间档位解耦（「近期热点」口径稳定）；
 * - 逐日历史：fflow/daykline（klt=101）**直连 push2his**（push2delay 只有当日 1 条，勿改道），
 *   每板块 1 请求 × 30，mapWithConcurrency(3) 限流，仅用户触发，不轮询；
 * - push2his 被临时封禁（数十分钟自愈）时单板块失败跳过，由页面给出重试入口，不静默。
 */
import {
  FLOW_CYCLE_BOARD_LIMIT,
  FLOW_CYCLE_CLIST_URL_TEMPLATE,
  FLOW_CYCLE_CONCURRENCY,
  FLOW_CYCLE_DAYKLINE_COLUMN,
  FLOW_CYCLE_DAYKLINE_URL_TEMPLATE,
  FLOW_CYCLE_FS_CONCEPT,
  FLOW_CYCLE_FS_INDUSTRY,
  FLOW_CYCLE_FID_10D,
  FLOW_CYCLE_HOT_CANDIDATES,
  FLOW_CYCLE_SECID_PREFIX,
} from './constants';
import type { FlowCycleBoardHistory, FlowCycleHotBoard } from './types';
import { mapWithConcurrency } from '../../utils/map-with-concurrency';
import { proxyFetch } from '../../api/proxy-fetch';

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
const fetchHotBoardPage = async (fs: string): Promise<FlowCycleHotBoard[]> => {
  const url = FLOW_CYCLE_CLIST_URL_TEMPLATE.replace('{pz}', String(FLOW_CYCLE_HOT_CANDIDATES))
    .replace('{fid}', FLOW_CYCLE_FID_10D)
    .replace('{fs}', fs);
  const response = await proxyFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`flow-cycle clist ${fs} HTTP ${response.status}`);
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
export const fetchFlowCycleHotBoards = async (): Promise<FlowCycleHotBoard[]> => {
  const [industry, concept] = await Promise.all([
    fetchHotBoardPage(FLOW_CYCLE_FS_INDUSTRY),
    fetchHotBoardPage(FLOW_CYCLE_FS_CONCEPT).catch(() => []),
  ]);
  return [...industry, ...concept]
    .filter((row) => row.code.startsWith('BK'))
    .sort((a, b) => (b.net10d ?? 0) - (a.net10d ?? 0))
    .slice(0, FLOW_CYCLE_BOARD_LIMIT);
};

/**
 * 拉取单个板块的逐日主力净流入历史（daykline 全量，截取由 judge 负责）
 * @param bkCode 板块代码（BK 编号）
 * @returns 历史序列（klines 为空或无有效点时抛错）
 */
export const fetchBoardFlowHistory = async (bkCode: string): Promise<FlowCycleBoardHistory> => {
  const url = FLOW_CYCLE_DAYKLINE_URL_TEMPLATE.replace(
    '{secid}',
    encodeURIComponent(`${FLOW_CYCLE_SECID_PREFIX}${bkCode}`),
  );
  const response = await proxyFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`flow-cycle daykline ${bkCode} HTTP ${response.status}`);
  }
  const payload = (await response.json()) as DayKlineResponse;
  const points: FlowCycleBoardHistory['points'] = [];
  for (const line of payload.data?.klines ?? []) {
    const columns = line.split(',');
    const date = columns[FLOW_CYCLE_DAYKLINE_COLUMN.DATE]?.trim() ?? '';
    const net = Number(columns[FLOW_CYCLE_DAYKLINE_COLUMN.MAIN]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(net)) {
      points.push({ date, net });
    }
  }
  if (points.length === 0) {
    throw new Error(`flow-cycle daykline ${bkCode} 无有效数据`);
  }
  return { code: bkCode, name: payload.data?.name ?? bkCode, points };
};

/**
 * 批量拉取板块逐日资金流历史（并发 3 限流，单板块失败跳过不中断）
 * @param codes 板块代码列表（BK 编号）
 * @param options 可选项
 * @param options.onHistory 单板块历史到位回调（渐进渲染用，仅成功条目触发）
 * @returns 成功拉到的历史（完成顺序，调用方按需排序）
 */
export const fetchFlowCycleHistories = async (
  codes: readonly string[],
  options?: { onHistory?: (history: FlowCycleBoardHistory) => void },
): Promise<FlowCycleBoardHistory[]> => {
  const results = await mapWithConcurrency(
    codes,
    async (code) => {
      const history = await fetchBoardFlowHistory(code).catch(() => null);
      if (history) {
        options?.onHistory?.(history);
      }
      return history;
    },
    { concurrency: FLOW_CYCLE_CONCURRENCY },
  );
  return results.filter((history): history is FlowCycleBoardHistory => history !== null);
};

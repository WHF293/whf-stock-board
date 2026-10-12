/**
 * 行业板块分时资金曲线 api（行情全景「板块资金」模块曲线视图数据源）
 *
 * 上游：东方财富板块分时资金流（fflow/kline，klt=1 分钟线），
 * 返回当日逐分钟**累计**主力净流入（元）。实测口径（2026-09-19）：
 * - push2delay 返回当日完整 241 点（09:31 → 15:00）——本项目直连它；
 * - push2his 同参数 klt=1 返回空 klines，勿改道（与 daykline 历史日线口径相反）；
 * - klt=5 等粗粒度返回 rc=102 无数据，仅 klt=1 可用。
 *
 * ⚠️ 频率红线：每板块 1 请求，批量经 mapWithConcurrency(3) 限流（东财系并发上限），
 * 仅用户进入 tab / 手动刷新 / 增删行业时触发，不轮询
 */
import {
  SECTOR_CURVE_CONCURRENCY,
  SECTOR_CURVE_DEFAULT_TOP,
  SECTOR_FLOW_KLINE_COLUMN,
  SECTOR_FLOW_KLINE_FALLBACK_URL_TEMPLATE,
  SECTOR_FLOW_KLINE_URL_TEMPLATE,
  SECTOR_SECID_PREFIX,
} from '../constants/sector-flow-curve.constants.ts';
import type { SectorFundFlowItem } from '../types/flow.types.ts';
import type { SectorFlowCurve, SectorFlowCurvePoint } from '../types/sector-flow-curve.types.ts';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { proxyFetch } from './proxy-fetch';

/** fflow/kline 响应体（只取所需字段） */
interface SectorFlowKlineResponse {
  /** 数据体（无数据时为 null） */
  data: {
    /** 板块代码（BK 编号） */
    code: string;
    /** 板块名称 */
    name?: string;
    /** kline 行数组（"YYYY-MM-DD HH:mm,主力,小单,中单,大单,超大单"） */
    klines?: string[];
  } | null;
}

/** kline 行解析结果（含日期，供 tradeDate 归属） */
interface ParsedKlinePoint extends SectorFlowCurvePoint {
  /** 日期（YYYY-MM-DD） */
  date: string;
}

/**
 * 解析单条 kline 行为曲线点
 * @param line kline 原始行（"YYYY-MM-DD HH:mm,主力,…"）
 * @returns 解析结果（列数不足 / 数值非法时返回 null）
 */
const parseKlineLine = (line: string): ParsedKlinePoint | null => {
  const columns = line.split(',');
  const rawTime = columns[SECTOR_FLOW_KLINE_COLUMN.TIME]?.trim() ?? '';
  const rawValue = Number(columns[SECTOR_FLOW_KLINE_COLUMN.MAIN]);
  if (!rawTime.includes(' ') || !Number.isFinite(rawValue)) {
    return null;
  }
  const [date, time] = rawTime.split(' ');
  return { date, time, mainNetInflow: rawValue };
};

/**
 * 按模板拉取单个板块的 fflow/kline 响应体（传输层 / HTTP 状态失败抛错）
 * @param template 上游 URL 模板（主用或备用域）
 * @param bkCode 板块代码（BK 编号）
 * @returns 响应体 JSON
 */
const fetchKlinePayload = async (
  template: string,
  bkCode: string,
): Promise<SectorFlowKlineResponse> => {
  const url = template.replace(
    '{secid}',
    encodeURIComponent(`${SECTOR_SECID_PREFIX}${bkCode}`),
  );
  const response = await proxyFetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as SectorFlowKlineResponse;
};

/**
 * 拉取单个行业板块的当日分时资金曲线
 *
 * 主域（push2delay）传输层 / HTTP 失败时回落备域（push2）重试一次：
 * push2delay 是按本机 PC 网络选定的镜像，真机等其他网络下可能不可达而原生域可达
 * （2026-10-12 真机「板块资金」全败的推断根因）；空数据（rc=0 但 klines 空，
 * 如 push2his 的 klt=1 口径）属有效响应，不触发回落，仍按诚实错误抛出
 * @param bkCode 板块代码（BK 编号，如 BK0475）
 * @returns 曲线（klines 为空或无有效点时抛错）
 */
export const fetchSectorFlowCurve = async (bkCode: string): Promise<SectorFlowCurve> => {
  let payload: SectorFlowKlineResponse;
  try {
    payload = await fetchKlinePayload(SECTOR_FLOW_KLINE_URL_TEMPLATE, bkCode);
  } catch (primaryError) {
    try {
      payload = await fetchKlinePayload(SECTOR_FLOW_KLINE_FALLBACK_URL_TEMPLATE, bkCode);
    } catch {
      throw new Error(
        `板块资金曲线上游不可达（主备域均失败）：${
          primaryError instanceof Error ? primaryError.message : String(primaryError)
        }`,
      );
    }
  }
  const points = (payload.data?.klines ?? [])
    .map(parseKlineLine)
    .filter((point): point is ParsedKlinePoint => point !== null);
  if (points.length === 0) {
    throw new Error(`sector flow kline ${bkCode} 无有效数据`);
  }
  return {
    code: bkCode,
    name: payload.data?.name || undefined,
    tradeDate: points[0].date,
    points: points.map(({ time, mainNetInflow }) => ({ time, mainNetInflow })),
  };
};

/**
 * 批量拉取行业板块分时资金曲线（并发 3 限流，单板块失败跳过不中断）
 * @param codes 板块代码列表（BK 编号）
 * @param options 可选项
 * @param options.onCurve 单条曲线到位回调（渐进渲染用，仅成功条目触发）
 * @param options.onError 单条失败回调（含真实错误，页面错误态透出用）
 * @returns 成功拉到的曲线（完成顺序，调用方按需排序）
 */
export const fetchSectorFlowCurves = async (
  codes: readonly string[],
  options?: {
    onCurve?: (curve: SectorFlowCurve) => void;
    onError?: (code: string, error: unknown) => void;
  },
): Promise<SectorFlowCurve[]> => {
  const results = await mapWithConcurrency(
    codes,
    async (code) => {
      const curve = await fetchSectorFlowCurve(code).catch((error: unknown) => {
        options?.onError?.(code, error);
        return null;
      });
      if (curve) {
        options?.onCurve?.(curve);
      }
      return curve;
    },
    { concurrency: SECTOR_CURVE_CONCURRENCY },
  );
  return results.filter((curve): curve is SectorFlowCurve => curve !== null);
};

/**
 * 从板块净流入排名挑选默认曲线行业（净流入前 N + 净流出前 N，去重）
 * @param rank 板块净流入排名（当日口径）
 * @param topPerSide 每侧条数（默认 8）
 * @returns 板块代码列表（BK 编号，流入侧在前、流出侧按流出幅度降序在后）
 */
export const pickDefaultCurveCodes = (
  rank: readonly SectorFundFlowItem[],
  topPerSide: number = SECTOR_CURVE_DEFAULT_TOP,
): string[] => {
  const sorted = [...rank].sort((a, b) => (b.mainNetInflow ?? 0) - (a.mainNetInflow ?? 0));
  const inflow = sorted.slice(0, topPerSide);
  const outflow = sorted.slice(-topPerSide).reverse();
  const codes: string[] = [];
  for (const item of [...inflow, ...outflow]) {
    if (item.code && !codes.includes(item.code)) {
      codes.push(item.code);
    }
  }
  return codes;
};

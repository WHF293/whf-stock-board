import {
  HUIJIN_EM_FIELDS,
  HUIJIN_EM_REFERER,
  HUIJIN_EM_ULIST_URL_TEMPLATE,
  HUIJIN_SSE_LOOKBACK_DAYS,
  HUIJIN_SSE_PAGE_SIZE,
  HUIJIN_SSE_REFERER,
  HUIJIN_SSE_URL_TEMPLATE,
  HUIJIN_WAN_SHARES,
} from '../constants/huijin-etf-flow.constants.ts';
import { WIDE_BASE_ETFS } from '../constants/wide-base-etf.constants.ts';
import { push2Fetch } from './push2-fetch';
import { proxyFetch } from './proxy-fetch';


/**
 * 汇金估算模块的份额快照取数（两条通道，2026-11-06 实测口径）
 *
 * - 当日（盘中实时 / 收盘最新）：东财 `push2delay ulist.np/get` 一次带全部 secid，
 *   f38 = 最新份额（份）、f20 = 总市值（元），单价 = f20 / f38（反推，ulist 不回填 f43）；
 *   经 push2Fetch（push2delay 主域失败回落 push2 原生域）
 * - 历史起步（昨日 / 更近的已披露交易日）：上交所 `query.sse.com.cn` 官方逐日规模表，
 *   TOT_VOL = 总份额（万份），仅覆盖沪市（深市 3 只首日空缺，靠本地东财快照次日齐）
 *
 * 一日各仅 1 次请求，频率极低；进页触发不轮询。
 */

/** ulist 响应体（只取所需字段；fltt=2 下无效值回传 '-'） */
interface UlistResponse {
  data: {
    diff: Array<{
      f12: string;
      f14?: string;
      f38?: number | string | null;
      f20?: number | string | null;
    }> | null;
  } | null;
}

/** SSE 响应体（只取所需字段） */
interface SseResponse {
  result: Array<{
    SEC_CODE: string;
    SEC_NAME?: string;
    TOT_VOL?: string | number | null;
  }> | null;
}

/**
 * 完整符号转东财 secid（sh510300 -> 1.510300；sz159919 -> 0.159919）
 * @param symbol 完整符号（sh/sz 前缀 6 位代码）
 * @returns secid（不合法返回 null）
 */
const symbolToSecid = (symbol: string): string | null => {
  const match = /^(sh|sz)(\d{6})$/i.exec(symbol.trim());
  if (!match) return null;
  const market = match[1]!.toLowerCase() === 'sh' ? '1' : '0';
  return `${market}.${match[2]}`;
};

/**
 * 宽松数值解析（'-' / 空串 / 非数值归 null）
 * @param raw 原始值
 * @returns 数值或 null
 */
const parseNum = (raw: number | string | null | undefined): number | null => {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
};

/**
 * 批量拉取全部汇金系宽基 ETF 的当日份额快照（东财 ulist 单请求）
 * @returns 快照（代码 -> 份额 + 反推单价；上游异常字段整只缺失）
 * @throws Error 上游 HTTP 非 200 或无有效数据时抛出
 */
export const fetchEtfTotalSharesToday = async (): Promise<
  Record<string, { shares: number; price: number | null; fetchedAt: number }>
> => {
  const secids = WIDE_BASE_ETFS.map((item) => symbolToSecid(item.symbol))
    .filter((secid): secid is string => secid !== null)
    .join(',');
  const url = HUIJIN_EM_ULIST_URL_TEMPLATE.replace('{secids}', secids).replace(
    '{fields}',
    HUIJIN_EM_FIELDS,
  );
  const response = await push2Fetch(url, {
    headers: { Referer: HUIJIN_EM_REFERER, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`汇金份额 ulist HTTP ${response.status}`);
  }
  const payload = (await response.json()) as UlistResponse;
  const rows = payload.data?.diff;
  if (!rows || rows.length === 0) {
    throw new Error('汇金份额 ulist 无有效数据');
  }
  const fetchedAt = Date.now();
  const points: Record<string, { shares: number; price: number | null; fetchedAt: number }> = {};
  for (const row of rows) {
    const shares = parseNum(row.f38);
    if (shares === null) continue;
    const marketValue = parseNum(row.f20);
    const price = marketValue !== null ? marketValue / shares : null;
    points[row.f12] = { shares, price, fetchedAt };
  }
  if (Object.keys(points).length === 0) {
    throw new Error('汇金份额 ulist 无有效份额字段');
  }
  return points;
};

/**
 * 拉取上交所某交易日的全部 ETF 份额（官方口径，万份换算为份）
 * @param date 交易日（YYYY-MM-DD）
 * @returns 沪市 ETF 份额映射（6 位纯代码 -> 份；该日无数据为空 Map）
 * @throws Error 上游 HTTP 非 200 时抛出
 */
export const fetchSseEtfShares = async (date: string): Promise<Map<string, number>> => {
  const url = HUIJIN_SSE_URL_TEMPLATE.replace('{pageSize}', String(HUIJIN_SSE_PAGE_SIZE)).replace(
    '{date}',
    date,
  );
  const response = await proxyFetch(url, {
    headers: { Referer: HUIJIN_SSE_REFERER, Accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`上交所份额查询 HTTP ${response.status}`);
  }
  const payload = (await response.json()) as SseResponse;
  const sharesByCode = new Map<string, number>();
  for (const row of payload.result ?? []) {
    const rawVol = Number(row.TOT_VOL);
    if (row.SEC_CODE && Number.isFinite(rawVol) && rawVol > 0) {
      sharesByCode.set(row.SEC_CODE, rawVol * HUIJIN_WAN_SHARES);
    }
  }
  return sharesByCode;
};

/**
 * 首次起步：从指定日期往回找最近一个有上交所数据的日子并返回其份额快照
 * （最多回看 HUIJIN_SSE_LOOKBACK_DAYS 天；长假 / 接口异常时返回 null，
 * 全部 ETF 改以东财首拉日为基准，深市份额次日齐）
 * @param startDate 起始回看日期（通常为昨日，YYYY-MM-DD）
 * @returns 最近有数据交易日的快照（date + 份额），无可用数据为 null
 */
export const fetchSseBaselineSnapshot = async (
  startDate: string,
): Promise<{ date: string; sharesByCode: Map<string, number> } | null> => {
  const startMs = Date.parse(`${startDate}T00:00:00`);
  if (!Number.isFinite(startMs)) return null;
  for (let offset = 0; offset < HUIJIN_SSE_LOOKBACK_DAYS; offset += 1) {
    const dayMs = startMs - offset * 24 * 60 * 60 * 1000;
    const date = new Date(dayMs).toISOString().slice(0, 10);
    try {
      const sharesByCode = await fetchSseEtfShares(date);
      if (sharesByCode.size > 0) {
        return { date, sharesByCode };
      }
    } catch {
      // 单日查询失败继续往回找；全空由外层兜底
    }
  }
  return null;
};

/**
 * 把 SSE 份额映射转成快照点（SSE 无价格，price 置 null，金额估算该日不可用）
 * @param sharesByCode SSE 份额映射（6 位纯代码 -> 份）
 * @param date 快照归属日期
 * @returns 快照点映射（仅含宽基清单内代码；缺失项即该日无数据）
 */
export const buildSseSnapshotPoints = (
  sharesByCode: ReadonlyMap<string, number>,
  date: string,
): Record<string, { shares: number; price: null; fetchedAt: number }> => {
  const fetchedAt = Date.parse(`${date}T15:00:00`) || Date.now();
  const points: Record<string, { shares: number; price: null; fetchedAt: number }> = {};
  for (const item of WIDE_BASE_ETFS) {
    const code = item.symbol.replace(/^(sh|sz)/i, '');
    const shares = sharesByCode.get(code);
    if (shares !== undefined) {
      points[code] = { shares, price: null, fetchedAt };
    }
  }
  return points;
};

/**
 * 取宽基清单内的展示名（6 位纯代码）
 * @param code 6 位纯代码
 * @returns 名称（清单外返回代码本身）
 */
export const wideBaseEtfName = (code: string): string => {
  const item = WIDE_BASE_ETFS.find((etf) => etf.symbol.replace(/^(sh|sz)/i, '') === code);
  return item?.name ?? code;
};

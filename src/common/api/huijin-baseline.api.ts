import {
  HUIJIN_BASELINE_TTL_MS,
  HUIJIN_CYRJG_QUERY_TEMPLATE,
  HUIJIN_RATIO_OVERRIDES,
} from '../constants/huijin-etf-flow.constants.ts';
import { ETF_JJCC_REFERER, ETF_JJCC_URL } from '../constants/etf.constants.ts';
import { EASTMONEY_USER_AGENT } from '../constants/board-calendar.constants.ts';
import { HUIJIN_BASELINE_SOURCE } from '../types/huijin-etf-flow.types.ts';
import type { HuijinEtfBaseline } from '../types/huijin-etf-flow.types.ts';
import { parseFundHolderStructureHtml } from '../utils/parse-fund-holder-structure-html';
import { loadHuijinBaselineCache, saveHuijinBaselineCache } from './huijin-baseline-cache.api';
import { proxyFetch } from './proxy-fetch';

/**
 * 汇金估算模块的占比基准取数（天天基金 f10「持有人结构」，季报披露口径）
 *
 * 基准优先级：① 常量覆盖表（HUIJIN_RATIO_OVERRIDES，手填的定期报告汇金精确占比，
 * 永远生效零请求）→ ② cyrjg 最新报告期「机构持有比例」（真实披露；宽基 ETF 机构盘
 * 以汇金系为绝对主导，作为近似基准，报告期随披露更新 = 天然校准）。
 *
 * cyrjg 读走本地缓存（缺失或超过 TTL 才回源），用户点「刷新」时 force 全量回源。
 */

/**
 * 抓取一只 ETF 的持有人结构（仅回源，不做缓存判断）
 * @param code 6 位纯代码
 * @returns 披露记录（解析不到数据行时抛错）
 * @throws Error 上游 HTTP 非 200、解析失败时抛出
 */
const fetchHolderStructureRemote = async (code: string) => {
  const params = HUIJIN_CYRJG_QUERY_TEMPLATE.replace('{code}', code).replace(
    '{rt}',
    String(Date.now() % 1000 / 1000),
  );
  const response = await proxyFetch(`${ETF_JJCC_URL}?${params}`, {
    headers: { 'User-Agent': EASTMONEY_USER_AGENT, Referer: ETF_JJCC_REFERER },
  });
  if (!response.ok) {
    throw new Error(`持有人结构接口 HTTP ${response.status}`);
  }
  const parsed = parseFundHolderStructureHtml(await response.text());
  if (!parsed) {
    throw new Error('未解析到持有人结构数据（可能非场内基金或上游限频）');
  }
  return parsed;
};

/**
 * 读取一只 ETF 的占比基准：覆盖表优先，其次缓存 / 回源 cyrjg
 * @param code 6 位纯代码
 * @param force 是否跳过缓存强制回源（用户点「刷新」）
 * @returns 占比基准；覆盖表与 cyrjg 均不可得时为 null（该 ETF 不参与估算）
 */
export const getHuijinBaseline = async (
  code: string,
  force = false,
): Promise<HuijinEtfBaseline | null> => {
  const overrideRatio = HUIJIN_RATIO_OVERRIDES[code];
  if (overrideRatio !== undefined && overrideRatio > 0) {
    return {
      code,
      ratioPct: overrideRatio,
      reportDate: '',
      reportTotalSharesYi: null,
      source: HUIJIN_BASELINE_SOURCE.OVERRIDE,
      fetchedAt: 0,
    };
  }
  if (!force) {
    const cached = loadHuijinBaselineCache(code);
    if (cached && Date.now() - cached.fetchedAt < HUIJIN_BASELINE_TTL_MS) {
      return cached;
    }
  }
  try {
    const record = await fetchHolderStructureRemote(code);
    if (record.institutionalRatioPct === null) {
      return null;
    }
    const baseline: HuijinEtfBaseline = {
      code,
      ratioPct: record.institutionalRatioPct,
      reportDate: record.reportDate,
      reportTotalSharesYi: record.totalSharesYi,
      source: HUIJIN_BASELINE_SOURCE.INSTITUTIONAL,
      fetchedAt: Date.now(),
    };
    saveHuijinBaselineCache(baseline);
    return baseline;
  } catch (error) {
    // 回源失败回退任意旧缓存（数据过期好过没有，界面展示报告期即可判断新旧）
    const stale = loadHuijinBaselineCache(code);
    if (stale) {
      return stale;
    }
    console.error(`[huijin-baseline] ${code} 占比基准取数失败`, error);
    return null;
  }
};

/**
 * 批量读取全部宽基 ETF 的占比基准（逐只并发拉取，单只失败不影响其余）
 * @param codes 6 位纯代码列表
 * @param force 是否跳过缓存强制回源
 * @returns 基准映射（code -> 基准；取不到的代码不出现在结果里）
 */
export const getHuijinBaselines = async (
  codes: readonly string[],
  force = false,
): Promise<Record<string, HuijinEtfBaseline>> => {
  const entries = await Promise.all(
    codes.map(async (code) => {
      const baseline = await getHuijinBaseline(code, force);
      return baseline ? ([code, baseline] as const) : null;
    }),
  );
  return Object.fromEntries(entries.filter((entry): entry is NonNullable<typeof entry> => entry !== null));
};

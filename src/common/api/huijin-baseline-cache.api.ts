import { STORAGE_NS_HUIJIN_BASELINE } from '../constants/storage-key.constants.ts';
import { appStorage } from '../utils/app-local-storage';
import type { HuijinEtfBaseline } from '../types/huijin-etf-flow.types.ts';

/**
 * 汇金占比基准本地缓存（whf:app 整包的 `huijin.baseline` 命名空间，JSON 串存储）
 *
 * 持有人比例按季度披露，缓存以 ETF 代码为键整包存取；
 * 已登记进 DATA_PORT_MANIFEST 随换机迁移（体量极小，与份额历史独立 key 分开——
 * 基准是快照、历史是累积序列，生命周期不同）
 */

/** 基准缓存整包（code -> 基准） */
type HuijinBaselineCache = Record<string, HuijinEtfBaseline>;

/**
 * 读取一只 ETF 的缓存基准
 * @param code ETF 6 位代码
 * @returns 基准记录（无缓存或解析失败为 null）
 */
export const loadHuijinBaselineCache = (code: string): HuijinEtfBaseline | null => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_HUIJIN_BASELINE);
    if (!raw) return null;
    const cache = JSON.parse(raw) as HuijinBaselineCache;
    const record = cache[code] ?? null;
    if (!record || !(record.ratioPct > 0)) return null;
    return record;
  } catch (error) {
    console.error('[huijin-baseline] load-cache', error);
    return null;
  }
};

/**
 * 写入一只 ETF 的基准缓存（覆盖同代码旧记录）
 * @param record 占比基准记录
 */
export const saveHuijinBaselineCache = (record: HuijinEtfBaseline): void => {
  let cache: HuijinBaselineCache;
  try {
    cache = JSON.parse(appStorage.getItem(STORAGE_NS_HUIJIN_BASELINE) ?? '{}') as HuijinBaselineCache;
  } catch {
    cache = {};
  }
  cache[record.code] = record;
  appStorage.setItem(STORAGE_NS_HUIJIN_BASELINE, JSON.stringify(cache));
};

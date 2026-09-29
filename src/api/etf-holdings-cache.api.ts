import { STORAGE_NS_ETF_HOLDINGS } from '../constants/storage-key.constants';
import { appStorage } from '../utils/app-local-storage';
import type { EtfHoldingsCache, EtfHoldingsRecord } from '../types/etf.types';

/**
 * ETF 持仓本地缓存（whf:app 整包的 `etf.holdings` 命名空间，JSON 串存储）
 *
 * 持仓按季度披露，缓存以 ETF 代码为键整包存取；已登记进 DATA_PORT_MANIFEST 随换机迁移
 */

/**
 * 读取一只 ETF 的缓存持仓
 * @param code ETF 6 位代码
 * @returns 持仓记录（无缓存或解析失败为 null）
 */
export const loadEtfHoldingsCache = (code: string): EtfHoldingsRecord | null => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_ETF_HOLDINGS);
    if (!raw) return null;
    const cache = JSON.parse(raw) as EtfHoldingsCache;
    const record = cache[code] ?? null;
    // 历史脏数据防护：早期按 GBK 误解码写入的记录 reportDate 必为空，直接视为无缓存
    if (!record || !record.reportDate || record.holdings.length === 0) return null;
    return record;
  } catch (error) {
    console.error('[etf-holdings] load-cache', error);
    return null;
  }
};

/**
 * 写入一只 ETF 的持仓缓存（覆盖同代码旧记录）
 * @param record 抓取到的持仓记录
 */
export const saveEtfHoldingsCache = (record: EtfHoldingsRecord): void => {
  let cache: EtfHoldingsCache;
  try {
    cache = JSON.parse(appStorage.getItem(STORAGE_NS_ETF_HOLDINGS) ?? '{}') as EtfHoldingsCache;
  } catch {
    cache = {};
  }
  cache[record.code] = record;
  appStorage.setItem(STORAGE_NS_ETF_HOLDINGS, JSON.stringify(cache));
};

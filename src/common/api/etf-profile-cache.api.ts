import { STORAGE_NS_ETF_PROFILE } from '../constants/storage-key.constants.ts';
import { appStorage } from '../utils/app-local-storage';
import type { EtfProfileCache, EtfProfileRecord } from '../types/etf.types.ts';

/**
 * ETF 基金概况本地缓存（whf:app 整包的 `etf.profile` 命名空间，JSON 串存储）
 *
 * 规模按季度披露、费率极少变动，缓存以 ETF 代码为键整包存取；
 * 已并入 data-port 的 etf-holdings 条目（nsKeys 追加 etf.profile）随换机迁移
 */

/**
 * 读取一只 ETF 的缓存概况
 * @param code ETF 6 位代码
 * @returns 概况记录（无缓存或解析失败为 null）
 */
export const loadEtfProfileCache = (code: string): EtfProfileRecord | null => {
  try {
    const raw = appStorage.getItem(STORAGE_NS_ETF_PROFILE);
    if (!raw) return null;
    const cache = JSON.parse(raw) as EtfProfileCache;
    const record = cache[code] ?? null;
    // 脏数据防护：全字段皆空的记录视为无缓存（下次回源）
    if (!record || (record.fullName === null && record.netAssetScale === null)) return null;
    return record;
  } catch (error) {
    console.error('[etf-profile] load-cache', error);
    return null;
  }
};

/**
 * 写入一只 ETF 的概况缓存（覆盖同代码旧记录）
 * @param record 抓取到的概况记录
 */
export const saveEtfProfileCache = (record: EtfProfileRecord): void => {
  let cache: EtfProfileCache;
  try {
    cache = JSON.parse(appStorage.getItem(STORAGE_NS_ETF_PROFILE) ?? '{}') as EtfProfileCache;
  } catch {
    cache = {};
  }
  cache[record.code] = record;
  appStorage.setItem(STORAGE_NS_ETF_PROFILE, JSON.stringify(cache));
};

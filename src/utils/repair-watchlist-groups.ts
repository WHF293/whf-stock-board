import { WATCHLIST_SYMBOL_PATTERN } from '../constants/watchlist.constants';
import { toFullSymbol } from './to-full-symbol';
import type { WatchlistGroup, WatchlistStock } from '../types/watchlist.types';

/** 清洗结果 */
export interface WatchlistRepairResult {
  /** 清洗后的分组（新数组，不改入参） */
  groups: WatchlistGroup[];
  /** 是否发生了修改（true 时需要回写持久化） */
  changed: boolean;
}

/**
 * 清洗持久化里的自选分组数据（载入时执行）
 *
 * 两层清理：
 * ① 剔除符号形态非法的条目——早期 `String(normalizeSymbol(...))` 把 NormalizedSymbol
 *    品牌对象写成了 `"[object Object]"`，这类条目取不到行情（整行 `--`）且无法反查原股；
 * ② 合法符号统一为完整形态并按组去重（脏数据里可能同时存了 `600519` 与 `sh600519`）
 * @param groups 原始分组（持久化数据）
 * @returns 清洗后的分组与是否变更
 */
export const repairWatchlistGroups = (groups: WatchlistGroup[]): WatchlistRepairResult => {
  let changed = false;
  const cleaned: WatchlistGroup[] = groups.map((group) => {
    const seen = new Set<string>();
    // stocks 缺失 / 非数组（手改过的持久化数据）一律按空组处理，避免下游读 .length 崩
    const source = Array.isArray(group.stocks) ? group.stocks : [];
    const stocks: WatchlistStock[] = [];
    for (const stock of source) {
      const symbol = toFullSymbol(String(stock?.symbol ?? ''));
      if (!WATCHLIST_SYMBOL_PATTERN.test(symbol) || seen.has(symbol)) {
        changed = true;
        continue;
      }
      seen.add(symbol);
      stocks.push(symbol === stock.symbol ? stock : { ...stock, symbol });
      if (symbol !== stock.symbol) {
        changed = true;
      }
    }
    if (Array.isArray(group.stocks) && stocks.length === source.length) {
      return group;
    }
    return { ...group, stocks };
  });
  return { groups: cleaned, changed };
};

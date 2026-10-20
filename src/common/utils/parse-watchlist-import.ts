import { WATCHLIST_SYMBOL_PATTERN } from '../constants/watchlist.constants.ts';
import type { WatchlistGroup, WatchlistStock } from '../types/watchlist.types.ts';

/**
 * 解析「自选导入」粘贴文本 → 自选分组列表（宽松：能解析多少算多少，坏条目静默剔除）
 *
 * 接受两种形态（PC「数据迁移 → 复制 JSON 片段」产物为前者）：
 * 1. DataPortFile 结构：{ formatVersion, data: { 'stock-board': { watchlist_group, watchlist_stock } } }，
 *    watchlist_group / watchlist_stock 为 SQLite 两表的行数组（列名 group_id / added_at 蛇形）；
 * 2. WatchlistGroup[] 直出数组：[{ id, name, stocks: [{ symbol, name, addedAt }] }]。
 *
 * @param text 粘贴的原文
 * @returns 解析出的分组列表（组内符号已按 WATCHLIST_SYMBOL_PATTERN 过滤 + 去重，保持原有顺序）
 * @throws Error 文本不是合法 JSON / 结构不匹配任何已知形态 / 没有解析出任何分组
 */
export const parseWatchlistImportText = (text: string): WatchlistGroup[] => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('粘贴内容不是合法的 JSON');
  }

  const groups = Array.isArray(parsed)
    ? parseGroupsArray(parsed)
    : isDataPortFileLike(parsed)
      ? parseDataPortGroups(
          (parsed.data['stock-board'] ?? {}) as Record<string, unknown>,
        )
      : null;

  if (groups === null) {
    throw new Error('内容结构不符合导出格式（支持 PC「数据导出 / JSON 片段」或自选分组数组）');
  }
  if (groups.length === 0) {
    throw new Error('内容里没有自选股数据（导出时请勾选「自选股」类别）');
  }
  return groups;
};

/**
 * 判断是否为数据导出文件形态（formatVersion + data 两级结构即可认定，宽进严出）
 * @param value 待判定值
 * @returns 是否为导出文件形态
 */
const isDataPortFileLike = (value: unknown): value is { data: Record<string, unknown> } =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { formatVersion?: unknown }).formatVersion === 'number' &&
  typeof (value as { data?: unknown }).data === 'object' &&
  (value as { data: unknown }).data !== null;

/** 数据导出文件里的自选股表行（SQLite SELECT * 透传，宽松读取） */
interface WatchlistRow {
  [key: string]: unknown;
}

/**
 * 解析 DataPortFile 的 stock-board 库桶 → 分组列表（行结构对齐 watchlist-db.api 的读取口径）
 * @param bucket stock-board 库的数据桶
 * @returns 分组列表（空数组 = 桶里没有自选股表）
 */
const parseDataPortGroups = (bucket: Record<string, unknown>): WatchlistGroup[] => {
  const groupRows = asRows(bucket.watchlist_group);
  const stockRows = asRows(bucket.watchlist_stock);
  if (groupRows.length === 0) return [];

  const stocksByGroup = new Map<string, WatchlistStock[]>();
  for (const row of stockRows) {
    const symbol = str(row.symbol);
    if (!WATCHLIST_SYMBOL_PATTERN.test(symbol)) continue;
    const groupId = str(row.group_id);
    const list = stocksByGroup.get(groupId) ?? [];
    if (list.some((item) => item.symbol === symbol)) continue;
    list.push({
      symbol,
      name: str(row.name) || symbol,
      addedAt: num(row.added_at),
    });
    stocksByGroup.set(groupId, list);
  }

  return groupRows.flatMap((row) => {
    const id = str(row.id);
    const name = str(row.name);
    if (!id || !name) return [];
    return [{ id, name, stocks: stocksByGroup.get(id) ?? [] }];
  });
};

/**
 * 解析 WatchlistGroup[] 直出数组（组内符号过滤 + 去重）
 * @param value 待解析数组
 * @returns 分组列表（无法识别的条目剔除）
 */
const parseGroupsArray = (value: unknown[]): WatchlistGroup[] =>
  value.flatMap((entry) => {
    if (typeof entry !== 'object' || entry === null) return [];
    const record = entry as Record<string, unknown>;
    const id = str(record.id);
    const name = str(record.name);
    if (!id || !name) return [];
    const stocks: WatchlistStock[] = [];
    for (const raw of Array.isArray(record.stocks) ? record.stocks : []) {
      if (typeof raw !== 'object' || raw === null) continue;
      const row = raw as Record<string, unknown>;
      const symbol = str(row.symbol);
      if (!WATCHLIST_SYMBOL_PATTERN.test(symbol)) continue;
      if (stocks.some((item) => item.symbol === symbol)) continue;
      stocks.push({ symbol, name: str(row.name) || symbol, addedAt: num(row.addedAt) });
    }
    return [{ id, name, stocks }];
  });

/**
 * 未知桶值 → 行数组（非数组返回空）
 * @param value 待转换值
 * @returns 行数组
 */
const asRows = (value: unknown): WatchlistRow[] =>
  Array.isArray(value) ? value.filter((row): row is WatchlistRow => typeof row === 'object' && row !== null) : [];

/**
 * 未知值 → 非空字符串（null / undefined / 非字符串返回空串）
 * @param value 待转换值
 * @returns 字符串
 */
const str = (value: unknown): string => (typeof value === 'string' ? value : '');

/**
 * 未知值 → 毫秒时间戳（缺省 / 非法回落当前时间，与 watchlist-db 读取口径一致）
 * @param value 待转换值
 * @returns 时间戳
 */
const num = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : Date.now();

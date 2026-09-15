/**
 * 自选股常量
 */

/** 默认自选分组 id（固定值，不可删除） */
export const DEFAULT_GROUP_ID = 'default';

/** 默认自选分组名称 */
export const DEFAULT_GROUP_NAME = '默认分组';

/** 删除分组的确认文案 */
export const REMOVE_GROUP_CONFIRM_TEXT = '确认删除该分组？组内自选股将一并移除';

/**
 * 合法自选符号形态（sh600519 / sz000001 / bj430047 / hk00700 / usAAPL）
 *
 * 用于落库前校验与历史脏数据清理：早期版本把 NormalizedSymbol 对象
 * `String()` 成了 `"[object Object]"`，这类条目取不到行情（整行 `--`），
 * 载入时必须剔除（见 stores/watchlist.ts afterHydrate）
 */
export const WATCHLIST_SYMBOL_PATTERN = /^(sh|sz|bj|hk|us)[0-9A-Za-z.]+$/;

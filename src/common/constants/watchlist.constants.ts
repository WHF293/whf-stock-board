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

// ---------- 批量添加股票（弹窗粘贴代码） ----------

/** 批量添加：单次最多接受的代码个数（超出在弹窗内拦下，不请求上游） */
export const BATCH_ADD_MAX_COUNT = 50;

/**
 * 批量添加：代码分隔符 = 中英文逗号 / 顿号 / 分号 / 任意空白（含换行、制表符）
 *
 * 中文输入法下用户几乎必然打出全角逗号「，」或顿号「、」；从表格 / 网页复制的
 * 代码列则常按换行或制表符分隔 —— 一并当分隔符，用户不必回头手改标点。
 */
export const BATCH_ADD_SPLITTER = /[,，、;；\s]+/;

/** 批量添加：单个代码查不到的浮窗文案模板（`{code}` 替换为用户原始输入） */
export const BATCH_ADD_MISSING_TEMPLATE = '查询不到 {code} 股票';

/** 批量添加：多个代码查不到时合并成一条的浮窗文案模板（`{count}` / `{codes}`） */
export const BATCH_ADD_MISSING_MULTI_TEMPLATE = '查询不到 {count} 只股票：{codes}';

/** 批量添加：合并提示时最多列出几个代码（其余以「等」省略） */
export const BATCH_ADD_MISSING_DETAIL_MAX = 3;

/** 批量添加：入库成功后的浮窗文案模板（`{count}` / `{group}`） */
export const BATCH_ADD_SUCCESS_TEMPLATE = '已添加 {count} 只股票到「{group}」';

/** 批量添加：一个都没入库（全在当前分组里）时的浮窗文案模板（`{count}` / `{group}`） */
export const BATCH_ADD_EXISTS_TEMPLATE = '{count} 只股票已在「{group}」中';

/** 批量添加：有代码已在当前分组被跳过时的浮窗补充说明模板（`{skipped}`） */
export const BATCH_ADD_SKIPPED_TEMPLATE = '{skipped} 只已在当前分组，已跳过';

/** 批量添加：校验请求失败时弹窗内的提示文案（不关弹窗，用户可重试） */
export const BATCH_ADD_FAILED_TEXT = '查询失败，请稍后重试';

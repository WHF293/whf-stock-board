/**
 * 自选盯盘插件 · 私有常量
 *
 * 插件自成一体：只在本插件内使用的魔法值随插件目录，跨插件复用才上提到 `src/constants/`
 */

/** 加载中的骨架行数 */
export const SIDEBAR_WATCH_SKELETON_ROWS = 4;

/** 空态引导文案（说清候选从哪来，避免用户以为面板坏了） */
export const SIDEBAR_WATCH_EMPTY_HINT = '在自选股「操作」列点一下「盯盘」，这只票就会盯在这里';

/** 行操作 id（内核会拼成 `dsh-sidebar-watch#<id>` 全局键） */
export const STOCK_ROW_ACTION_ID = 'watch-toggle';

/** 行操作文案（未加入候选时） */
export const STOCK_ROW_ACTION_TITLE = '盯盘';

/** 行操作文案（已在候选池里） */
export const STOCK_ROW_ACTION_ACTIVE_TITLE = '取消盯盘';

/** 行操作图标（MenuIcon key：眼睛 = 盯盘） */
export const STOCK_ROW_ACTION_ICON = 'eye';

// ---------- 阈值提醒 ----------

/** 阈值类型 */
export const WATCH_ALERT_KIND = {
  /** 未设阈值 */
  NONE: '',
  /** 按价格设阈值（元） */
  PRICE: 'price',
  /** 按涨跌幅设阈值（%） */
  CHANGE: 'change',
} as const satisfies Record<string, string>;

/** 阈值比较方向 */
export const WATCH_ALERT_DIRECTION = {
  /** 涨到 / 达到或超过 */
  ABOVE: 'above',
  /** 跌到 / 达到或低于 */
  BELOW: 'below',
} as const satisfies Record<string, string>;

/** 阈值类型下拉选项文案 */
export const WATCH_ALERT_KIND_LABEL: Record<string, string> = {
  [WATCH_ALERT_KIND.NONE]: '不提醒',
  [WATCH_ALERT_KIND.PRICE]: '价格',
  [WATCH_ALERT_KIND.CHANGE]: '涨跌幅',
};

/** 比较方向下拉选项文案（价格态） */
export const WATCH_ALERT_DIRECTION_PRICE_LABEL: Record<string, string> = {
  [WATCH_ALERT_DIRECTION.ABOVE]: '涨到',
  [WATCH_ALERT_DIRECTION.BELOW]: '跌到',
};

/** 比较方向下拉选项文案（涨跌幅态） */
export const WATCH_ALERT_DIRECTION_CHANGE_LABEL: Record<string, string> = {
  [WATCH_ALERT_DIRECTION.ABOVE]: '涨幅达到',
  [WATCH_ALERT_DIRECTION.BELOW]: '跌幅达到',
};

/**
 * 价格阈值「重新武装」的相对回差
 *
 * 触发一次后不再重复提醒，直到价格回到阈值内侧并**多走这么多**才重新武装。
 * 没有回差的话，价格在阈值上下抖动会触发刷屏（真实盯盘里最常见的抱怨）。
 */
export const WATCH_ALERT_REARM_PRICE_RATIO = 0.001;

/** 涨跌幅阈值「重新武装」的绝对回差（百分点） */
export const WATCH_ALERT_REARM_CHANGE_MARGIN = 0.1;

/** 阈值编辑器标题 */
export const WATCH_ALERT_EDITOR_TITLE = '阈值提醒';

/** 阈值编辑器说明文案 */
export const WATCH_ALERT_EDITOR_HINT = '到价后右下角弹提醒；触发过一次，等回到阈值内侧再重新生效';

/** 未设阈值时行内按钮的提示文案 */
export const WATCH_ALERT_BUTTON_TITLE = '设阈值提醒';

/** 已设阈值时行内按钮的提示文案 */
export const WATCH_ALERT_BUTTON_ACTIVE_TITLE = '调整阈值提醒';

/** 阈值输入框占位文案（价格态） */
export const WATCH_ALERT_INPUT_PLACEHOLDER_PRICE = '如 1700.00';

/** 阈值输入框占位文案（涨跌幅态） */
export const WATCH_ALERT_INPUT_PLACEHOLDER_CHANGE = '如 5.00';

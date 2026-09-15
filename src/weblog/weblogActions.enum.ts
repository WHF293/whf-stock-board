/**
 * 埋点动作表（全站唯一事实源）
 *
 * 对外导出：
 * - `WEBLOG_ACTIONS`：埋点对象，键即落库的 `action_log.action`；
 * - `WEBLOG_CATEGORY_LABEL`：分类中文名；
 * - `WEBLOG_PAGE_ACTION_BY_PATH`：路由 path → 页面埋点 key（页面显示自动埋点用）；
 * - `resolveActionDef()` / `resolveActionLabel()`：key → 定义 / 文案。
 *
 * 覆盖范围（新增页面 / 按钮时按需往这里加）：
 * - `page`     页面显示（每个路由一个，含详情页与独立窗口）
 * - `navbar`   顶部栏与侧栏按钮、全局快捷键
 * - `api`      接口请求（由 api/proxy-fetch.ts 统一上报）
 * - `business` 业务操作（开个股、自选、导入导出、选股、图表配置…）
 * - `system`   系统事件（启动、日志自身的增删查、过期裁剪）
 *
 * 为什么不用 enum：项目硬性规范（ESLint 卡 TSEnumDeclaration），
 * const 对象 + `as const satisfies` 才能同时拿到字面量类型与结构校验。
 */
import { ROUTE_PATH } from '../constants/router-meta.constants';
import type { WeblogActionDef, WeblogCategory } from '../types/weblog.types';

/** 分类中文名（表格「分类」列与筛选项共用） */
export const WEBLOG_CATEGORY_LABEL: Record<WeblogCategory, string> = {
  page: '页面显示',
  navbar: '导航按钮',
  api: '接口请求',
  business: '业务操作',
  system: '系统事件',
};

/**
 * 埋点对象：key = 动作标识（SCREAMING_SNAKE），value = { category, label }
 *
 * ⚠️ 键名一旦发布不要改名（历史日志会失去可读文案），新增一律往后追加。
 */
export const WEBLOG_ACTIONS = {
  // ---------- 页面显示（每个路由一个；路由清单见 constants/router-meta.constants.ts） ----------
  PAGE_DASHBOARD: { category: 'page', label: '进入市场总览' },
  PAGE_MARKET_RANK: { category: 'page', label: '进入市场榜单' },
  PAGE_PANORAMA: { category: 'page', label: '进入行情全景' },
  PAGE_BOARD_CALENDAR: { category: 'page', label: '进入板块日历' },
  PAGE_MARKET_MOOD: { category: 'page', label: '进入市场异动' },
  PAGE_WATCHLIST: { category: 'page', label: '进入自选股' },
  PAGE_SCREENER: { category: 'page', label: '进入选股器' },
  PAGE_HOT_NEWS: { category: 'page', label: '进入热点新闻' },
  PAGE_STOCK_ACCOUNT: { category: 'page', label: '进入账户管理' },
  PAGE_SYSTEM_LOG: { category: 'page', label: '进入系统日志' },
  PAGE_STOCK_DETAIL: { category: 'page', label: '进入股票详情' },
  PAGE_AGENT_WINDOW: { category: 'page', label: '进入 Agent 分析' },
  PAGE_SETTINGS: { category: 'page', label: '打开设置' },
  /** 兜底：路由表里没登记的新页面（含 404 兜底跳转） */
  PAGE_OTHER: { category: 'page', label: '进入其他页面' },

  // ---------- 顶部栏 / 侧栏 / 快捷键 ----------
  NAV_MENU_CLICK: { category: 'navbar', label: '点击侧栏菜单' },
  NAV_SIDEBAR_TOGGLE: { category: 'navbar', label: '收起/展开侧栏' },
  NAV_THEME_TOGGLE: { category: 'navbar', label: '切换明暗模式' },
  NAV_SEARCH_OPEN: { category: 'navbar', label: '打开标的搜索' },
  NAV_AGENT_OPEN: { category: 'navbar', label: '打开 Agent 分析' },
  NAV_SETTINGS_OPEN: { category: 'navbar', label: '打开设置抽屉' },
  NAV_SYSTEM_LOG_OPEN: { category: 'navbar', label: '打开系统日志页' },
  NAV_SHORTCUT: { category: 'navbar', label: '使用全局快捷键' },

  // ---------- 接口请求 ----------
  API_REQUEST: { category: 'api', label: '接口请求' },

  // ---------- 业务操作 ----------
  STOCK_OPEN_SIDEBAR: { category: 'business', label: '打开个股详情侧栏' },
  STOCK_OPEN_PAGE: { category: 'business', label: '打开个股详情整页' },
  WATCHLIST_ADD: { category: 'business', label: '添加自选股' },
  WATCHLIST_REMOVE: { category: 'business', label: '移除自选股' },
  NEWS_SAVE: { category: 'business', label: '保存新闻' },
  ACCOUNT_IMPORT: { category: 'business', label: '导入对账单/交割单' },
  ACCOUNT_EXPORT: { category: 'business', label: '导出表格' },
  BOARD_CALENDAR_SYNC: { category: 'business', label: '板块日历采集' },
  SCREENER_RUN: { category: 'business', label: '执行选股筛选' },
  SCREENER_SIGNAL_SCAN: { category: 'business', label: '信号扫描' },
  SCREENER_TAIL_PICK: { category: 'business', label: '尾盘选股' },
  AGENT_SEND: { category: 'business', label: '发送 Agent 对话' },
  CHART_INDICATOR_CONFIG: { category: 'business', label: '图表指标配置' },
  POLLING_TOGGLE: { category: 'business', label: '轮询总开关' },
  REFRESH_INTERVAL_CHANGE: { category: 'business', label: '刷新间隔变更' },
  THEME_COLOR_CHANGE: { category: 'business', label: '主题色变更' },
  TREND_THEME_CHANGE: { category: 'business', label: '涨跌配色变更' },
  WATERMARK_TOGGLE: { category: 'business', label: '水印开关' },
  MENU_ORDER_EDIT: { category: 'business', label: '侧栏顺序编排' },
  SDK_CACHE_CLEAR: { category: 'business', label: '清空 SDK 缓存' },
  PROXY_PROBE: { category: 'business', label: '代理自检' },
  CHECK_UPDATE: { category: 'business', label: '检查更新' },
  SHORTCUTS_VIEW: { category: 'business', label: '查看快捷键说明' },
  REPO_OPEN: { category: 'business', label: '打开 GitHub 仓库' },

  // ---------- 系统事件 ----------
  APP_START: { category: 'system', label: '应用启动' },
  LOG_ENABLED_TOGGLE: { category: 'system', label: '日志采集开关' },
  LOG_TAB_SWITCH: { category: 'system', label: '切换日志页签' },
  LOG_FILTER: { category: 'system', label: '日志筛选条件变更' },
  LOG_REFRESH: { category: 'system', label: '刷新日志' },
  LOG_EXPORT: { category: 'system', label: '导出日志' },
  LOG_CLEAR: { category: 'system', label: '清空日志' },
  LOG_PRUNE: { category: 'system', label: '清理过期日志' },

  /**
   * 点击兜底：未标注 data-track 的可交互元素被点击时记录，
   * 保证「用户全部操作」不丢（文案里带元素摘要）
   */
  CLICK_ELEMENT: { category: 'business', label: '点击元素' },
} as const satisfies Record<string, Omit<WeblogActionDef, 'key'>>;

/** 埋点动作 key 联合类型（= WEBLOG_ACTIONS 的键） */
export type WeblogActionKey = keyof typeof WEBLOG_ACTIONS;

/** 路由 path → 页面显示埋点 key（未登记的 path 落 PAGE_OTHER） */
export const WEBLOG_PAGE_ACTION_BY_PATH: Record<string, WeblogActionKey> = {
  [ROUTE_PATH.DASHBOARD]: 'PAGE_DASHBOARD',
  [ROUTE_PATH.MARKET_RANK]: 'PAGE_MARKET_RANK',
  [ROUTE_PATH.PANORAMA]: 'PAGE_PANORAMA',
  [ROUTE_PATH.BOARD_CALENDAR]: 'PAGE_BOARD_CALENDAR',
  [ROUTE_PATH.MARKET_MOOD]: 'PAGE_MARKET_MOOD',
  [ROUTE_PATH.WATCHLIST]: 'PAGE_WATCHLIST',
  [ROUTE_PATH.SCREENER]: 'PAGE_SCREENER',
  [ROUTE_PATH.HOT_NEWS]: 'PAGE_HOT_NEWS',
  [ROUTE_PATH.STOCK_ACCOUNT]: 'PAGE_STOCK_ACCOUNT',
  [ROUTE_PATH.SYSTEM_LOG]: 'PAGE_SYSTEM_LOG',
  [ROUTE_PATH.STOCK_DETAIL]: 'PAGE_STOCK_DETAIL',
  [ROUTE_PATH.AGENT_WINDOW]: 'PAGE_AGENT_WINDOW',
  [ROUTE_PATH.SETTINGS]: 'PAGE_SETTINGS',
};

/**
 * 判断字符串是否为已登记的埋点 key
 * @param key 待校验的 key（如 data-track 属性值）
 * @returns 是否为合法埋点 key
 */
export const isWeblogActionKey = (key: string): key is WeblogActionKey => key in WEBLOG_ACTIONS;

/**
 * 埋点 key → 完整动作定义（补上 key 本身）
 * @param key 埋点 key（未知 key 返回 null）
 * @returns 动作定义（含 key / category / label）
 */
export const resolveActionDef = (key: string): WeblogActionDef | null => {
  if (!isWeblogActionKey(key)) return null;
  const def = WEBLOG_ACTIONS[key];
  return { key, category: def.category, label: def.label };
};

/**
 * 埋点 key → 中文文案（未知 key 原样返回，保证历史日志仍可读）
 * @param key 埋点 key
 * @returns 展示文案
 */
export const resolveActionLabel = (key: string): string =>
  isWeblogActionKey(key) ? WEBLOG_ACTIONS[key].label : key;

/**
 * 路由 path → 页面显示埋点 key（详情页等带参数的 path 按前缀匹配）
 * @param path 当前路由 path（如 /stock-detail/sh600519）
 * @returns 页面埋点 key
 */
export const resolvePageActionKey = (path: string): WeblogActionKey => {
  const exact = WEBLOG_PAGE_ACTION_BY_PATH[path];
  if (exact) return exact;
  const prefix = Object.keys(WEBLOG_PAGE_ACTION_BY_PATH).find((key) =>
    path.startsWith(`${key}/`),
  );
  return prefix ? WEBLOG_PAGE_ACTION_BY_PATH[prefix] : 'PAGE_OTHER';
};

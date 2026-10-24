/**
 * 个股 F10 抽屉常量（数据源：东方财富 emh5.eastmoney.com 的 F10 服务端直出页）
 *
 * 上游没有 XHR 接口，四个信息页签（基本资料 / 发行相关 / 高管简介 / 参股控股）
 * 各自是一个静态 HTML 页（fc 参数带标的），前端经代理拉取后 DOMParser 解析；
 * 财务 / 资讯 / 基金概况复用详情页已有组件
 */

/** F10 页面地址模板（`{page}` 为页面段、`{fc}` 为完整符号小写形态，如 sh600000） */
export const F10_PAGE_URL_TEMPLATE = 'https://emh5.eastmoney.com/F10/v/{page}?fc={fc}&color=b&isShow=y';

/** F10 页面会话缓存 TTL（毫秒）：F10 数据以季 / 年为粒度变化，缓存 30 分钟足够 */
export const F10_CACHE_TTL_MS = 30 * 60 * 1000;

/** F10 抽屉顶部来源公告条文案（东财 F10 解析类页签通用） */
export const F10_SOURCE_NOTICE_TEXT =
  '页面来源：东方财富 F10（emh5.eastmoney.com）· 本应用解析展示，数据口径以原页面为准';

/**
 * 各页签的数据来源说明（NoticeBar 渲染在页签行下方，随页签切换；
 * 2026-10-24 王总指定：不同页签数据来源不同，标注不应常驻顶部）
 */
export const F10_TAB_SOURCE_NOTICES: Readonly<Record<StockF10Tab, string>> = {
  trade: '数据来源：账户成交流水（本机数据库）· 后续将切换为同花顺投资账本（MCP）',
  etf: '数据来源：东方财富 · 基金定期报告披露的持仓明细',
  financial: '数据来源：东方财富 · 上市公司财报',
  fund: '数据来源：东方财富 · 基金概况',
  news: '数据来源：东方财富 · 公告与个股资讯',
  baseInfo: F10_SOURCE_NOTICE_TEXT,
  publish: F10_SOURCE_NOTICE_TEXT,
  executive: F10_SOURCE_NOTICE_TEXT,
  hold: F10_SOURCE_NOTICE_TEXT,
};

/**
 * F10（更多信息）抽屉页签值
 *
 * 2026-10-24 王总指定：详情页底部的「交易记录 / 成分股」也并入本抽屉
 * （financial / fund 二选一随标的类型切换；成分股仅场内基金渲染）
 */
export type StockF10Tab =
  | 'financial'
  | 'fund'
  | 'news'
  | 'baseInfo'
  | 'publish'
  | 'executive'
  | 'hold'
  | 'trade'
  | 'etf';

/** F10 抽屉页签选项（标签与值；顺序即展示顺序，实际渲染按标的类型裁剪） */
export const STOCK_F10_TAB_OPTIONS: readonly { label: string; value: StockF10Tab }[] = [
  { label: '财务', value: 'financial' },
  { label: '基金概况', value: 'fund' },
  { label: '资讯', value: 'news' },
  { label: '基本资料', value: 'baseInfo' },
  { label: '发行相关', value: 'publish' },
  { label: '高管简介', value: 'executive' },
  { label: '参股控股', value: 'hold' },
  { label: '交易记录', value: 'trade' },
  { label: '成分股', value: 'etf' },
] as const;

/**
 * 普通股票的页签顺序（2026-10-24 王总指定：交易记录在前，其后依次
 * 基本资料 / 资讯 / 财务 / 高管简介 / 发行相关 / 参股控股）
 */
export const STOCK_F10_TAB_ORDER: readonly StockF10Tab[] = [
  'trade',
  'baseInfo',
  'news',
  'financial',
  'executive',
  'publish',
  'hold',
];

/**
 * 场内基金的页签顺序（成分股居次席；基金概况承接财务对应的披露口径，
 * 场内基金无参股控股概念，该页签不渲染）
 */
export const ETF_F10_TAB_ORDER: readonly StockF10Tab[] = [
  'trade',
  'etf',
  'baseInfo',
  'news',
  'fund',
  'executive',
  'publish',
];

/** F10 抽屉页签默认值（交易记录，2026-10-24 王总指定顺序的首位） */
export const STOCK_F10_TAB_DEFAULT: StockF10Tab = 'trade';
export const ETF_F10_TAB_DEFAULT: StockF10Tab = 'trade';

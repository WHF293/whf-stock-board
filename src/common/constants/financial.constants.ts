/**
 * 东方财富 datacenter 财务数据接口常量（Agent 财务工具数据源）
 *
 * 数据来自 datacenter-web.eastmoney.com 的 data/v1/get 报表查询端点，
 * 为非官方契约（字段名以拼音缩写为主，上游可能调整），接入与排障见 SERVER_API.md。
 * 浏览器侧走 /stock-proxy 代理（eastmoney.com 已在代理白名单，后缀匹配），
 * Tauri 侧走 tauri-plugin-http（capabilities 已有 https://*.eastmoney.com/* 通配）。
 */

/** datacenter-web 报表查询端点 */
export const EM_DATACENTER_WEB_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

/** 上游 Referer（东财 datacenter 校验来源页，浏览器侧经代理 ?r= 参数透传） */
export const EM_DATACENTER_REFERER = 'https://data.eastmoney.com/';

/** 上游请求 UA（Tauri 直连时自带；浏览器代理中间件也有兜底 UA） */
export const EM_REQUEST_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 报表名：业绩报表（财务摘要：营收 / 归母净利 / EPS / ROE / 毛利率 / 同比环比） */
export const EM_REPORT_FINANCIAL_SUMMARY = 'RPT_LICO_FN_CPD';

/** 报表名：资产负债表（关键科目：总资产 / 总负债 / 负债率 / 货币资金 / 存货等） */
export const EM_REPORT_BALANCE_SHEET = 'RPT_DMSK_FN_BALANCE';

/** 报表名：现金流量表（经营 / 投资 / 筹资净额、资本开支等） */
export const EM_REPORT_CASH_FLOW = 'RPT_DMSK_FN_CASHFLOW';

/** 报表名：业绩预告（仅已披露的公司有行） */
export const EM_REPORT_PROFIT_FORECAST = 'RPT_PUBLIC_OP_NEWPREDICT';

/** 默认返回的报告期数 */
export const EM_FINANCIAL_DEFAULT_PERIODS = 6;

/** 单次返回的报告期数上限（控制 token，超过由工具层截断） */
export const EM_FINANCIAL_MAX_PERIODS = 12;

/* ---- 财务页签 UI 常量（详情整页「财务」Tab，2026-10-17 需求稿 ui-drafts/2026-10-17-stock-financial-report.html） ---- */

/** 财务摘要 / 资产负债 / 现金流三表展示的报告期数（最近 N 期，列数自适应实际返回） */
export const FINANCIAL_UI_PERIODS = 5;

/** 业绩预告展示条数（公告日倒序取最近 N 条） */
export const FINANCIAL_FORECAST_COUNT = 3;

/** 财务快照缓存有效期（财务数据日级更新，页签触发一次后 6 小时内只读快照） */
export const FINANCIAL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

/** 资产负债率弱色底提示阈值（%），仅视觉提示不构成风险判定；金融行业豁免（见 FINANCIAL_DEBT_EXEMPT_INDUSTRIES） */
export const FINANCIAL_DEBT_RATIO_WARN = 60;

/** 负债率弱色底豁免的行业关键词（券商 / 银行等金融股负债率天然高企，常亮提示反而吵闹） */
export const FINANCIAL_DEBT_EXEMPT_INDUSTRIES: readonly string[] = [
  '证券',
  '银行',
  '保险',
  '信托',
  '多元金融',
];

/** 财务趋势图系列色（营收 / 归母净利；固定色不随涨跌主题变，避免语义色误读，见 chart.constants.ts 同类约定） */
export const FINANCIAL_TREND_SERIES_COLORS = ['#0e9488', '#4f83cc'] as const;

/**
 * 业绩预告类型 → 徽标色调映射（up 红 = 向好 / down 绿 = 转差 / flat 灰 = 中性）
 *
 * 键为上游 PREDICT_TYPE 原文（缺省未列出的类型按 flat 处理）
 */
export const FINANCIAL_FORECAST_TONE: Readonly<Record<string, 'up' | 'down' | 'flat'>> = {
  预增: 'up',
  略增: 'up',
  扭亏: 'up',
  续盈: 'up',
  预减: 'down',
  略减: 'down',
  首亏: 'down',
  续亏: 'down',
  增亏: 'down',
  不确定: 'flat',
} as const;

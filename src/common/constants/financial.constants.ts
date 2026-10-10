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

/**
 * 财务数据接口（东财 datacenter 报表，供 Agent 财务工具消费）
 *
 * 端点与字段口径见 SERVER_API.md；上游为非官方契约（拼音缩写字段），
 * 查询成功但无数据返回空数组，请求失败 / success=false 抛错。
 */
import {
  EM_DATACENTER_REFERER,
  EM_DATACENTER_WEB_URL,
  EM_FINANCIAL_DEFAULT_PERIODS,
  EM_FINANCIAL_MAX_PERIODS,
  EM_REPORT_BALANCE_SHEET,
  EM_REPORT_CASH_FLOW,
  EM_REPORT_FINANCIAL_SUMMARY,
  EM_REPORT_PROFIT_FORECAST,
  EM_REQUEST_USER_AGENT,
} from '../constants/financial.constants';
import type {
  BalanceSheetRow,
  CashFlowRow,
  FinancialSummaryRow,
  ProfitForecastRow,
} from '../types/financial.types';
import { proxyFetch } from './proxy-fetch';

/** datacenter 报表响应骨架（裁剪必要部分） */
interface DatacenterResponse {
  /** 请求是否成功（false 时 message 带原因） */
  success: boolean;
  /** 结果载荷（查询成功但无行时可能为 null） */
  result: { pages: number; data: Record<string, unknown>[] } | null;
  /** 消息（success=false 时的错误原因） */
  message: string;
  /** 业务码（0 = 成功） */
  code: number;
}

/**
 * 从任意形态的股票代码中提取 6 位数字代码（sh600519 / 600519.SH / 600519 → 600519）
 * @param symbol 原始代码
 * @returns 6 位数字代码；提取不到抛错
 */
const extractSixDigitCode = (symbol: string): string => {
  const matched = /(\d{6})/.exec(symbol.trim());
  if (!matched) throw new Error('无法从代码中提取 6 位数字：' + symbol);
  return matched[1];
};

/**
 * 日期字段归一化：上游「2026-06-30 00:00:00」→「2026-06-30」
 * @param raw 原始日期字符串
 * @returns 日期部分；空值转 null
 */
const normalizeDate = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.length < 10) return null;
  return raw.slice(0, 10);
};

/**
 * 数值字段容错读取（null / undefined / 非数字一律转 null）
 * @param value 原始值
 * @returns 数值或 null
 */
const numberOr = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

/**
 * 字符串字段容错读取
 * @param value 原始值
 * @returns 字符串或 null
 */
const stringOr = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * 请求一张 datacenter 报表（按证券代码过滤，报告期倒序）
 *
 * @param reportName 报表名（如 RPT_LICO_FN_CPD）
 * @param sortColumn 报告期排序字段（各报表不同：REPORTDATE / REPORT_DATE / NOTICE_DATE）
 * @param symbol 股票代码（任意形态，内部提取 6 位）
 * @param periods 返回报告期数
 * @returns 报表原始行（可能为空数组 = 该票无此数据）
 */
const fetchReport = async (
  reportName: string,
  sortColumn: string,
  symbol: string,
  periods: number,
): Promise<Record<string, unknown>[]> => {
  const code = extractSixDigitCode(symbol);
  const query = new URLSearchParams({
    reportName,
    columns: 'ALL',
    filter: `(SECURITY_CODE="${code}")`,
    pageSize: String(Math.max(1, Math.min(periods, EM_FINANCIAL_MAX_PERIODS))),
    pageNumber: '1',
    sortColumns: sortColumn,
    sortTypes: '-1',
    source: 'WEB',
    client: 'WEB',
  });
  const response = await proxyFetch(`${EM_DATACENTER_WEB_URL}?${query.toString()}`, {
    headers: {
      Referer: EM_DATACENTER_REFERER,
      'User-Agent': EM_REQUEST_USER_AGENT,
    },
  });
  if (!response.ok) {
    throw new Error('东财财务接口 HTTP ' + String(response.status));
  }
  const body = (await response.json()) as DatacenterResponse;
  if (!body.success) {
    throw new Error('东财财务接口返回失败：' + body.message + '（code=' + String(body.code) + '）');
  }
  return body.result?.data ?? [];
};

/**
 * 归一化报告期数（缺省 6，上限 12）
 * @param periods 调用方传入的期数
 * @returns 归一化后的期数
 */
const clampPeriods = (periods: number | undefined): number =>
  Math.max(1, Math.min(periods ?? EM_FINANCIAL_DEFAULT_PERIODS, EM_FINANCIAL_MAX_PERIODS));

/**
 * 获取财务摘要（业绩报表）：营收 / 归母净利 / 增速 / EPS / ROE / 毛利率，报告期倒序
 * @param symbol 股票代码（600519 / sh600519 / 600519.SH 均可）
 * @param periods 返回最近 N 个报告期（默认 6，最大 12）
 * @returns 财务摘要行（最新在前；无数据为空数组）
 */
export const fetchFinancialSummary = async (
  symbol: string,
  periods?: number,
): Promise<FinancialSummaryRow[]> => {
  const rows = await fetchReport(
    EM_REPORT_FINANCIAL_SUMMARY,
    'REPORTDATE',
    symbol,
    clampPeriods(periods),
  );
  return rows.map((row) => ({
    code: String(row.SECURITY_CODE ?? ''),
    name: String(row.SECURITY_NAME_ABBR ?? ''),
    reportDate: normalizeDate(row.REPORTDATE) ?? '',
    noticeDate: normalizeDate(row.NOTICE_DATE),
    dataType: String(row.DATATYPE ?? ''),
    totalOperateIncome: numberOr(row.TOTAL_OPERATE_INCOME),
    parentNetprofit: numberOr(row.PARENT_NETPROFIT),
    revenueYoY: numberOr(row.YSTZ),
    profitYoY: numberOr(row.SJLTZ),
    revenueQoQ: numberOr(row.YSHZ),
    profitQoQ: numberOr(row.SJLHZ),
    basicEps: numberOr(row.BASIC_EPS),
    deductBasicEps: numberOr(row.DEDUCT_BASIC_EPS),
    bps: numberOr(row.BPS),
    weightedAvgRoe: numberOr(row.WEIGHTAVG_ROE),
    grossMargin: numberOr(row.XSMLL),
    operatingCashFlowPerShare: numberOr(row.MGJYXJJE),
    dividendPlan: stringOr(row.ASSIGNDSCRPT),
    industry: stringOr(row.BOARD_NAME) ?? stringOr(row.PUBLISHNAME),
  }));
};

/**
 * 获取资产负债表关键科目（总资产 / 负债率 / 货币资金 / 存货等），报告期倒序
 * @param symbol 股票代码（任意形态）
 * @param periods 返回最近 N 个报告期（默认 6，最大 12）
 * @returns 资产负债表行（最新在前；无数据为空数组）
 */
export const fetchBalanceSheetDigest = async (
  symbol: string,
  periods?: number,
): Promise<BalanceSheetRow[]> => {
  const rows = await fetchReport(
    EM_REPORT_BALANCE_SHEET,
    'REPORT_DATE',
    symbol,
    clampPeriods(periods),
  );
  return rows.map((row) => ({
    code: String(row.SECURITY_CODE ?? ''),
    name: String(row.SECURITY_NAME_ABBR ?? ''),
    reportDate: normalizeDate(row.REPORT_DATE) ?? '',
    noticeDate: normalizeDate(row.NOTICE_DATE),
    totalAssets: numberOr(row.TOTAL_ASSETS),
    totalLiabilities: numberOr(row.TOTAL_LIABILITIES),
    totalEquity: numberOr(row.TOTAL_EQUITY),
    debtAssetRatio: numberOr(row.DEBT_ASSET_RATIO),
    currentRatio: numberOr(row.CURRENT_RATIO),
    monetaryFunds: numberOr(row.MONETARYFUNDS),
    accountsReceivable: numberOr(row.ACCOUNTS_RECE),
    inventory: numberOr(row.INVENTORY),
    accountsPayable: numberOr(row.ACCOUNTS_PAYABLE),
    fixedAssets: numberOr(row.FIXED_ASSET),
  }));
};

/**
 * 获取现金流量表关键科目（经营 / 投资 / 筹资净额、资本开支），报告期倒序
 * @param symbol 股票代码（任意形态）
 * @param periods 返回最近 N 个报告期（默认 6，最大 12）
 * @returns 现金流量表行（最新在前；无数据为空数组）
 */
export const fetchCashFlowDigest = async (
  symbol: string,
  periods?: number,
): Promise<CashFlowRow[]> => {
  const rows = await fetchReport(
    EM_REPORT_CASH_FLOW,
    'REPORT_DATE',
    symbol,
    clampPeriods(periods),
  );
  return rows.map((row) => ({
    code: String(row.SECURITY_CODE ?? ''),
    name: String(row.SECURITY_NAME_ABBR ?? ''),
    reportDate: normalizeDate(row.REPORT_DATE) ?? '',
    noticeDate: normalizeDate(row.NOTICE_DATE),
    operatingNetCash: numberOr(row.NETCASH_OPERATE),
    cashFromSales: numberOr(row.SALES_SERVICES),
    investingNetCash: numberOr(row.NETCASH_INVEST),
    capitalExpenditure: numberOr(row.CONSTRUCT_LONG_ASSET),
    financingNetCash: numberOr(row.NETCASH_FINANCE),
    netCashIncrease: numberOr(row.CCE_ADD),
  }));
};

/**
 * 获取业绩预告（营收 / 净利的预告区间与同比增幅；仅已披露公司有行，未披露返回空数组）
 * @param symbol 股票代码（任意形态）
 * @param periods 返回最近 N 条预告记录（默认 6，最大 12）
 * @returns 业绩预告行（最新在前；无数据为空数组）
 */
export const fetchProfitForecast = async (
  symbol: string,
  periods?: number,
): Promise<ProfitForecastRow[]> => {
  const rows = await fetchReport(
    EM_REPORT_PROFIT_FORECAST,
    'NOTICE_DATE',
    symbol,
    clampPeriods(periods),
  );
  return rows.map((row) => ({
    code: String(row.SECURITY_CODE ?? ''),
    name: String(row.SECURITY_NAME_ABBR ?? ''),
    reportDate: normalizeDate(row.REPORT_DATE) ?? '',
    noticeDate: normalizeDate(row.NOTICE_DATE),
    metricName: String(row.PREDICT_FINANCE ?? ''),
    amountLower: numberOr(row.PREDICT_AMT_LOWER),
    amountUpper: numberOr(row.PREDICT_AMT_UPPER),
    growthLower: numberOr(row.ADD_AMP_LOWER),
    growthUpper: numberOr(row.ADD_AMP_UPPER),
    predictType: stringOr(row.PREDICT_TYPE),
    content: stringOr(row.PREDICT_CONTENT),
    priorYearSamePeriod: numberOr(row.PREYEAR_SAME_PERIOD),
  }));
};

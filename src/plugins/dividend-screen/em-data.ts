/**
 * 插件 dsh-dividend-screen（股息筛选）· 取数层（东方财富）
 *
 * 三个 fetch 包装，全部走宿主 `proxyFetch`（Tauri 走 Rust 直连 / 浏览器走 /stock-proxy，
 * `eastmoney.com` 已在代理白名单与 Tauri capabilities 内，无需新增配置）。
 *
 * 频率纪律（SERVER_API 红线）：
 * - 全部**串行**、同上游请求之间留间隔（行情域 1s / 数据中心 600ms）；
 * - 东财会直接掐断连接（`fetch failed`，非 HTTP 错误码）→ 原地小步重试是唯一有效兜底；
 * - 只由用户点击「扫描排行」触发，不轮询；结果落库后重进页面不再联网。
 *
 * 请求量估算（样本池 200 / 分块 100）：排行 2 页 + 业绩 3 期 × 2 块 + 分红 2 期 × 2 块 ≈ 12 次。
 */
import { proxyFetch } from '../../api/proxy-fetch';
import { delay } from '../../utils/delay';
import {
  groupDividendEventsByDate,
  parseDebtRows,
  parseDividendEvents,
  parsePerfRows,
  parseRankPage,
} from './em-parse';
import {
  DIVIDEND_RANK_MAX_PAGES,
  DIVIDEND_RANK_PAGE_TOKEN,
  DIVIDEND_RANK_QUERY,
  DIVIDEND_RANK_URL,
  EM_BALANCE_COLUMNS,
  EM_BALANCE_REPORT_DATE_FIELD,
  EM_BALANCE_REPORT_NAME,
  EM_DATACENTER_DELAY_MS,
  EM_DATACENTER_PAGE_SIZE,
  EM_DATACENTER_SUCCESS_FIELD,
  EM_DATACENTER_URL,
  EM_DATA_REFERER,
  EM_DIVIDEND_REPORT_DATE_FIELD,
  EM_DIVIDEND_REPORT_NAME,
  EM_FETCH_ATTEMPTS,
  EM_FETCH_RETRY_DELAY_MS,
  EM_PERF_REPORT_DATE_FIELD,
  EM_PERF_REPORT_NAME,
  EM_QUOTE_REFERER,
  EM_RANK_DELAY_MS,
  EM_SECURITY_CODE_FIELD,
  EM_CODE_CHUNK_SIZE,
  EM_DIVIDEND_COLUMNS,
  EM_PERF_COLUMNS,
} from './constants';
import type { DebtSnapshot, DividendAggregate, PerfRow, RankBaseRow } from './types';

/**
 * 分块一个代码清单（保持顺序）
 * @param codes 代码清单
 * @returns 代码分块
 */
export const chunkCodes = (codes: readonly string[]): string[][] => {
  const chunks: string[][] = [];
  for (let index = 0; index < codes.length; index += EM_CODE_CHUNK_SIZE) {
    chunks.push(codes.slice(index, index + EM_CODE_CHUNK_SIZE));
  }
  return chunks;
};

/**
 * 带原地重试的一次请求（东财掐连接是常态，等一小会重试即恢复）
 * @param url 请求地址
 * @param referer Referer 头
 * @returns 响应文本
 */
const fetchTextWithRetry = async (url: string, referer: string): Promise<string> => {
  let lastError = '未知错误';
  for (let attempt = 0; attempt < EM_FETCH_ATTEMPTS; attempt += 1) {
    if (attempt > 0) await delay(EM_FETCH_RETRY_DELAY_MS);
    try {
      const response = await proxyFetch(url, { headers: { Referer: referer } });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      return await response.text();
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(lastError);
};

/**
 * 拉取股息率排行前 N（clist `fid=f133` 降序，分页串行）
 *
 * 分页防漂移三件套（f133 随现价实时变，行会在页边界搬家）：
 * 按代码去重；收不满 `limit` 且上一页还有数据就继续翻（护栏 `DIVIDEND_RANK_MAX_PAGES`）；
 * 排序只用于**选样本池**，展示口径全部由推算层自算，个别边界股进出不影响数据正确性。
 * @param limit 样本池大小
 * @param onRequest 每完成一个分页请求回调一次（进度条计数）
 * @returns `{ rows, total }`；rows 为前 limit 行（按 TTM 股息率降序），total 为上游全市场行数
 */
export const fetchDividendRank = async (
  limit: number,
  onRequest?: () => void,
): Promise<{ rows: RankBaseRow[]; total: number | null }> => {
  const merged = new Map<string, RankBaseRow>();
  let total: number | null = null;
  for (let page = 1; page <= DIVIDEND_RANK_MAX_PAGES; page += 1) {
    // 频率红线：同上游串行 + 间隔（首页前不等待）
    if (page > 1) await delay(EM_RANK_DELAY_MS);
    const query = DIVIDEND_RANK_QUERY.replace(DIVIDEND_RANK_PAGE_TOKEN, String(page));
    const { rows, total: pageTotal } = parseRankPage(
      await fetchTextWithRetry(`${DIVIDEND_RANK_URL}?${query}`, EM_QUOTE_REFERER),
    );
    onRequest?.();
    if (pageTotal !== null) total = pageTotal;
    for (const row of rows) {
      if (!merged.has(row.code)) merged.set(row.code, row);
    }
    // 收满样本池，或上游给不出更多行（不足一页 = 最后一页）就停
    if (merged.size >= limit || rows.length === 0) break;
  }
  return { rows: [...merged.values()].slice(0, limit), total };
};

/**
 * 组装 datacenter 的查询串（报告期 in 多值 + 代码 in 分块）
 * @param reportName 报表名
 * @param reportDateField 该报表的报告期字段名（三个报表各不相同）
 * @param columns 取用列
 * @param reportDates 报告期清单（`YYYY-MM-DD`；多期合并一次查，省请求数）
 * @param codes 代码分块
 * @returns 完整 URL
 */
const buildDatacenterUrl = (
  reportName: string,
  reportDateField: string,
  columns: string,
  reportDates: readonly string[],
  codes: readonly string[],
): string => {
  const dateList = reportDates.map((date) => `'${date}'`).join(',');
  const codeList = codes.map((code) => `"${code}"`).join(',');
  const filter = `(${reportDateField} in (${dateList}))(${EM_SECURITY_CODE_FIELD} in (${codeList}))`;
  const params = new URLSearchParams({
    sortColumns: EM_SECURITY_CODE_FIELD,
    sortTypes: '1',
    pageSize: String(EM_DATACENTER_PAGE_SIZE),
    pageNumber: '1',
    reportName,
    columns,
    filter,
  });
  return `${EM_DATACENTER_URL}?${params.toString()}`;
};

/**
 * 请求一次 datacenter（校验 success 标记与 result 形态，防「200 但无数据」被当成功）
 * @param reportName 报表名
 * @param reportDateField 该报表的报告期字段名
 * @param columns 取用列
 * @param reportDates 报告期清单
 * @param codes 代码分块
 * @returns 响应文本（已确认 success 且 result.data 为数组）
 */
const fetchDatacenter = async (
  reportName: string,
  reportDateField: string,
  columns: string,
  reportDates: readonly string[],
  codes: readonly string[],
): Promise<string> => {
  const url = buildDatacenterUrl(reportName, reportDateField, columns, reportDates, codes);
  const text = await fetchTextWithRetry(url, EM_DATA_REFERER);
  let payload: { success?: unknown; message?: unknown; result?: { data?: unknown } };
  try {
    payload = JSON.parse(text) as { success?: unknown; message?: unknown; result?: { data?: unknown } };
  } catch {
    throw new Error('数据中心返回了无法解析的内容');
  }
  if (payload[EM_DATACENTER_SUCCESS_FIELD] === false) {
    const message = typeof payload.message === 'string' ? `：${payload.message}` : '';
    throw new Error(`数据中心拒绝本次查询（${reportName} @ ${reportDates.join(',')}）${message}`);
  }
  // result.data 缺失（null / undefined）且 success 非 false 时按「空结果」处理：
  // 未披露的报告期 / 无分红记录的代码集合都是合法的空，不当错误
  if (payload.result?.data !== undefined && !Array.isArray(payload.result.data)) {
    throw new Error('数据中心返回结构异常（result.data 非数组）');
  }
  return text;
};

/**
 * 拉取一批代码在指定报告期的业绩（分块串行）
 * @param codes 6 位裸代码清单
 * @param reportDate 报告期（如 `2026-06-30`）
 * @param onRequest 每完成一个分块请求回调一次
 * @returns 代码 → 业绩行（缺席 = 该股该期未披露）
 */
export const fetchPerfByCodes = async (
  codes: readonly string[],
  reportDate: string,
  onRequest?: () => void,
): Promise<Map<string, PerfRow>> => {
  const merged = new Map<string, PerfRow>();
  for (const chunk of chunkCodes(codes)) {
    if (merged.size > 0) await delay(EM_DATACENTER_DELAY_MS);
    const text = await fetchDatacenter(
      EM_PERF_REPORT_NAME,
      EM_PERF_REPORT_DATE_FIELD,
      EM_PERF_COLUMNS,
      [reportDate],
      chunk,
    );
    for (const row of parsePerfRows(text)) merged.set(row.code, row);
    onRequest?.();
  }
  return merged;
};

/**
 * 拉取一批代码在多个报告期的分红（分块串行，多期合并一次查询按期分组）
 *
 * 5 年分红史 + 去年年度 + 今年中期合并成一个 `in` 过滤，**每分块只发 1 次请求**
 * ——连续分红年数这个规则指标是零额外请求拿到的。
 * @param codes 6 位裸代码清单
 * @param reportDates 报告期清单（如 `['2025-12-31','2026-06-30']`）
 * @param onRequest 每完成一个分块请求回调一次
 * @returns 代码 → 报告期 → 分红聚合（缺席 = 该股该期无现金分红方案）
 */
export const fetchDividendsByCodes = async (
  codes: readonly string[],
  reportDates: readonly string[],
  onRequest?: () => void,
): Promise<Map<string, Map<string, DividendAggregate>>> => {
  const merged = new Map<string, Map<string, DividendAggregate>>();
  for (const chunk of chunkCodes(codes)) {
    if (merged.size > 0) await delay(EM_DATACENTER_DELAY_MS);
    const text = await fetchDatacenter(
      EM_DIVIDEND_REPORT_NAME,
      EM_DIVIDEND_REPORT_DATE_FIELD,
      EM_DIVIDEND_COLUMNS,
      reportDates,
      chunk,
    );
    for (const [code, byDate] of groupDividendEventsByDate(parseDividendEvents(text))) {
      const existing = merged.get(code);
      if (existing) {
        for (const [date, aggregate] of byDate) existing.set(date, aggregate);
      } else {
        merged.set(code, byDate);
      }
    }
    onRequest?.();
  }
  return merged;
};

/**
 * 拉取一批代码的最新负债率（分块串行；多个报告期一次查询，逐代码取最新已披露期）
 * @param codes 6 位裸代码清单
 * @param reportDates 候选报告期清单（如今年中报 + 去年年报，覆盖披露进度差）
 * @param onRequest 每完成一个分块请求回调一次
 * @returns 代码 → 负债率快照（缺席 = 两个报告期都未披露资产负债摘要）
 */
export const fetchDebtRatioByCodes = async (
  codes: readonly string[],
  reportDates: readonly string[],
  onRequest?: () => void,
): Promise<Map<string, DebtSnapshot>> => {
  const merged = new Map<string, DebtSnapshot>();
  for (const chunk of chunkCodes(codes)) {
    if (merged.size > 0) await delay(EM_DATACENTER_DELAY_MS);
    const text = await fetchDatacenter(
      EM_BALANCE_REPORT_NAME,
      EM_BALANCE_REPORT_DATE_FIELD,
      EM_BALANCE_COLUMNS,
      reportDates,
      chunk,
    );
    // 上游按代码 + 报告期升序返回 → 后写的覆盖先写的，循环结束即「最新一期」
    for (const row of parseDebtRows(text)) merged.set(row.code, row);
    onRequest?.();
  }
  return merged;
};

import dayjs from 'dayjs';
import {
  TZZB_INDEX_NAME,
  type TzzbAccount,
  type TzzbAccountKind,
  type TzzbAssetChange,
  type TzzbClearedPosition,
  type TzzbDayCalendar,
  type TzzbFundTrade,
  type TzzbHoldingReturn,
  type TzzbMonthCalendar,
  type TzzbPnlSummary,
  type TzzbPositionSummary,
  type TzzbStockTrade,
  type TzzbStockTradePage,
  type TzzbSyncMeta,
  type TzzbYearPoint,
} from '../types/tzzb.types.ts';

/**
 * 投资账本（tzzb）数据出口
 *
 * 传输形态：远程 MCP（Streamable HTTP JSON-RPC），dev/preview 阶段经同源代理
 * `/tzzb-mcp` 转发到上游 endpoint（server/tzzb-mcp-proxy.ts；目标地址来自
 * .env.local 的 VITE_TZZB_MCP_URL，**上游域名不入库**，构建产物只含同源
 * 路径与开关布尔值）。未配置时（他人克隆 / CI）各接口返回空数据，不炸构建。
 *
 * 会话：首次调用做 MCP initialize 握手拿 Mcp-Session-Id，后续复用；
 * 上游判定会话失效（404/400）时自动重新握手并重试一次。
 *
 * ⚠️ 上游 MCP 测试域名一律不写进入库代码（完整域名与
 * 用法见 .ai/项目资源/投资账本MCP同步-开发方案.md；本机配置在 .env.local，gitignore 已覆盖）。
 */

/** 客户端开关：.env.local 配置 VITE_TZZB_MCP_PROXY=1 时走同源代理真调上游 */
export const TZZB_MCP_LIVE: boolean = import.meta.env.VITE_TZZB_MCP_PROXY === '1';

/** MCP 同源代理路径（server/tzzb-mcp-proxy.ts 挂载） */
const MCP_PROXY_PATH = '/tzzb-mcp';

/** 正式环境 MCP endpoint（写死正式域名，换环境只改此处；阶段 2 sidecar 直连用） */
export const TZZB_MCP_ENDPOINT = 'https://tzzb.10jqka.com.cn/mcp';

/* ---------------- MCP Streamable HTTP 客户端 ---------------- */

/** JSON-RPC 递增 id */
let rpcId = 0;

/** MCP 会话 id（initialize 握手下发；undefined = 未握手 / 已失效） */
let mcpSessionId: string | undefined;

/** 握手单飞 promise（并发调用共享一次 initialize） */
let sessionPromise: Promise<string | undefined> | null = null;

/**
 * 解析响应体：兼容 JSON 与 SSE（data: 行）两种形态
 * @param text 响应原文
 * @returns 解析出的 JSON 对象（SSE 取最后一个 data 帧）
 */
const parseRpcBody = (text: string): Record<string, unknown> => {
  if (!text.includes('data:')) return JSON.parse(text) as Record<string, unknown>;
  const frames = text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .filter((line) => line !== '');
  return JSON.parse(frames[frames.length - 1] ?? '{}') as Record<string, unknown>;
};

/**
 * 单次 POST JSON-RPC（自动带会话头）
 * @param payload JSON-RPC 请求或通知体
 * @param needSession 是否附带会话头
 * @returns { json, sessionId }：响应 JSON 与上游下发的会话 id
 */
const postRpc = async (
  payload: Record<string, unknown>,
  needSession: boolean,
): Promise<{ json: Record<string, unknown>; sessionId?: string }> => {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-06-18',
  };
  if (needSession && mcpSessionId) headers['Mcp-Session-Id'] = mcpSessionId;
  const res = await fetch(MCP_PROXY_PATH, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP HTTP ${res.status}：${text.slice(0, 200)}`);
  }
  const json = parseRpcBody(text);
  return { json, sessionId: res.headers.get('mcp-session-id') ?? undefined };
};

/**
 * MCP initialize 握手（单飞；拿到 Mcp-Session-Id 并发送 initialized 通知）
 * @returns 会话 id（上游未下发时为 undefined）
 */
const ensureSession = async (): Promise<string | undefined> => {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    rpcId += 1;
    const { json, sessionId } = await postRpc(
      {
        jsonrpc: '2.0',
        id: rpcId,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'whf-stock-board', version: '1.0.0' },
        },
      },
      false,
    );
    if (json.error) throw new Error(String((json.error as Record<string, unknown>).message ?? 'initialize 失败'));
    mcpSessionId = sessionId;
    // initialized 通知（无 id，不需要响应）
    await postRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, true).catch(() => undefined);
    return mcpSessionId;
  })();
  try {
    return await sessionPromise;
  } finally {
    sessionPromise = null;
  }
};

/**
 * 调用投资账本 MCP 工具并解出业务负载
 *
 * MCP 工具返回 content[{type:'text'}] 文本，内为业务 JSON（与内测采样同构）；
 * 优先取 structuredContent。会话失效（404 / HTTP 400）自动重握手重试一次。
 * @param tool 工具名
 * @param args 工具入参
 * @returns 业务响应对象；未配置代理时返回 undefined
 */
const callTzzbTool = async (tool: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  if (!TZZB_MCP_LIVE) return undefined;
  await ensureSession();
  rpcId += 1;
  const payload = {
    jsonrpc: '2.0',
    id: rpcId,
    method: 'tools/call',
    params: { name: tool, arguments: args },
  };
  let json: Record<string, unknown>;
  try {
    json = (await postRpc(payload, true)).json;
  } catch (error) {
    // 会话失效：重置后重新握手重试一次
    const message = String(error);
    if (!message.includes('MCP HTTP 404') && !message.includes('MCP HTTP 400')) throw error;
    mcpSessionId = undefined;
    await ensureSession();
    rpcId += 1;
    json = (await postRpc({ ...payload, id: rpcId }, true)).json;
  }
  if (json.error) {
    throw new Error(String((json.error as Record<string, unknown>).message ?? 'MCP 调用失败'));
  }
  const result = json.result as
    | {
        structuredContent?: unknown;
        content?: { type?: string; text?: string }[];
        isError?: boolean;
      }
    | undefined;
  if (!result) return undefined;
  if (result.isError) {
    const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
    throw new Error(`工具 ${tool} 返回错误：${text.slice(0, 200)}`);
  }
  if (result.structuredContent) return result.structuredContent;
  const text = result.content?.find((c) => c.type === 'text')?.text ?? '';
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

/* ---------------- 账户（promptAccountSelection 派生，全模块共享） ---------------- */

/** 账户键集合（逗号分隔多账号；与内测采样请求同构） */
interface TzzbKeys {
  fundKey: string;
  rzrqFundKey: string;
  manualId: string;
  fundId: string;
  custId: string;
}

/** promptAccountSelection 分组响应形态 */
type TzzbAccountRaw = Record<string, { id: string; name: string }[]>;

/** promptAccountSelection 原始响应缓存（账户列表与键共用一次拉取） */
let accountRawCache: TzzbAccountRaw | null = null;

/** 拉取单飞 */
let accountPromise: Promise<TzzbAccountRaw | null> | null = null;

/**
 * 确保账户原始分组可用（首次调 promptAccountSelection）
 * @returns 分组响应；未配置代理时返回 null
 */
const ensureAccountRaw = async (): Promise<TzzbAccountRaw | null> => {
  if (accountRawCache) return accountRawCache;
  if (!accountPromise) {
    accountPromise = callTzzbTool('promptAccountSelection', { scope: 'all' }).then((r) => {
      accountRawCache = (r as TzzbAccountRaw | undefined) ?? null;
      return accountRawCache;
    });
  }
  try {
    return await accountPromise;
  } finally {
    accountPromise = null;
  }
};

/**
 * 从账户分组派生键集合（逗号分隔多账号）
 * @param r 分组响应
 * @returns 股票三键 + 基金两键
 */
const deriveKeys = (r: Record<string, { id: string; name: string }[]>): TzzbKeys => {
  const ids = (key: string): string =>
    ((r[key] as { id: string }[] | undefined) ?? []).map((a) => String(a.id)).join(',');
  return {
    fundKey: ids('fund_key'),
    rzrqFundKey: ids('rzrq_fund_key'),
    manualId: ids('manual_id'),
    fundId: ids('fund_id'),
    custId: String((r['cust_id'] as { id: string }[] | undefined)?.[0]?.id ?? ''),
  };
};

/**
 * 确保账户键可用
 * @returns 账户键集合；未配置代理时返回 null
 */
const ensureKeys = async (): Promise<TzzbKeys | null> => {
  const raw = await ensureAccountRaw();
  return raw ? deriveKeys(raw) : null;
};

/**
 * 股票侧三键入参（fundKey / rzrqFundKey / manualId）
 * @param keys 账户键集合
 * @returns 三键入参对象
 */
const stockKeyArgs = (keys: TzzbKeys): Record<string, unknown> => ({
  fundKey: keys.fundKey,
  rzrqFundKey: keys.rzrqFundKey,
  manualId: keys.manualId,
});

/**
 * 股票三键 + 基金两键全量入参（全量参数工具）
 * @param keys 账户键集合
 * @returns 五键入参对象
 */
const fullKeyArgs = (keys: TzzbKeys): Record<string, unknown> => ({
  ...stockKeyArgs(keys),
  fundId: keys.fundId,
  custId: keys.custId,
});

/* ---------------- 解析工具 ---------------- */

/**
 * 宽松数值解析：字符串数字 / 科学计数法（"3E+4"）/ null / 空串一律安全转数值
 * @param v 原始值
 * @returns 数值（解析失败返回 0）
 */
const num = (v: unknown): number => {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
};

/**
 * columns + rows 矩阵 → 对象数组（queryFund* 系工具的返回形态）
 * @param raw 矩阵原值
 * @returns 行对象数组（结构不符返回空数组）
 */
const matrixRows = (raw: unknown): Record<string, unknown>[] => {
  const m = raw as { columns?: string[]; rows?: unknown[][] } | null;
  if (!m?.columns || !Array.isArray(m.rows)) return [];
  return m.rows.map((row) => Object.fromEntries(m.columns!.map((c, i) => [c, row[i]])));
};

/**
 * profit_loss_list（columns+rows）统一解出日期 / 盈亏 / 收益率
 * @param raw profit_loss_list 原值
 * @returns 逐期点数组
 */
const parseProfitLossRows = (raw: unknown): { date: string; profit: number; rate: number }[] =>
  matrixRows(raw).map((row) => ({
    date: String(row['date'] ?? ''),
    profit: num(row['profit_loss']),
    rate: num(row['profit_loss_rate']),
  }));

/**
 * total_index → 指数涨跌列表
 * @param raw total_index 原值（代码 → 小数涨跌幅）
 * @returns 指数涨跌数组（展示名映射见 TZZB_INDEX_NAME）
 */
const parseIndexes = (raw: unknown): { name: string; rate: number }[] =>
  Object.entries((raw as Record<string, number> | null) ?? {}).map(([code, rate]) => ({
    name: TZZB_INDEX_NAME[code] ?? code,
    rate: num(rate),
  }));

/**
 * 清仓日有效性判断
 * @param v closeDate 原值
 * @returns yyyy-MM-dd 日期；空串 / 「持有中」/ 非日期返回 null
 */
const parseCloseDate = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};

/* ---------------- 接口 ---------------- */

/**
 * 区间 → 起止日期（yyyyMMdd；'all' 以同步水位 2025-09-30 为起点）
 * @param range TZZB_RANGE_OPTIONS value
 * @returns [startDate, endDate]
 */
const rangeDates = (range: string): [string, string] => {
  const today = dayjs();
  const start =
    range === 'm1'
      ? today.startOf('month')
      : range === 'm3'
        ? today.subtract(3, 'month')
        : range === 'm6'
          ? today.subtract(6, 'month')
          : range === 'y1'
            ? today.subtract(1, 'year')
            : range === 'ytd'
              ? today.startOf('year')
              : range === 'all'
                ? dayjs('2025-09-30')
                : today.startOf('month');
  return [start.format('YYYYMMDD'), today.format('YYYYMMDD')];
};

/**
 * 账户列表（promptAccountSelection 分组映射；正式接入后由 tzzb_accounts
 * status=selected 过滤））
 * @returns 账户列表（股票类在前、基金类在后）
 */
export const getTzzbAccounts = async (): Promise<TzzbAccount[]> => {
  const r = await ensureAccountRaw();
  if (!r) return [];
  const group = (key: string, kind: TzzbAccountKind): TzzbAccount[] =>
    (r[key] ?? []).map((a) => ({
      id: String(a.id),
      name: String(a.name),
      kind,
    }));
  return [
    ...group('fund_key', 'stock'),
    ...group('rzrq_fund_key', 'rzrq'),
    ...group('manual_id', 'manual'),
    ...group('fund_id', 'fund'),
  ];
};

/**
 * 资产曲线汇总（queryPnlSummary：净值 / 指数 / 区间总盈亏）
 * @param range 区间（TZZB_RANGE_OPTIONS value，映射为 startDate/endDate）
 * @returns 汇总对象；未配置代理 / 调用失败时返回 null
 */
export const getTzzbPnlSummary = async (range = 'm1'): Promise<TzzbPnlSummary | null> => {
  const keys = await ensureKeys();
  if (!keys) return null;
  const [startDate, endDate] = rangeDates(range);
  const r = (await callTzzbTool('queryPnlSummary', {
    startDate,
    endDate,
    ...fullKeyArgs(keys),
  })) as Record<string, unknown> | undefined;
  if (!r) return null;
  const assetTrend = ((r['netValueTrend'] as Record<string, unknown>[] | undefined) ?? []).map(
    (p) => ({
      date: String(p['time'] ?? ''),
      totalAsset: num(p['totalAsset']),
      dailyProfit: num(p['dailyProfitLoss']),
      navIndex: num(p['netValueIndex']),
      positionRatio: num(p['positionRatio']),
    }),
  );
  const indexTrend = ((r['shIndexTrend'] as Record<string, unknown>[] | undefined) ?? []).map(
    (p) => ({
      date: String(p['time'] ?? ''),
      sh: num(p['shIndex']),
      hs300: num(p['hs300']),
    }),
  );
  return {
    totalProfit: num(r['totalProfitLoss']),
    totalRate: num(r['totalReturnRate']),
    assetTrend,
    indexTrend,
  };
};

/**
 * 持仓汇总（queryStockPosition 顶层：总资产 / 市值 / 可用资金 / 仓位）
 * @returns 汇总对象；未配置代理 / 调用失败时返回 null
 */
export const getTzzbPositionSummary = async (): Promise<TzzbPositionSummary | null> => {
  const keys = await ensureKeys();
  if (!keys) return null;
  const r = (await callTzzbTool('queryStockPosition', stockKeyArgs(keys))) as
    | Record<string, unknown>
    | undefined;
  if (!r) return null;
  return {
    totalAsset: num(r['totalAsset']),
    marketValue: num(r['totalMarketValue']),
    availableFunds: num(r['availableFunds']),
    positionRatio: num(r['positionRatio']),
  };
};

/**
 * 区间资金变动（queryAssetChangeSummary；无数据侧为 null）
 * @param range 区间（TZZB_RANGE_OPTIONS value；默认本月，与指标行口径一致）
 * @returns 股票 / 基金两侧变动；未配置代理 / 调用失败时返回 null
 */
export const getTzzbAssetChange = async (range = 'm1'): Promise<TzzbAssetChange | null> => {
  const keys = await ensureKeys();
  if (!keys) return null;
  const [startDate, endDate] = rangeDates(range);
  const r = (await callTzzbTool('queryAssetChangeSummary', {
    startDate,
    endDate,
    ...fullKeyArgs(keys),
  })) as Record<string, unknown> | undefined;
  if (!r) return null;
  const side = (key: string) => {
    const s = r[key] as Record<string, unknown> | null | undefined;
    if (!s) return null;
    return {
      startAsset: num(s['start_asset']),
      transferIn: num(s['money_in']),
      transferOut: num(s['money_out']),
      dividend: num(s['bonus']),
      profit: num(s['profit']),
      endAsset: num(s['end_asset']),
    };
  };
  return { stock: side('stock'), fund: side('fund') };
};

/**
 * 盈亏日历 · 月视图（queryDayCalendarSummary；区间须覆盖整月）
 * @param month 月份 yyyyMM
 * @returns 月视图数据；未配置代理 / 调用失败时返回 null
 */
export const getTzzbDayCalendar = async (month: string): Promise<TzzbDayCalendar | null> => {
  const keys = await ensureKeys();
  if (!keys) return null;
  const first = dayjs(`${month.slice(0, 4)}-${month.slice(4, 6)}-01`);
  const r = (await callTzzbTool('queryDayCalendarSummary', {
    startDate: first.format('YYYYMMDD'),
    endDate: first.endOf('month').format('YYYYMMDD'),
    ...fullKeyArgs(keys),
  })) as Record<string, unknown> | undefined;
  if (!r) return null;
  const pm = (r['profit_map'] as Record<string, unknown> | null) ?? {};
  return {
    month,
    days: parseProfitLossRows(r['profit_loss_list']),
    summary: {
      stockProfit: num(pm['stock_profit']),
      fundProfit: num(pm['fund_profit']),
      total: num(pm['profit_loss']),
      rate: num(pm['profit_loss_rate']),
    },
    indexes: parseIndexes(r['total_index']),
  };
};

/**
 * 盈亏日历 · 年视图（queryMonthCalendarSummary 按年查询）
 * @param year 年份 yyyy
 * @returns 12 个月点数据；未配置代理 / 调用失败时返回 null
 */
export const getTzzbMonthCalendar = async (year: string): Promise<TzzbMonthCalendar | null> => {
  const keys = await ensureKeys();
  if (!keys) return null;
  const r = (await callTzzbTool('queryMonthCalendarSummary', {
    year,
    ...fullKeyArgs(keys),
  })) as Record<string, unknown> | undefined;
  if (!r) return null;
  return {
    year,
    months: parseProfitLossRows(r['profit_loss_list']).map((row) => ({
      month: row.date,
      profit: row.profit,
      rate: row.rate,
    })),
  };
};

/**
 * 年度聚合点（年历格；queryMonthCalendarSummary 逐年拉取后前端聚合）
 * @param years 年份列表
 * @returns 有数据年份的聚合点（profit 合计 / rate 小数累加近似）
 */
export const getTzzbYearPoints = async (years: string[]): Promise<TzzbYearPoint[]> => {
  const points = await Promise.all(
    years.map(async (year) => {
      const cal = await getTzzbMonthCalendar(year);
      if (!cal || cal.months.length === 0) return null;
      const profit = cal.months.reduce((sum, m) => sum + m.profit, 0);
      const rate = cal.months.reduce((sum, m) => sum + m.rate, 0);
      return { year, profit, rate };
    }),
  );
  return points.filter((p): p is TzzbYearPoint => p !== null);
};

/**
 * 建清仓记录（queryClearedPosition；closeDate 空 = 持有中）
 * @returns 清仓记录列表；未配置代理 / 调用失败时返回空数组
 */
export const getTzzbClearedPositions = async (): Promise<TzzbClearedPosition[]> => {
  const keys = await ensureKeys();
  if (!keys) return [];
  const r = (await callTzzbTool('queryClearedPosition', {
    openDate: '2025-09-30',
    closeDate: dayjs().format('YYYY-MM-DD'),
    groupBy: 'stock',
    ...stockKeyArgs(keys),
  })) as Record<string, unknown> | undefined;
  if (!r) return [];
  return ((r['list'] as Record<string, unknown>[] | undefined) ?? []).map((row) => ({
    code: String(row['stockCode'] ?? ''),
    name: String(row['stockName'] ?? ''),
    openDate: String(row['openDate'] ?? ''),
    closeDate: parseCloseDate(row['closeDate']),
    holdDays: num(row['holdDays']),
    rounds: num(row['ocCount']),
    avgBuy: num(row['avgBuyPrice']),
    avgSell: row['avgSellPrice'] === '' ? null : num(row['avgSellPrice']),
    fee: num(row['fee']),
    profit: num(row['totalProfit']),
    rate: num(row['totalProfitRate']),
  }));
};

/**
 * 个基累计收益（queryFundHoldingReturns.allProfit / allRate）
 * @returns 个基收益列表；未配置代理 / 调用失败时返回空数组
 */
export const getTzzbFundHoldingReturns = async (): Promise<TzzbHoldingReturn[]> => {
  const keys = await ensureKeys();
  if (!keys) return [];
  const r = (await callTzzbTool('queryFundHoldingReturns', {
    fundId: keys.fundId,
    custId: keys.custId,
  })) as Record<string, unknown> | undefined;
  if (!r) return [];
  return matrixRows(r['funds']).map((row) => ({
    code: String(row['fundcode'] ?? ''),
    name: String(row['fundname'] ?? ''),
    profit: num(row['allProfit']),
    rate: num(row['allRate']),
  }));
};

/**
 * 股票逐笔流水（queryMoneyHistory 分页）
 * @param page 页码（从 1 起）
 * @returns 分页流水；未配置代理 / 调用失败时返回 null
 */
export const getTzzbStockTrades = async (page: string): Promise<TzzbStockTradePage | null> => {
  const keys = await ensureKeys();
  if (!keys) return null;
  const r = (await callTzzbTool('queryMoneyHistory', {
    page: String(page),
    count: '20',
    startDate: dayjs().subtract(3, 'month').format('YYYYMMDD'),
    endDate: dayjs().format('YYYYMMDD'),
    ...stockKeyArgs(keys),
  })) as Record<string, unknown> | undefined;
  if (!r) return null;
  const list = ((r['list'] as Record<string, unknown>[] | undefined) ?? []).map(
    (row): TzzbStockTrade => ({
      date: String(row['entryDate'] ?? ''),
      code: String(row['stockCode'] ?? ''),
      name: String(row['stockName'] ?? ''),
      action: String(row['opName'] ?? ''),
      price: num(row['entryPrice']),
      quantity: num(row['entryCount']),
      amount: num(row['entryMoney']),
      commission: num(row['commission']),
      transferFee: num(row['transferFee']),
      feeTotal: num(row['feeTotal']),
    }),
  );
  return { page: num(r['page']) || 1, maxPage: num(r['maxPage']) || 1, list };
};

/**
 * 基金申赎流水（queryFundSummaryHistory；六元组重复行去重）
 * @param month 月份 yyyy-MM
 * @returns 去重后的流水列表；未配置代理 / 调用失败时返回空数组
 */
export const getTzzbFundTrades = async (month: string): Promise<TzzbFundTrade[]> => {
  const keys = await ensureKeys();
  if (!keys) return [];
  const r = (await callTzzbTool('queryFundSummaryHistory', {
    monthList: month,
    fundId: keys.fundId,
    custId: keys.custId,
  })) as { data?: { month?: string; list?: unknown }[] } | undefined;
  if (!r?.data) return [];
  const seen = new Set<string>();
  const out: TzzbFundTrade[] = [];
  for (const block of r.data) {
    for (const row of matrixRows(block.list)) {
      const trade: TzzbFundTrade = {
        date: String(row['confirmDate'] ?? ''),
        accountName: String(row['accountName'] ?? ''),
        code: String(row['fundCode'] ?? ''),
        name: String(row['fundName'] ?? ''),
        action: String(row['opName'] ?? ''),
        amount: num(row['transAmount']),
        shares: num(row['transCount']),
      };
      // 实测存在完全重复行：六元组（账户+代码+名称+金额+份额+确认日+操作）去重
      const key = [
        trade.accountName,
        trade.code,
        trade.name,
        trade.amount,
        trade.shares,
        trade.date,
        trade.action,
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trade);
    }
  }
  return out;
};

/**
 * 同步状态（直连阶段为实时拉取口径）
 * @returns 同步状态文案
 */
export const getTzzbSyncMeta = async (): Promise<TzzbSyncMeta> => ({
  lastSyncLabel: `${dayjs().format('YYYY-MM-DD HH:mm')}（实时）`,
  dataDate: dayjs().format('YYYY-MM-DD'),
  authExpireLabel: 'MCP 直连',
});

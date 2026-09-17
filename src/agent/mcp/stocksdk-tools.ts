/**
 * 内置 MCP：stock-sdk（行情算法工具集）
 *
 * 把 stock-sdk 的行情取数 + 纯函数算法封装成 MCP 工具供 Agent 调用：
 * 实时行情、K 线、技术指标（MA/MACD/RSI/BOLL）、MA 金叉回测、股票搜索、符号归一化。
 * 取数走项目自研通道（新浪 K 线 / 腾讯行情 / 同源代理），算法复用 SDK 纯函数。
 *
 * 双通道结果（MCP Apps）：
 * - `content[0].text` 给模型（精简 JSON，控制 token）；
 * - `structuredContent` 给 UI（完整渲染数据，不进模型上下文）；
 * - 声明 `_meta.ui.resourceUri` 的工具，其调用会在聊天气泡里渲染成对应卡片。
 *
 * 本服务器为**内置 MCP**：不可删除、不可编辑，随应用常驻
 */
import { calcBOLL, calcMA, calcMACD, calcRSI, normalizeSymbol } from 'stock-sdk';
import { z } from 'zod';
import { fetchFullQuotes } from '../../api/quotes.api';
import { searchStocks } from '../../api/search.api';
import { fetchKlineCached } from '../../api/kline-cache.api';
import { type SinaKlinePeriod } from '../../api/sina-kline.api';
import { runMaCrossBacktest } from '../../api/screener.api';
import { toFullSymbol } from '../../utils/to-full-symbol';
import {
  buildIndicatorPayload,
  buildKlinePayload,
  buildQuoteTablePayload,
  type KlineBar,
  type QuoteTableRow,
} from './ui-payload';
import { QUOTE_TABLE_APP, SERIES_CHART_APP } from './ui-apps';
import { BUILTIN_MCP_IDS } from './constants';
import type { BuiltinMcpServer, McpCallToolResult, McpToolEntry } from './types';

/** 工具执行体的返回：模型文本 + UI 载荷（可选，缺省则不渲染卡片） */
interface ToolRunResult {
  /** 给模型的文本（非字符串会被 JSON 序列化） */
  text: unknown;
  /** 给 UI 的结构化载荷（进 structuredContent） */
  payload?: Record<string, unknown>;
  /** 覆盖工具声明的 UI 资源（一般不用） */
  uiResourceUri?: string;
}

/** 工具声明参数 */
interface ToolConfig {
  /** 工具名（snake_case） */
  name: string;
  /** 给模型看的用途说明 */
  description: string;
  /** 入参 zod schema */
  schema: z.ZodType;
  /** MCP Apps UI 资源地址（声明后调用即渲染卡片） */
  uiResourceUri?: string;
  /** 是否允许 MCP App 反向调用（只读工具可开；默认不允许） */
  uiCallable?: boolean;
  /** 执行体 */
  run: (input: unknown) => Promise<ToolRunResult>;
}

/**
 * 构造工具条目（zod schema 为单一事实源，inputSchema 由其推导出 JSON Schema）
 *
 * 执行体统一包装：把 `McpCallToolResult`（文本 + 结构化载荷 + `_meta.ui`）装配出来。
 * 抛错交给 registry 层包装成 isError 文本，不在此吞掉。
 *
 * @param config 工具声明与执行体
 * @returns MCP 工具条目
 */
const entry = (config: ToolConfig): McpToolEntry => {
  const uiResourceUri = config.uiResourceUri;
  return {
    definition: {
      name: config.name,
      description: config.description,
      inputSchema: z.toJSONSchema(config.schema) as Record<string, unknown>,
      ...(uiResourceUri ? { _meta: { ui: { resourceUri: uiResourceUri } } } : {}),
    },
    schema: config.schema,
    uiCallable: config.uiCallable === true,
    execute: async (input): Promise<McpCallToolResult> => {
      const result = await config.run(input);
      const text = typeof result.text === 'string' ? result.text : JSON.stringify(result.text);
      const uri = result.uiResourceUri ?? uiResourceUri;
      return {
        content: [{ type: 'text', text }],
        ...(result.payload ? { structuredContent: result.payload } : {}),
        ...(uri ? { _meta: { ui: { resourceUri: uri } } } : {}),
      };
    },
  };
};

/**
 * 符号归一化：600519 / SH600519 等形态 → sh600519（新浪/腾讯通道标准形态）
 * @param raw 原始代码
 * @returns 完整符号（sh600519 形态）
 */
const fullSymbol = (raw: string): string => toFullSymbol(String(raw ?? '').trim());

/** 行情摘要（裁剪 bid/ask 等大字段，控制 token 成本） */
interface QuoteDigest extends QuoteTableRow {
  /** 涨跌额 */
  change: number;
  /** 成交量（手） */
  volume: number;
  /** 行情时间（原始字符串） */
  time: string;
}

/**
 * FullQuote → 行情摘要
 * @param q 完整报价
 * @returns 行情摘要（裁剪五档等大字段）
 */
const toDigest = (q: Record<string, unknown>): QuoteDigest => ({
  code: String(q.code ?? ''),
  name: String(q.name ?? ''),
  price: Number(q.price ?? 0),
  change: Number(q.change ?? 0),
  changePercent: Number(q.changePercent ?? 0),
  open: Number(q.open ?? 0),
  high: Number(q.high ?? 0),
  low: Number(q.low ?? 0),
  prevClose: Number(q.prevClose ?? 0),
  volume: Number(q.volume ?? 0),
  amount: Number(q.amount ?? 0),
  turnoverRate: q.turnoverRate === undefined || q.turnoverRate === null ? null : Number(q.turnoverRate),
  time: String(q.time ?? ''),
});

/** 内置「stock-sdk」MCP 服务器 */
export const STOCK_SDK_MCP_SERVER: BuiltinMcpServer = {
  id: BUILTIN_MCP_IDS.stockSdk,
  key: 'stock-sdk',
  name: 'stock-sdk（内置）',
  description: 'A 股实时行情、K 线、技术指标（MA/MACD/RSI/BOLL）、MA 金叉回测、股票搜索',
  uiResources: [QUOTE_TABLE_APP, SERIES_CHART_APP].map((app) => ({
    uri: app.uri,
    name: app.name,
    mimeType: 'text/html;profile=mcp-app' as const,
    html: app.html,
    uiCallableTools: ['get_quotes', 'get_kline', 'calc_indicator', 'search_stock', 'normalize_symbol'],
  })),
  tools: [
    entry({
      name: 'get_quotes',
      description:
        '批量获取 A 股实时行情快照（价格/涨跌幅/开高低收/成交量额/换手率）。symbols 支持 600519 / sh600519 / SH600519 等形态',
      schema: z.object({
        symbols: z.array(z.string()).min(1).max(50).describe('股票代码列表（≤50 只）'),
      }),
      uiResourceUri: QUOTE_TABLE_APP.uri,
      uiCallable: true,
      run: async (input) => {
        const symbols = (input as { symbols: string[] }).symbols.map(fullSymbol);
        const quotes = await fetchFullQuotes(symbols);
        const digests = quotes.map((q) => toDigest(q as unknown as Record<string, unknown>));
        const asOf = digests.find((row) => row.time)?.time;
        return {
          text: digests,
          payload: buildQuoteTablePayload(digests, asOf) as unknown as Record<string, unknown>,
        };
      },
    }),
    entry({
      name: 'get_kline',
      description:
        '获取 A 股 K 线（不复权，新浪源）。period: daily=日K / weekly=周K / monthly=月K / min5=5分钟线；返回 OHLCV 序列（按时间升序）',
      schema: z.object({
        symbol: z.string().describe('股票代码（600519 / sh600519 等形态）'),
        period: z.enum(['daily', 'weekly', 'monthly', 'min5']).default('daily').describe('K 线周期'),
        limit: z.number().int().min(10).max(400).default(60).describe('返回最近 N 根（默认 60）'),
      }),
      uiResourceUri: SERIES_CHART_APP.uri,
      uiCallable: true,
      run: async (input) => {
        const { symbol, period, limit } = input as {
          symbol: string;
          period: SinaKlinePeriod;
          limit: number;
        };
        const full = fullSymbol(symbol);
        // 单票查询走本地缓存（Agent 只问这一只，值得落库；首次全量、之后只补缺口）
        const bars = await fetchKlineCached(full, period);
        const tail: KlineBar[] = bars.slice(-limit).map((bar) => ({
          date: new Date(bar.timestamp).toISOString().slice(0, 10),
          open: bar.open,
          close: bar.close,
          high: bar.high,
          low: bar.low,
          volume: bar.volume ?? 0,
        }));
        return {
          text: tail,
          payload: buildKlinePayload({
            symbol: full,
            period,
            bars: tail,
          }) as unknown as Record<string, unknown>,
        };
      },
    }),
    entry({
      name: 'calc_indicator',
      description:
        '计算 A 股技术指标（基于日 K 收盘价，stock-sdk 纯函数）。kind: ma=均线(5/10/20/30/60) / macd=DIF·DEA·MACD / rsi=RSI(6/12/24) / boll=布林带(中轨/上轨/下轨)。返回最近 limit 根的指标值',
      schema: z.object({
        symbol: z.string().describe('股票代码（600519 / sh600519 等形态）'),
        kind: z.enum(['ma', 'macd', 'rsi', 'boll']).describe('指标类型'),
        limit: z.number().int().min(1).max(120).default(20).describe('返回最近 N 根（默认 20）'),
      }),
      uiResourceUri: SERIES_CHART_APP.uri,
      uiCallable: true,
      run: async (input) => {
        const { symbol, kind, limit } = input as {
          symbol: string;
          kind: 'ma' | 'macd' | 'rsi' | 'boll';
          limit: number;
        };
        const full = fullSymbol(symbol);
        // 单票指标计算走本地缓存（MA60 最长回看 60 根，本地历史足够即零请求）
        const bars = await fetchKlineCached(full, 'daily');
        const closes = bars.map((bar) => bar.close);
        let rows: Array<Record<string, number | null>>;
        switch (kind) {
          case 'ma':
            rows = calcMA(closes, { periods: [5, 10, 20, 30, 60] }) as unknown as Array<
              Record<string, number | null>
            >;
            break;
          case 'macd':
            rows = calcMACD(closes) as unknown as Array<Record<string, number | null>>;
            break;
          case 'rsi':
            rows = calcRSI(closes) as unknown as Array<Record<string, number | null>>;
            break;
          case 'boll':
            rows = calcBOLL(closes) as unknown as Array<Record<string, number | null>>;
            break;
        }
        const dates = bars.map((bar) => new Date(bar.timestamp).toISOString().slice(0, 10));
        const start = Math.max(0, rows.length - limit);
        const zipped = rows.slice(start).map((row, index) => ({
          date: dates[start + index],
          ...row,
        }));
        const payload = buildIndicatorPayload({
          symbol: full,
          kind,
          dates: dates.slice(start),
          closes: closes.slice(start),
          rows: rows.slice(start),
        });
        return {
          text: zipped,
          payload: payload as unknown as Record<string, unknown>,
        };
      },
    }),
    entry({
      name: 'run_backtest',
      description:
        '对单只 A 股运行 MA5/MA20 金叉死叉策略回测（近一年日 K，含手续费），返回收益、最大回撤、交易明细与买入持有基准',
      schema: z.object({
        symbol: z.string().describe('股票代码（600519 / sh600519 等形态）'),
      }),
      run: async (input) => {
        const { symbol } = input as { symbol: string };
        return { text: await runMaCrossBacktest(symbol) };
      },
    }),
    entry({
      name: 'search_stock',
      description:
        '按名称或代码模糊搜索 A 股（返回代码 / 名称 / 市场，用于把用户口中的股票名转成代码）',
      schema: z.object({
        keyword: z.string().min(1).describe('关键词（如 茅台 / 600519）'),
      }),
      uiCallable: true,
      run: async (input) => {
        const { keyword } = input as { keyword: string };
        const results = await searchStocks(keyword);
        return {
          text: results.slice(0, 10).map((r) => ({
            code: r.code,
            name: r.name,
            market: r.market,
            type: r.type,
          })),
        };
      },
    }),
    entry({
      name: 'normalize_symbol',
      description:
        '股票代码形态归一化（600519 / SH600519 / sz000001 → sh600519 标准形态），仅本地计算不发请求',
      schema: z.object({
        symbol: z.string().describe('原始代码'),
      }),
      uiCallable: true,
      run: async (input) => {
        const { symbol } = input as { symbol: string };
        try {
          return {
            text: { symbol: fullSymbol(symbol), normalized: String(normalizeSymbol(symbol)) },
          };
        } catch (error) {
          return { text: { error: error instanceof Error ? error.message : String(error) } };
        }
      },
    }),
  ],
};

/**
 * 内置 MCP：market-data（市场与个股数据工具集）
 *
 * 把 src/api 下已有但**从未暴露给 Agent** 的数据能力封装成 MCP 工具：
 * 大盘概览、资金流向（大盘/板块/个股/北向）、板块涨跌、涨停池、盘口异动、
 * 龙虎榜、大宗交易、全球指数、美股板块、多源热点新闻与热词。
 *
 * 设计约束（延续既有约定）：
 * - 全部为**只读**工具（不落库、不改状态）；
 * - 返回分双通道：`content[0].text` 给模型（**已按 limit 截断并裁剪字段**，控制 token）、
 *   `structuredContent` 给 UI（当前均未声明 ui:// 卡片，故仅文本通道）；
 * - ⚠️ 大结果必须截断：板块/排名类默认只给前 N 条 + 总数，禁止整表回灌模型上下文；
 * - ⚠️ 上游 200 ≠ 有数据：空结果如实返回 `count: 0`，由子 agent 按「该维度数据不可得」处理。
 *
 * 本服务器为**内置 MCP**：不可删除、不可编辑，随应用常驻
 */
import { z } from 'zod';
import { fetchConceptBoards, fetchIndustryBoards } from '../../api/board.api';
import { fetchBlockTradeDetail, fetchDragonTigerDetail } from '../../api/dragon-tiger.api';
import { fetchBoardChanges, fetchStockChanges, fetchZtPool } from '../../api/event.api';
import {
  fetchFundFlowRank,
  fetchIndividualFundFlow,
  fetchMarketFundFlow,
  fetchNorthboundHoldingRank,
  fetchSectorFundFlowRank,
} from '../../api/flow.api';
import {
  fetchClsDepth,
  fetchEastmoneyHotNews,
  fetchEmHotKeywords,
  fetchEmLeadingConcepts,
  fetchSinaHotNews,
  fetchThepaperHotList,
  fetchThsHotNews,
  fetchThsHotThemes,
} from '../../api/news.api';
import { fetchGlobalIndexQuotes, fetchUsSectorPanorama } from '../../api/panorama.api';
import { fetchFlowCycleHistories } from '../../plugins/dsh-flow-cycle/api';
import { buildFlowCycleSummary } from '../../plugins/dsh-flow-cycle/judge';
import { fetchFullQuotes } from '../../api/quotes.api';
import { fetchSectorFlowCurves } from '../../api/sector-flow-curve.api';
import { fetchMarketTurnover } from '../../api/turnover.api';
import { toFullSymbol } from '../../utils/to-full-symbol';
import { BUILTIN_MCP_IDS } from './constants';
import type { BuiltinMcpServer, McpCallToolResult, McpToolEntry } from './types';

/** 结果条数上限（防止单次调用吃掉整个上下文预算） */
const MAX_ROWS = 50;

/** 大盘指数符号（上证 / 深证成指 / 创业板指 / 科创50） */
const MARKET_INDEX_SYMBOLS = ['sh000001', 'sz399001', 'sz399006', 'sh000688'] as const;

/** 单条结果的行数上限（默认值） */
const DEFAULT_ROWS = 20;

/** 工具执行体返回 */
interface ToolRunResult {
  /** 给模型的文本（非字符串会被 JSON 序列化） */
  text: unknown;
}

/** 工具声明参数 */
interface ToolConfig {
  /** 工具名（snake_case） */
  name: string;
  /** 给模型看的用途说明 */
  description: string;
  /** 入参 zod schema */
  schema: z.ZodType;
  /** 执行体 */
  run: (input: unknown) => Promise<ToolRunResult>;
}

/**
 * 构造工具条目（zod schema 为单一事实源，inputSchema 由其推导出 JSON Schema）
 *
 * 本服务器全部为只读工具：不声明 ui:// 资源，沙箱 iframe 亦不可反向调用
 * （`uiCallable: false` —— 反向调用只对声明了 UI 资源的工具开放）。
 *
 * @param config 工具声明与执行体
 * @returns MCP 工具条目
 */
const entry = (config: ToolConfig): McpToolEntry => ({
  definition: {
    name: config.name,
    description: config.description,
    inputSchema: z.toJSONSchema(config.schema) as Record<string, unknown>,
  },
  schema: config.schema,
  uiCallable: false,
  execute: async (input): Promise<McpCallToolResult> => {
    const result = await config.run(input);
    const text = typeof result.text === 'string' ? result.text : JSON.stringify(result.text);
    return { content: [{ type: 'text', text }] };
  },
});

/**
 * 按数值字段排序（null 排在末尾）
 * @param rows 原始行
 * @param pick 取值函数
 * @param desc 是否降序
 * @returns 排序后的新数组
 */
const sortBy = <T>(rows: T[], pick: (row: T) => number | null, desc: boolean): T[] =>
  [...rows].sort((a, b) => {
    const left = pick(a);
    const right = pick(b);
    if (left === null && right === null) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    return desc ? right - left : left - right;
  });

/**
 * 取前 N 条
 * @param rows 原始行
 * @param limit 条数上限
 * @returns 截断后的数组
 */
const take = <T>(rows: T[], limit: number): T[] => rows.slice(0, Math.max(1, Math.min(limit, MAX_ROWS)));

/** 板块列表行（行业 / 概念共用同一组字段） */
interface BoardDigestRow {
  /** 板块代码 */
  code: string;
  /** 板块名 */
  name: string;
  /** 涨跌幅（%） */
  changePercent: number | null;
  /** 换手率（%） */
  turnoverRate: number | null;
  /** 上涨家数 */
  riseCount: number | null;
  /** 下跌家数 */
  fallCount: number | null;
  /** 领涨股 */
  leadingStock: string | null;
}

/**
 * 板块行 → 分析所需字段（行业与概念同构）
 * @param row 原始板块行
 * @returns 精简后的记录
 */
const boardDigest = (row: BoardDigestRow): Record<string, unknown> => ({
  code: row.code,
  name: row.name,
  changePercent: row.changePercent,
  turnoverRate: row.turnoverRate,
  riseCount: row.riseCount,
  fallCount: row.fallCount,
  leadingStock: row.leadingStock,
});

/** 内置「market-data」MCP 服务器 */
export const MARKET_DATA_MCP_SERVER: BuiltinMcpServer = {
  id: BUILTIN_MCP_IDS.marketData,
  key: 'market-data',
  name: '市场数据（内置）',
  description:
    '大盘概览、资金流向（大盘/板块/个股/北向、板块分时资金曲线、板块逐日资金历史）、板块涨跌、涨停池、盘口异动、龙虎榜、大宗交易、全球指数、美股板块、多源热点新闻与热词',
  tools: [
    entry({
      name: 'get_market_overview',
      description:
        '获取大盘概览：四大指数（上证/深证成指/创业板指/科创50）最新点位与涨跌幅，以及沪深两市近期每日总成交额。用于判断市场整体强弱与量能水平',
      schema: z.object({
        days: z.number().int().min(1).max(30).default(5).describe('返回最近 N 个交易日的成交额（默认 5）'),
      }),
      run: async (input) => {
        const { days } = input as { days: number };
        const [quotes, turnover] = await Promise.all([
          fetchFullQuotes(MARKET_INDEX_SYMBOLS),
          fetchMarketTurnover(),
        ]);
        const indexes = quotes.map((q) => ({
          code: String(q.code ?? ''),
          name: String(q.name ?? ''),
          price: Number(q.price ?? 0),
          changePercent: Number(q.changePercent ?? 0),
          amount: Number(q.amount ?? 0),
          time: String(q.time ?? ''),
        }));
        const recent = turnover.slice(-days).map((row) => ({
          date: row.date,
          totalAmountYi: Math.round(row.totalAmount / 1e8),
        }));
        return { text: { indexes, turnover: recent, unit: '成交额单位：亿元' } };
      },
    }),
    entry({
      name: 'get_market_fund_flow',
      description:
        '获取大盘资金流向历史（按交易日，最新一条即当日）：主力/超大单/大单/中单/小单净流入额与净占比。用于判断市场资金总量的流入流出方向',
      schema: z.object({
        days: z.number().int().min(1).max(60).default(10).describe('返回最近 N 个交易日（默认 10）'),
      }),
      run: async (input) => {
        const { days } = input as { days: number };
        const rows = await fetchMarketFundFlow();
        const tail = take(rows.slice(-days).reverse(), days).map((row) => ({
          date: row.date,
          shChangePercent: row.shChangePercent,
          mainNetInflow: row.mainNetInflow,
          mainNetInflowPercent: row.mainNetInflowPercent,
          superLargeNetInflow: row.superLargeNetInflow,
          largeNetInflow: row.largeNetInflow,
          mediumNetInflow: row.mediumNetInflow,
          smallNetInflow: row.smallNetInflow,
        }));
        return {
          text: { count: rows.length, rows: tail, unit: '净流入单位：元' },
        };
      },
    }),
    entry({
      name: 'get_industry_boards',
      description:
        '获取行业板块涨跌幅排行（含板块代码、涨跌幅、换手率、上涨/下跌家数、领涨股）。可按涨幅升/降序取前 N 条；返回 code 可用于获取成分股',
      schema: z.object({
        order: z.enum(['desc', 'asc']).default('desc').describe('desc=领涨在前，asc=领跌在前'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { order, limit } = input as { order: 'desc' | 'asc'; limit: number };
        const rows = await fetchIndustryBoards();
        const sorted = sortBy(rows, (row) => row.changePercent, order === 'desc');
        return {
          text: { total: rows.length, rows: take(sorted, limit).map(boardDigest) },
        };
      },
    }),
    entry({
      name: 'get_concept_boards',
      description:
        '获取概念板块涨跌幅排行（含板块代码、涨跌幅、换手率、上涨/下跌家数、领涨股）。可按涨幅升/降序取前 N 条，用于识别当日市场主线题材',
      schema: z.object({
        order: z.enum(['desc', 'asc']).default('desc').describe('desc=领涨在前，asc=领跌在前'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { order, limit } = input as { order: 'desc' | 'asc'; limit: number };
        const rows = await fetchConceptBoards();
        const sorted = sortBy(rows, (row) => row.changePercent, order === 'desc');
        return {
          text: { total: rows.length, rows: take(sorted, limit).map(boardDigest) },
        };
      },
    }),
    entry({
      name: 'get_sector_fund_flow',
      description:
        '获取行业板块主力资金净流入排名（含板块名称、涨跌幅、主力/超大单/大单/中单/小单净流入及主力净流入最大股）。用于判断资金在板块间的分布与迁移',
      schema: z.object({
        direction: z.enum(['inflow', 'outflow']).default('inflow').describe('inflow=净流入在前，outflow=净流出在前'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { direction, limit } = input as { direction: 'inflow' | 'outflow'; limit: number };
        const rows = await fetchSectorFundFlowRank();
        const sorted = sortBy(rows, (row) => row.mainNetInflow, direction === 'inflow');
        return {
          text: {
            total: rows.length,
            rows: take(sorted, limit).map((row) => ({
              code: row.code,
              name: row.name,
              changePercent: row.changePercent,
              mainNetInflow: row.mainNetInflow,
              mainNetInflowPercent: row.mainNetInflowPercent,
              superLargeNetInflow: row.superLargeNetInflow,
              largeNetInflow: row.largeNetInflow,
              smallNetInflow: row.smallNetInflow,
              topStockName: row.topStockName ?? null,
            })),
            unit: '净流入单位：元',
          },
        };
      },
    }),
    entry({
      name: 'get_sector_flow_curve',
      description:
        '获取行业板块当日分时资金流曲线（每分钟一点，值为当日累计主力净流入，09:31→15:00）。用于复盘板块资金的日内进出节奏（如尾盘抢筹 / 开盘流出后回补）。板块代码（BK 编号）可先经 get_sector_fund_flow 获取；单次最多 26 个板块，逐点抽稀控制返回体积',
      schema: z.object({
        bkCodes: z
          .array(z.string().regex(/^BK\d{4}$/, 'BK 编号形如 BK0475'))
          .min(1)
          .max(26)
          .describe('板块代码列表（东财 BK 编号，1~26 个）'),
        sampleStep: z
          .number()
          .int()
          .min(1)
          .max(60)
          .default(15)
          .describe('抽稀步长：每 N 分钟取一点（默认 15，即每刻钟一点；1 为全量 240 点）'),
      }),
      run: async (input) => {
        const { bkCodes, sampleStep } = input as { bkCodes: string[]; sampleStep: number };
        // 名称 / 涨跌幅从板块排名合并（1 次请求，失败不阻断曲线返回）
        const [curves, rank] = await Promise.all([
          fetchSectorFlowCurves(bkCodes),
          fetchSectorFundFlowRank().catch(() => []),
        ]);
        const rankByCode = new Map(rank.map((item) => [item.code, item]));
        const rows = curves.map((curve) => ({
          code: curve.code,
          name: rankByCode.get(curve.code)?.name ?? curve.code,
          changePercent: rankByCode.get(curve.code)?.changePercent ?? null,
          closeNetInflow: curve.points[curve.points.length - 1]?.mainNetInflow ?? null,
          points: curve.points
            .filter((_, index) => index % sampleStep === 0)
            .map((point) => ({ time: point.time, mainNetInflow: point.mainNetInflow })),
        }));
        return {
          text: {
            tradeDate: curves[0]?.tradeDate ?? null,
            count: rows.length,
            failed: bkCodes.length - rows.length,
            rows,
            unit: '净流入单位：元（当日累计）',
          },
        };
      },
    }),
    entry({
      name: 'get_board_flow_history',
      description:
        '获取板块（行业/概念）近 N 个交易日的逐日主力净流入历史与区间合计。用于判断板块资金的持续性：持续流入（吸筹）还是一轮游（脉冲后流出）。板块代码可先经 get_sector_fund_flow / 热点排行获取；单次最多 30 个板块',
      schema: z.object({
        bkCodes: z
          .array(z.string().regex(/^BK\d{4}$/, 'BK 编号形如 BK0475'))
          .min(1)
          .max(30)
          .describe('板块代码列表（东财 BK 编号，1~30 个）'),
        days: z
          .number()
          .int()
          .min(1)
          .max(60)
          .default(10)
          .describe('返回最近 N 个交易日（默认 10，最大 60）'),
      }),
      run: async (input) => {
        const { bkCodes, days } = input as { bkCodes: string[]; days: number };
        const histories = await fetchFlowCycleHistories(bkCodes);
        // 复用插件的区间聚合纯函数：对齐交易日轴 + 合计 + 完整度
        const summary = buildFlowCycleSummary(
          histories,
          new Map(
            histories.map((history) => [
              history.code,
              { code: history.code, name: history.name, changePercent: null, net10d: null, net5d: null },
            ]),
          ),
          days,
        );
        return {
          text: {
            tradeDays: summary.tradeDays,
            dateRange: summary.dates.length
              ? `${summary.dates[0]} ~ ${summary.dates[summary.dates.length - 1]}`
              : null,
            netTotalYi: Math.round(summary.netTotal / 1e8),
            count: summary.boards.length,
            failed: bkCodes.length - histories.length,
            rows: summary.boards.map((board) => ({
              code: board.code,
              name: board.name,
              netSumYi: Math.round(board.netSum / 1e8),
              completeness: board.completeness,
              history: board.history.map((row) => ({
                date: row.date,
                netYi: row.net === null ? null : Math.round((row.net / 1e8) * 100) / 100,
              })),
            })),
            unit: '净流入单位：亿元（当日口径，正值流入）',
          },
        };
      },
    }),
    entry({
      name: 'get_fund_flow_rank',
      description:
        '获取个股主力资金净流入排名（当日口径，含股票代码、名称、最新价、涨跌幅、主力/超大单/大单/中单/小单净流入及净占比）。用于筛选当日资金关注度最高的个股',
      schema: z.object({
        direction: z.enum(['inflow', 'outflow']).default('inflow').describe('inflow=净流入在前，outflow=净流出在前'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { direction, limit } = input as { direction: 'inflow' | 'outflow'; limit: number };
        const rows = await fetchFundFlowRank();
        const sorted = sortBy(rows, (row) => row.mainNetInflow, direction === 'inflow');
        return {
          text: {
            total: rows.length,
            rows: take(sorted, limit).map((row) => ({
              code: row.code,
              name: row.name,
              price: row.price,
              changePercent: row.changePercent,
              mainNetInflow: row.mainNetInflow,
              mainNetInflowPercent: row.mainNetInflowPercent,
              superLargeNetInflow: row.superLargeNetInflow,
              largeNetInflow: row.largeNetInflow,
            })),
            unit: '净流入单位：元',
          },
        };
      },
    }),
    entry({
      name: 'get_northbound_rank',
      description:
        '获取北向资金（陆股通）持股市值排名：股票代码、名称、收盘价、涨跌幅、持股股数、持股市值、持股占流通股比、区间增持估计市值',
      schema: z.object({
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { limit } = input as { limit: number };
        const rows = await fetchNorthboundHoldingRank();
        const sorted = sortBy(rows, (row) => row.holdMarketValue, true);
        return {
          text: {
            total: rows.length,
            rows: take(sorted, limit).map((row) => ({
              date: row.date,
              code: row.code,
              name: row.name,
              close: row.close,
              changePercent: row.changePercent,
              holdMarketValue: row.holdMarketValue,
              holdRatioFloat: row.holdRatioFloat,
              addMarketValue: row.addMarketValue,
            })),
            unit: '市值单位：元',
          },
        };
      },
    }),
    entry({
      name: 'get_limit_pool',
      description:
        '获取涨跌停与强势股池：zt=涨停股池 / yesterday=昨日涨停 / strong=强势股池 / sub_new=次新股池 / broken=炸板股池 / dt=跌停股池。含价格、涨跌幅、成交额、换手率、连板数、首次封板时间。用于刻画市场情绪温度',
      schema: z.object({
        type: z
          .enum(['zt', 'yesterday', 'strong', 'sub_new', 'broken', 'dt'])
          .default('zt')
          .describe('池子类型（默认 zt 涨停股池）'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { type, limit } = input as { type: 'zt' | 'yesterday' | 'strong' | 'sub_new' | 'broken' | 'dt'; limit: number };
        const rows = await fetchZtPool(type);
        return {
          text: {
            type,
            total: rows.length,
            rows: take(rows, limit).map((row) => ({
              code: row.code,
              name: row.name,
              price: row.price,
              changePercent: row.changePercent,
              amount: row.amount,
              turnoverRate: row.turnoverRate,
              continuousBoardCount: row.continuousBoardCount,
              firstBoardTime: row.firstBoardTime,
            })),
          },
        };
      },
    }),
    entry({
      name: 'get_market_changes',
      description:
        '获取盘口异动与板块异动：kind=stock 为全市场个股异动（时间、代码、名称、异动类型、相关信息）；kind=board 为板块异动汇总（异动次数、主力净流入、最频繁个股）。用于捕捉盘中的即时信号',
      schema: z.object({
        kind: z.enum(['stock', 'board', 'both']).default('both').describe('异动类型（默认 both）'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('每类返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { kind, limit } = input as { kind: 'stock' | 'board' | 'both'; limit: number };
        const result: Record<string, unknown> = {};
        if (kind === 'stock' || kind === 'both') {
          const rows = await fetchStockChanges();
          result.stockTotal = rows.length;
          result.stockRows = take(rows, limit).map((row) => ({
            time: row.time,
            code: row.code,
            name: row.name,
            changeTypeLabel: row.changeTypeLabel,
            info: row.info,
          }));
        }
        if (kind === 'board' || kind === 'both') {
          const rows = await fetchBoardChanges();
          result.boardTotal = rows.length;
          result.boardRows = take(rows, limit).map((row) => ({
            name: row.name,
            changePercent: row.changePercent,
            mainNetInflow: row.mainNetInflow,
            totalChangeCount: row.totalChangeCount,
            topStockName: row.topStockName,
            topStockDirection: row.topStockDirection,
          }));
        }
        return { text: result };
      },
    }),
    entry({
      name: 'get_dragon_tiger',
      description:
        '获取近期龙虎榜明细（近 N 个交易日，含股票代码、名称、上榜日期、收盘价、涨跌幅、龙虎榜净买额/买入额/卖出额）',
      schema: z.object({
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
        minNetBuy: z.number().optional().describe('只返回净买额不低于该值的记录（元；可省略）'),
      }),
      run: async (input) => {
        const { limit, minNetBuy } = input as { limit: number; minNetBuy?: number };
        const rows = await fetchDragonTigerDetail();
        const filtered =
          minNetBuy === undefined ? rows : rows.filter((row) => (row.netBuyAmount ?? 0) >= minNetBuy);
        const sorted = sortBy(filtered, (row) => row.netBuyAmount, true);
        return {
          text: {
            total: filtered.length,
            rows: take(sorted, limit).map((row) => ({
              date: row.date,
              code: row.code,
              name: row.name,
              close: row.close,
              changePercent: row.changePercent,
              netBuyAmount: row.netBuyAmount,
              buyAmount: row.buyAmount,
              sellAmount: row.sellAmount,
            })),
            unit: '金额单位：元',
          },
        };
      },
    }),
    entry({
      name: 'get_block_trade',
      description:
        '获取近期大宗交易明细（含股票代码、名称、交易日期、收盘价、成交价、成交量、成交额、折溢率）',
      schema: z.object({
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { limit } = input as { limit: number };
        const rows = await fetchBlockTradeDetail();
        const sorted = sortBy(rows, (row) => row.dealAmount, true);
        return {
          text: {
            total: rows.length,
            rows: take(sorted, limit).map((row) => ({
              date: row.date,
              code: row.code,
              name: row.name,
              close: row.close,
              changePercent: row.changePercent,
              dealPrice: row.dealPrice,
              dealVolume: row.dealVolume,
              dealAmount: row.dealAmount,
            })),
            unit: '金额单位：元',
          },
        };
      },
    }),
    entry({
      name: 'get_global_index',
      description:
        '获取全球主要指数报价：恒生指数、道琼斯、纳斯达克、标普500、日经225、韩国综合指数（含最新价与涨跌幅）。用于判断外围市场对 A 股的传导环境',
      schema: z.object({}),
      run: async () => {
        const rows = await fetchGlobalIndexQuotes();
        return {
          text: {
            rows: rows.map((row) => ({
              code: row.code,
              name: row.name,
              price: row.price,
              changePercent: row.changePercent,
            })),
          },
        };
      },
    }),
    entry({
      name: 'get_us_sector',
      description: '获取美股板块行情（板块名称与涨跌幅），用于观察外围行业层面的风险偏好',
      schema: z.object({
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { limit } = input as { limit: number };
        const rows = await fetchUsSectorPanorama();
        const sorted = sortBy(rows, (row) => row.changePercent, true);
        return {
          text: {
            total: rows.length,
            rows: take(sorted, limit).map((row) => ({
              name: row.name,
              changePercent: row.changePercent,
            })),
          },
        };
      },
    }),
    entry({
      name: 'get_stock_fund_flow',
      description:
        '获取单只股票的逐日资金流向（近 N 个交易日，含收盘价、涨跌幅、主力/超大单/大单/中单/小单净流入及净占比）',
      schema: z.object({
        symbol: z.string().describe('股票代码（600519 / sh600519 等形态）'),
        days: z.number().int().min(1).max(60).default(10).describe('返回最近 N 个交易日（默认 10）'),
      }),
      run: async (input) => {
        const { symbol, days } = input as { symbol: string; days: number };
        const full = toFullSymbol(String(symbol).trim());
        const rows = await fetchIndividualFundFlow(full);
        const tail = take([...rows].slice(-days).reverse(), days).map((row) => ({
          date: row.date,
          close: row.close,
          changePercent: row.changePercent,
          mainNetInflow: row.mainNetInflow,
          mainNetInflowPercent: row.mainNetInflowPercent,
          superLargeNetInflow: row.superLargeNetInflow,
          largeNetInflow: row.largeNetInflow,
          mediumNetInflow: row.mediumNetInflow,
          smallNetInflow: row.smallNetInflow,
        }));
        return { text: { symbol: full, total: rows.length, rows: tail, unit: '净流入单位：元' } };
      },
    }),
    entry({
      name: 'get_hot_news',
      description:
        '获取热点财经新闻。source: sina=新浪财经 / eastmoney=东方财富 / ths=同花顺 / thepaper=澎湃 / cls=财联社（深度页头条+资讯流）。返回标题、摘要、来源、时间与原文链接',
      schema: z.object({
        source: z.enum(['sina', 'eastmoney', 'ths', 'thepaper', 'cls']).describe('新闻源'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { source, limit } = input as {
          source: 'sina' | 'eastmoney' | 'ths' | 'thepaper' | 'cls';
          limit: number;
        };
        const size = Math.max(1, Math.min(limit, MAX_ROWS));
        /**
         * 统一形态：标题 / 摘要 / 来源 / 时间 / 链接
         * @param rows 各源的原始新闻行
         * @returns 统一字段后的记录
         */
        const shape = (
          rows: Array<{
            title?: string;
            summary?: string;
            media?: string;
            ctime?: string;
            url?: string;
            timeText?: string;
          }>,
        ): Array<Record<string, unknown>> =>
          rows.map((row) => ({
            title: row.title ?? '',
            summary: row.summary ?? '',
            media: row.media ?? '',
            time: row.ctime ?? row.timeText ?? '',
            url: row.url ?? '',
          }));

        let rows: Array<Record<string, unknown>>;
        if (source === 'sina') {
          rows = shape(await fetchSinaHotNews(1, size));
        } else if (source === 'eastmoney') {
          const page = await fetchEastmoneyHotNews('', size);
          rows = shape(page.items ?? []);
        } else if (source === 'ths') {
          rows = shape(await fetchThsHotNews(1, size));
        } else if (source === 'thepaper') {
          const list = await fetchThepaperHotList(size);
          rows = list.map((row) => ({ title: row.title, url: row.url, time: row.timeText, media: '澎湃' }));
        } else {
          const snapshot = await fetchClsDepth();
          const top = (snapshot.topArticles ?? []).map((row) => ({ ...row, media: row.media || '财联社头条' }));
          rows = shape([...top, ...(snapshot.items ?? [])].slice(0, size));
        }
        return { text: { source, count: rows.length, rows } };
      },
    }),
    entry({
      name: 'get_hot_topics',
      description:
        '获取市场热点线索。kind: keywords=东财今日热搜词 / concepts=东财领涨概念板块（含领涨股）/ themes=同花顺热点主题。用于快速掌握当日市场关注焦点',
      schema: z.object({
        kind: z.enum(['keywords', 'concepts', 'themes']).default('concepts').describe('线索类型（默认 concepts）'),
        limit: z.number().int().min(1).max(50).default(DEFAULT_ROWS).describe('返回条数（默认 20）'),
      }),
      run: async (input) => {
        const { kind, limit } = input as { kind: 'keywords' | 'concepts' | 'themes'; limit: number };
        const size = Math.max(1, Math.min(limit, MAX_ROWS));
        if (kind === 'keywords') {
          const rows = await fetchEmHotKeywords(size);
          return { text: { kind, rows: take(rows, size) } };
        }
        if (kind === 'concepts') {
          const rows = await fetchEmLeadingConcepts(size);
          return { text: { kind, rows: take(rows, size) } };
        }
        const rows = await fetchThsHotThemes();
        return { text: { kind, rows: take(rows, size) } };
      },
    }),
  ],
};

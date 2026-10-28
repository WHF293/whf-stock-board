/**
 * 内置 MCP：tzzb（投资账本工具集）
 *
 * 把投资账本数据出口（src/common/api/tzzb.api.ts）封装成 MCP 工具供 Agent 调用：
 * 账户列表、持仓汇总、资产曲线、区间资金变动、盈亏日历（月 / 年）、清仓记录、
 * 个基收益与股票 / 基金流水 —— 让 Agent 能基于用户自己的真实账本做复盘与归因分析。
 *
 * 设计约束（延续既有约定）：
 * - 全部为**只读**工具（不落库、不改状态、无 UI 卡片）；
 * - 结果只走 `content[0].text` 通道，控制 token；
 * - 传输形态：远程 MCP 经同源代理 `/tzzb-mcp`（见 api 层文件头注释）——
 *   未配置代理（他人克隆 / CI / 未完成浏览器授权）时各接口返回 null / 空数组，
 *   由 Agent 按「账本数据不可得」处理，不得据此下结论；鉴权过期同理；
 * - 金额单位一律元、比率一律小数口径（原始口径，不换算），返回体带 unit 说明。
 *
 * 本服务器为**内置 MCP**：不可删除、不可编辑，随应用常驻
 */
import { z } from 'zod';
import {
  getTzzbAccounts,
  getTzzbAssetChange,
  getTzzbClearedPositions,
  getTzzbDayCalendar,
  getTzzbFundHoldingReturns,
  getTzzbFundTrades,
  getTzzbMonthCalendar,
  getTzzbPnlSummary,
  getTzzbPositionSummary,
  getTzzbStockTrades,
} from '../../../common/api/tzzb.api.ts';
import { BUILTIN_MCP_IDS } from './constants';
import type { BuiltinMcpServer, McpCallToolResult, McpToolEntry } from './types';

/** 工具声明参数 */
interface ToolConfig {
  /** 工具名（snake_case） */
  name: string;
  /** 给模型看的用途说明 */
  description: string;
  /** 入参 zod schema */
  schema: z.ZodType;
  /** 执行体 */
  run: (input: unknown) => Promise<unknown>;
}

/**
 * 构造工具条目（zod schema 为单一事实源，inputSchema 由其推导出 JSON Schema）
 *
 * 本服务器全部为只读工具：不声明 ui:// 资源，沙箱 iframe 亦不可反向调用。
 * 抛错交给 registry 层包装成 isError 文本，不在此吞掉。
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
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    return { content: [{ type: 'text', text }] };
  },
});

/** 区间入参 schema（资产曲线 / 资金变动共用；口径与「投资账本」页区间选项一致） */
const RANGE_SCHEMA = z
  .enum(['m1', 'm3', 'm6', 'y1', 'ytd', 'all'])
  .optional()
  .describe(
    '统计区间：m1 本月 / m3 近三月 / m6 近六月 / y1 近一年 / ytd 今年 / all 全部（默认 m1）',
  );

/** 内置「tzzb」MCP 服务器 */
export const TZZB_MCP_SERVER: BuiltinMcpServer = {
  id: BUILTIN_MCP_IDS.tzzb,
  key: 'tzzb',
  name: '投资账本（内置）',
  description:
    '用户投资账本（同花顺投资账本授权数据）：账户列表、持仓汇总（总资产/市值/仓位）、资产曲线与指数对比、区间资金变动、盈亏日历（月/年）、清仓记录、个基收益、股票与基金流水。未配置数据通道或授权过期时返回 null / 空数据',
  tools: [
    entry({
      name: 'get_tzzb_accounts',
      description:
        '获取投资账本的账户列表：股票 / 融资融券 / 手工记账 / 基金四类账户的 id 与名称。做任何账本分析前可先调用它确认账户构成',
      schema: z.object({}),
      run: async () => {
        const rows = await getTzzbAccounts();
        return { count: rows.length, rows };
      },
    }),
    entry({
      name: 'get_tzzb_position_summary',
      description:
        '获取当前持仓汇总：总资产、持仓市值、可用资金、仓位比例。用于「现在有多少钱、仓位多重」类问题。金额单位元，仓位为 0~1 小数',
      schema: z.object({}),
      run: async () => getTzzbPositionSummary(),
    }),
    entry({
      name: 'get_tzzb_pnl_summary',
      description:
        '获取区间资产曲线汇总：区间总盈亏与收益率、逐日资产趋势（总资产/当日盈亏/净值指数/仓位）、指数对比趋势（上证/沪深300 点位）。用于收益复盘与跑赢/跑输基准判断。金额单位元，收益率为小数口径',
      schema: z.object({ range: RANGE_SCHEMA }),
      run: async (input) => {
        const { range } = input as { range?: string };
        return getTzzbPnlSummary(range ?? 'm1');
      },
    }),
    entry({
      name: 'get_tzzb_asset_change',
      description:
        '获取区间资金变动（股票 / 基金两侧，无数据侧为 null）：期初资产、转入、转出、分红、盈亏、期末资产。用于区分「赚的」还是「转入的」。金额单位元，盈亏为小数口径外均为金额',
      schema: z.object({ range: RANGE_SCHEMA }),
      run: async (input) => {
        const { range } = input as { range?: string };
        return getTzzbAssetChange(range ?? 'm1');
      },
    }),
    entry({
      name: 'get_tzzb_day_calendar',
      description:
        '获取某月盈亏日历（月视图）：逐交易日盈亏与收益率、当月股基盈亏汇总、区间指数涨跌。用于定位大赚大亏的具体交易日。金额单位元，收益率为小数口径',
      schema: z.object({
        month: z.string().regex(/^\d{6}$/).describe('月份，格式 yyyyMM（如 202610）'),
      }),
      run: async (input) => {
        const { month } = input as { month: string };
        return getTzzbDayCalendar(month);
      },
    }),
    entry({
      name: 'get_tzzb_month_calendar',
      description:
        '获取某年盈亏日历（年视图）：12 个月的逐月盈亏与收益率。用于年度节奏复盘。金额单位元，收益率为小数口径',
      schema: z.object({
        year: z.string().regex(/^\d{4}$/).describe('年份，格式 yyyy（如 2026）'),
      }),
      run: async (input) => {
        const { year } = input as { year: string };
        return getTzzbMonthCalendar(year);
      },
    }),
    entry({
      name: 'get_tzzb_cleared_positions',
      description:
        '获取建仓以来的清仓记录（按标的聚合的完整买卖回合）：开仓/清仓日期、持有天数、回合数、买卖均价、费用、总盈亏与收益率。closeDate 为 null 表示仍在持有。用于个股操作复盘（拿不住 / 抄底逃顶 / 频繁交易）。金额单位元',
      schema: z.object({}),
      run: async () => {
        const rows = await getTzzbClearedPositions();
        return { count: rows.length, rows, unit: '金额：元；收益率：小数口径' };
      },
    }),
    entry({
      name: 'get_tzzb_fund_holding_returns',
      description:
        '获取基金持仓的个基累计收益列表：基金代码、名称、累计盈亏与收益率。用于基金侧的盈利结构分析。金额单位元，收益率为小数口径',
      schema: z.object({}),
      run: async () => {
        const rows = await getTzzbFundHoldingReturns();
        return { count: rows.length, rows, unit: '金额：元；收益率：小数口径' };
      },
    }),
    entry({
      name: 'get_tzzb_stock_trades',
      description:
        '获取股票逐笔成交流水（近三个月，分页）：成交日期、标的、买卖方向、价格、数量、金额与费用。page >= maxPage 时取完。用于还原具体操作过程。金额单位元，数量单位股',
      schema: z.object({
        page: z.number().int().min(1).max(50).optional().describe('页码，从 1 起（默认 1，每页 20 条）'),
      }),
      run: async (input) => {
        const { page } = input as { page?: number };
        return getTzzbStockTrades(String(page ?? 1));
      },
    }),
    entry({
      name: 'get_tzzb_fund_trades',
      description:
        '获取基金申赎流水（按月）：确认日期、账户、基金、申购/赎回/定投方向、金额与份额。用于基金定投节奏与申赎行为分析。金额单位元，份额单位份',
      schema: z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/).describe('月份，格式 yyyy-MM（如 2026-10）'),
      }),
      run: async (input) => {
        const { month } = input as { month: string };
        const rows = await getTzzbFundTrades(month);
        return { count: rows.length, rows };
      },
    }),
  ],
};

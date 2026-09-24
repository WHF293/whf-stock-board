/**
 * 内置 MCP：financial-data（财务数据工具集）
 *
 * 把东财 datacenter 报表（src/api/financial.api.ts）封装成 MCP 工具供 Agent 调用：
 * 财务摘要（营收/净利/增速/EPS/ROE/毛利率）、资产负债表与现金流量表关键科目、业绩预告。
 * 填补 stock_research_analyst「财务质量 / 估值 / 基本面研究」的工具缺口。
 *
 * 设计约束（延续既有约定）：
 * - 全部为**只读**工具（不落库、不改状态、无 UI 卡片）；
 * - 结果只走 `content[0].text` 通道，行数按 periods 截断（上限 12 期）控制 token；
 * - ⚠️ 上游 200 ≠ 有数据：未披露返回 `count: 0`，由子 agent 按「该维度数据不可得」处理，
 *   业绩预告空返回不能解读为「公司没有变化」；
 * - 金额单位一律元、比率单位一律 %（原始口径，不换算），返回体带 unit 说明。
 *
 * 本服务器为**内置 MCP**：不可删除、不可编辑，随应用常驻
 */
import { z } from 'zod';
import {
  fetchBalanceSheetDigest,
  fetchCashFlowDigest,
  fetchFinancialSummary,
  fetchProfitForecast,
} from '../../api/financial.api';
import { EM_FINANCIAL_MAX_PERIODS } from '../../constants/financial.constants';
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

/** 报告期入参 schema（四个工具共用） */
const PERIODS_SCHEMA = z
  .number()
  .int()
  .min(1)
  .max(EM_FINANCIAL_MAX_PERIODS)
  .optional()
  .describe('返回最近 N 个报告期（默认 6，最大 12），按报告期倒序（最新在前）');

/** 内置「financial-data」MCP 服务器 */
export const FINANCIAL_DATA_MCP_SERVER: BuiltinMcpServer = {
  id: BUILTIN_MCP_IDS.financialData,
  key: 'financial-data',
  name: '财务数据（内置）',
  description:
    '上市公司财务数据（东财 datacenter）：财务摘要（营收/归母净利/同比环比/EPS/ROE/毛利率）、资产负债表与现金流量表关键科目、业绩预告',
  tools: [
    entry({
      name: 'get_financial_summary',
      description:
        '获取单只 A 股的财务摘要（按报告期倒序）：营业总收入、归母净利润及同比/环比增速、基本/扣非 EPS、每股净资产、加权 ROE、销售毛利率、每股经营现金流、分红预案、所属行业。用于基本面研究（成长性 / 盈利质量 / 盈利能力）。金额单位元，比率单位%',
      schema: z.object({
        symbol: z.string().describe('股票代码（600519 / sh600519 / 600519.SH 等形态）'),
        periods: PERIODS_SCHEMA,
      }),
      run: async (input) => {
        const { symbol, periods } = input as { symbol: string; periods?: number };
        const rows = await fetchFinancialSummary(String(symbol).trim(), periods);
        return { count: rows.length, rows, unit: '金额：元；比率：%' };
      },
    }),
    entry({
      name: 'get_balance_sheet',
      description:
        '获取单只 A 股的资产负债表关键科目（按报告期倒序）：总资产、总负债、股东权益、资产负债率、流动比率、货币资金、应收账款、存货、应付账款、固定资产。用于财务质量分析（杠杆 / 资产结构 / 占款）。金额单位元，比率单位%',
      schema: z.object({
        symbol: z.string().describe('股票代码（任意形态）'),
        periods: PERIODS_SCHEMA,
      }),
      run: async (input) => {
        const { symbol, periods } = input as { symbol: string; periods?: number };
        const rows = await fetchBalanceSheetDigest(String(symbol).trim(), periods);
        return { count: rows.length, rows, unit: '金额：元；比率：%' };
      },
    }),
    entry({
      name: 'get_cash_flow',
      description:
        '获取单只 A 股的现金流量表关键科目（按报告期倒序）：经营/投资/筹资活动现金流净额、销售收现、资本开支、现金净增加额。用于盈利含金量分析（净利与经营现金流是否匹配、自由现金流代理 = 经营净额 - 资本开支）。金额单位元',
      schema: z.object({
        symbol: z.string().describe('股票代码（任意形态）'),
        periods: PERIODS_SCHEMA,
      }),
      run: async (input) => {
        const { symbol, periods } = input as { symbol: string; periods?: number };
        const rows = await fetchCashFlowDigest(String(symbol).trim(), periods);
        return { count: rows.length, rows, unit: '金额：元' };
      },
    }),
    entry({
      name: 'get_profit_forecast',
      description:
        '获取单只 A 股的业绩预告记录（公司自行披露的营收/净利预告区间与同比增幅、预告原文；仅已披露公司有行）。⚠️ 未披露返回 count=0，不能解读为「公司没有变化」，只能写「未取得已披露的业绩预告」。金额单位元，增幅单位%',
      schema: z.object({
        symbol: z.string().describe('股票代码（任意形态）'),
        periods: PERIODS_SCHEMA,
      }),
      run: async (input) => {
        const { symbol, periods } = input as { symbol: string; periods?: number };
        const rows = await fetchProfitForecast(String(symbol).trim(), periods);
        return { count: rows.length, rows, unit: '金额：元；增幅：%' };
      },
    }),
  ],
};

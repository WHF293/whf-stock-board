import { STOCK_ANALYSIS_PROMPT_TEMPLATE } from '@/constants/agent-ask.constants';

/** 个股分析目标信息 */
export interface StockAnalysisTarget {
  /** 股票名称（未知传空串，模板里用代码兜底展示） */
  name: string;
  /** 完整代码（如 sh600519） */
  symbol: string;
}

/**
 * 组装个股「AI 分析」提示词（消息面 / 资金面 / 情绪面 / 外围 / 政策 + 多空震荡结论）
 * @param target 个股信息
 * @returns 提示词
 */
export const buildStockAnalysisPrompt = (target: StockAnalysisTarget): string =>
  STOCK_ANALYSIS_PROMPT_TEMPLATE.replace('{name}', target.name || target.symbol).replace(
    '{symbol}',
    target.symbol,
  );

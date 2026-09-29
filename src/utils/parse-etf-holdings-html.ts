import {
  ETF_JJCC_CONTENT_PREFIX,
  ETF_JJCC_CONTENT_SUFFIX,
  ETF_VALUE_PLACEHOLDER,
} from '../constants/etf.constants';
import type { EtfHoldingItem } from '../types/etf.types';

/**
 * 天天基金 jjcc（基金持仓）响应解析：`var apidata={ content:"<html 表格>"… }` → 结构化持仓
 *
 * content 内含当年各季度一张表，第一张即最新报告期；
 * 列序固定：序号 / 股票代码 / 股票名称 / 最新价 / 涨跌幅 / 相关资讯 / 占净值比例 / 持股数(万股) / 持仓市值(万元)
 */

/** 报告截止日提取（`截止至：<font class='px12'>2026-06-30</font>`） */
const REPORT_DATE_RE = /截止至：<font[^>]*>(\d{4}-\d{2}-\d{2})<\/font>/;

/** 数据行最少单元格数（9 列表格；资讯列可能合并缺失，留 1 列余量） */
const MIN_ROW_CELLS = 8;

/** 报告期列在表格里的下标 */
const CELL_INDEX = {
  code: 1,
  name: 2,
  price: 3,
  changePercent: 4,
  netValueRatio: 6,
  holdShares: 7,
  holdMarketValue: 8,
} as const;

/**
 * 宽松数值转换（`-` / 空串 / 非数值统一为 null）
 * @param text 单元格文本
 * @returns 数值或 null
 */
const toNullableNumber = (text: string): number | null => {
  const trimmed = text.trim().replace(/%$/, '');
  if (!trimmed || trimmed === ETF_VALUE_PLACEHOLDER) return null;
  const parsed = Number(trimmed.replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * 提取 jjcc 变量声明里的 content 字符串
 * @param raw 响应原文（含 JS 壳）
 * @returns HTML 片段（未匹配时为空串）
 */
const extractContent = (raw: string): string => {
  const start = raw.indexOf(ETF_JJCC_CONTENT_PREFIX);
  if (start < 0) return '';
  const from = start + ETF_JJCC_CONTENT_PREFIX.length;
  const end = raw.indexOf(ETF_JJCC_CONTENT_SUFFIX, from);
  return end < 0 ? '' : raw.slice(from, end);
};

/**
 * 解析 jjcc 响应为最新报告期的持仓列表
 * @param raw 响应原文（GBK 解码后的 JS 变量声明文本）
 * @returns 报告截止日 + 持仓条目（按占净值比例降序，即上游披露顺序）
 */
export const parseEtfHoldingsHtml = (
  raw: string,
): { reportDate: string; holdings: EtfHoldingItem[] } => {
  const html = extractContent(raw);
  if (!html) return { reportDate: '', holdings: [] };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const reportDate = REPORT_DATE_RE.exec(html)?.[1] ?? '';
  const table = doc.querySelector('table');
  if (!table) return { reportDate, holdings: [] };
  const holdings: EtfHoldingItem[] = [];
  for (const tr of table.querySelectorAll('tr')) {
    const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent?.trim() ?? '');
    if (cells.length < MIN_ROW_CELLS) continue;
    const symbol = cells[CELL_INDEX.code] ?? '';
    if (!/^\d{6}$/.test(symbol)) continue;
    holdings.push({
      symbol,
      name: cells[CELL_INDEX.name] ?? '',
      price: toNullableNumber(cells[CELL_INDEX.price] ?? ''),
      changePercent: toNullableNumber(cells[CELL_INDEX.changePercent] ?? ''),
      netValueRatio: toNullableNumber(cells[CELL_INDEX.netValueRatio] ?? ''),
      holdShares: toNullableNumber(cells[CELL_INDEX.holdShares] ?? ''),
      holdMarketValue: toNullableNumber(cells[CELL_INDEX.holdMarketValue] ?? ''),
    });
  }
  return { reportDate, holdings };
};

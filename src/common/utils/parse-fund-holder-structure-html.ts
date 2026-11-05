import {
  ETF_JJCC_CONTENT_PREFIX,
  ETF_VALUE_PLACEHOLDER,
} from '../constants/etf.constants.ts';
import type { FundHolderStructureRecord } from '../types/huijin-etf-flow.types.ts';

/**
 * 天天基金 f10「持有人结构」响应解析：`var apidata={ content:"<html 表格>"… }` → 结构化记录
 *
 * cyrjg 与 jjcc 同域同前缀壳（FundArchivesDatas.aspx），content 为单张表格，
 * 收尾是 `",summary:"`（与 jjcc 的 `",arryear:` 不同，2026-11-06 实测）；
 * 列序固定：公告日期 / 机构持有比例 / 个人持有比例 / 内部持有比例 / 总份额（亿份），
 * 首行即最近报告期（季报披露口径）
 */

/** 数据行单元格数（5 列；缺列即坏行丢弃） */
const CYRJG_ROW_CELLS = 5;

/** cyrjg 响应体收尾（`",summary:"`） */
const CYRJG_CONTENT_SUFFIX = '",summary:"';

/** 单元格下标（列序固定，见文件头） */
const CYRJG_CELL_INDEX = {
  reportDate: 0,
  institutionalRatioPct: 1,
  personalRatioPct: 2,
  internalRatioPct: 3,
  totalSharesYi: 4,
} as const;

/** 日期列合法形态（YYYY-MM-DD） */
const CYRJG_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 宽松数值转换（`-` / 空串 / 非数值统一为 null，剥百分号；比例列与亿份列共用）
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
 * 提取 cyrjg 变量声明里的 content 字符串（壳前缀与 jjcc 相同，收尾是 `",summary:"`）
 * @param raw 响应原文（含 JS 壳）
 * @returns HTML 片段（未匹配时为空串）
 */
const extractCyrjgContent = (raw: string): string => {
  const start = raw.indexOf(ETF_JJCC_CONTENT_PREFIX);
  if (start < 0) return '';
  const from = start + ETF_JJCC_CONTENT_PREFIX.length;
  const end = raw.indexOf(CYRJG_CONTENT_SUFFIX, from);
  return end < 0 ? '' : raw.slice(from, end);
};

/**
 * 从 HTML 表格提取 tbody 首行各单元格文本（最近报告期行）
 * @param html cyrjg content HTML 片段
 * @returns 单元格文本数组（无有效行时为空数组）
 */
const extractFirstRowCells = (html: string): string[] => {
  const tbodyStart = html.indexOf('<tbody>');
  const tbody = tbodyStart >= 0 ? html.slice(tbodyStart) : html;
  const trStart = tbody.indexOf('<tr>');
  if (trStart < 0) return [];
  const trEnd = tbody.indexOf('</tr>', trStart);
  if (trEnd < 0) return [];
  const row = tbody.slice(trStart + '<tr>'.length, trEnd);
  return [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) =>
    match[1]!.replace(/<[^>]*>/g, '').trim(),
  );
};

/**
 * 解析 cyrjg 响应为最近报告期的持有人结构
 * @param raw 响应原文（UTF-8 解码后的 JS 变量声明文本）
 * @returns 报告期 + 机构/个人/内部持有比例 + 期末总份额（亿份）；无有效行返回 null
 */
export const parseFundHolderStructureHtml = (
  raw: string,
): FundHolderStructureRecord | null => {
  const cells = extractFirstRowCells(extractCyrjgContent(raw));
  if (cells.length < CYRJG_ROW_CELLS) return null;
  const reportDate = cells[CYRJG_CELL_INDEX.reportDate] ?? '';
  if (!CYRJG_DATE_RE.test(reportDate)) return null;
  return {
    reportDate,
    institutionalRatioPct: toNullableNumber(
      cells[CYRJG_CELL_INDEX.institutionalRatioPct] ?? '',
    ),
    personalRatioPct: toNullableNumber(cells[CYRJG_CELL_INDEX.personalRatioPct] ?? ''),
    internalRatioPct: toNullableNumber(cells[CYRJG_CELL_INDEX.internalRatioPct] ?? ''),
    totalSharesYi: toNullableNumber(cells[CYRJG_CELL_INDEX.totalSharesYi] ?? ''),
  };
};

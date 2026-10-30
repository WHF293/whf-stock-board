import { normalizeHkCode } from './normalize-hk-code';
import type { ThsHkStockRow } from '../types/ths-market.types.ts';

/**
 * 解析同花顺港股板块「个股行情」ajax HTML 片段为行清单（纯函数，可被冒烟直跑）
 *
 * 片段结构（GBK 解码后）：`table.m-table.m-pager-table` 下唯一 tbody，每行 13 个 td：
 * 0 序号 / 1 代码（a 内文本，`HK2715` / `K81810` 等非 6 位形态） / 2 名称 / 3 现价 /
 * 4 涨跌幅 / 5 涨跌 / 6 换手 / 7 成交量 / 8 市盈率 / 9 昨收 / 10 开盘价 / 11 最高价 / 12 最低价。
 * 数值缺失上游以空串表示、市盈率亏损以「亏损」表示 → 数值列归 null、文案列留原文。
 *
 * **不复用 A 股解析器**（parseThsStockBoardHtml）：列数（13 vs 14）、代码形态
 * （HK 前缀 vs 6 位纯数字）都不同，参数化会互相耦合
 * @param html GBK 解码后的片段 HTML
 * @returns 解析结果：rows 保持页面顺序；totalPages 取片段分页器 page 属性最大值
 */

/**
 * 单元格文本清理：去标签、去空白实体
 * @param raw 单元格原始 HTML
 * @returns 清理后的文本
 */
const cleanCell = (raw: string): string =>
  raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 数值单元格解析
 * @param raw 单元格原始 HTML
 * @returns 数值；空串 / 非法为 null
 */
const toNumber = (raw: string): number | null => {
  const text = cleanCell(raw);
  if (text === '') return null;
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};

/** 分页器页码属性的全局匹配（取最大值 = 总页数） */
const PAGE_ATTR_RE = /page="(\d+)"/g;

/**
 * 解析入口（见文件头注释）
 * @param html GBK 解码后的片段 HTML
 * @returns 当页行清单与总页数（解析不到表体时 rows 为空、totalPages 为 null）
 */
export const parseThsHkBoardHtml = (
  html: string,
): { rows: ThsHkStockRow[]; totalPages: number | null } => {
  const bodyMatch = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  const rows: ThsHkStockRow[] = [];
  if (bodyMatch) {
    const trs = bodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    for (const row of trs) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
      if (cells.length < 13) continue;
      const td = (index: number): string =>
        /<td[^>]*>([\s\S]*?)<\/td>/.exec(cells[index])?.[1] ?? '';
      const rawCode = cleanCell(td(1));
      const code = normalizeHkCode(rawCode);
      if (code === '') continue;
      rows.push({
        seq: toNumber(td(0)) ?? 0,
        rawCode,
        code,
        name: cleanCell(td(2)),
        price: toNumber(td(3)),
        changePercent: toNumber(td(4)),
        change: toNumber(td(5)),
        turnoverRate: toNumber(td(6)),
        volumeText: cleanCell(td(7)) || '--',
        peText: cleanCell(td(8)) || '--',
        prevClose: toNumber(td(9)),
        open: toNumber(td(10)),
        high: toNumber(td(11)),
        low: toNumber(td(12)),
      });
    }
  }
  let totalPages: number | null = null;
  for (const match of html.matchAll(PAGE_ATTR_RE)) {
    const page = Number(match[1]);
    if (Number.isFinite(page) && (totalPages === null || page > totalPages)) {
      totalPages = page;
    }
  }
  return { rows, totalPages };
};

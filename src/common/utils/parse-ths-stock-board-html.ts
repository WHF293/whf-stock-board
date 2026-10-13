import type { ThsStockRow } from '../types/ths-market.types.ts';

/**
 * 解析同花顺行情中心「个股行情」ajax HTML 片段为行清单（纯函数，可被冒烟直跑）
 *
 * 片段结构（GBK 解码后）：`table.m-table.m-pager-table` 下唯一 tbody，每行 14 个 td：
 * 0 序号 / 1 代码（a 内文本） / 2 名称 / 3 现价 / 4 涨跌幅 / 5 涨跌 / 6 涨速 /
 * 7 换手 / 8 量比 / 9 振幅 / 10 成交额 / 11 流通股 / 12 流通市值 / 13 市盈率。
 * 数值缺失上游以空串表示、市盈率亏损以「亏损」表示 → 数值列归 null、文案列留原文；
 * 涨跌着色由上游 c-rise / c-fall class 表达（本解析不消费，UI 按数值正负着色）
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
export const parseThsStockBoardHtml = (
  html: string,
): { rows: ThsStockRow[]; totalPages: number | null } => {
  const bodyMatch = /<tbody>([\s\S]*?)<\/tbody>/.exec(html);
  const rows: ThsStockRow[] = [];
  if (bodyMatch) {
    const trs = bodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) ?? [];
    for (const row of trs) {
      const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
      if (cells.length < 14) continue;
      const td = (index: number): string =>
        /<td[^>]*>([\s\S]*?)<\/td>/.exec(cells[index])?.[1] ?? '';
      const code = cleanCell(td(1)).match(/\d{6}/)?.[0] ?? '';
      if (code === '') continue;
      rows.push({
        seq: toNumber(td(0)) ?? 0,
        code,
        name: cleanCell(td(2)),
        price: toNumber(td(3)),
        changePercent: toNumber(td(4)),
        change: toNumber(td(5)),
        speed: toNumber(td(6)),
        turnoverRate: toNumber(td(7)),
        volumeRatio: toNumber(td(8)),
        amplitude: toNumber(td(9)),
        amountText: cleanCell(td(10)) || '--',
        floatSharesText: cleanCell(td(11)) || '--',
        floatMarketCapText: cleanCell(td(12)) || '--',
        peText: cleanCell(td(13)) || '--',
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

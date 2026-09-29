import type { BlockTradeDetailItem } from '../types/dragon-tiger.types';

/**
 * 解析同花顺大宗交易页（data.10jqka.com.cn/market/dzjy）HTML 为大宗明细（纯函数，可被冒烟直跑）
 *
 * 页面结构（GBK 解码后）：`table.J-ajax-table` 的 tbody，每行 10 个 `td`：
 * 0 序号 / 1 交易日期（YYYY-MM-DD）/ 2 股票代码（a.stockCode）/ 3 股票简称 /
 * 4 最新价 / 5 成交价格 / 6 成交量（万股）/ 7 溢价率（-9.40% 形态）/
 * 8 买方营业部 / 9 卖方营业部。
 * 首页与 ajax 翻页（ajax/1/free/1）返回的都是同一张表结构，共用本解析
 * @param html GBK 解码后的页面 HTML（首页或 ajax 分页片段均可）
 * @returns 大宗明细列表（保持页面顺序：交易日期降序）
 */

/**
 * 单元格文本清理：去标签、去空白、去 &nbsp;
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
 * 「-」与空串视为缺失
 * @param raw 单元格原始 HTML
 * @returns 数值；缺失或非法为 null
 */
const toNumber = (raw: string): number | null => {
  const text = cleanCell(raw);
  if (text === '' || text === '-') return null;
  const value = Number(text.replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
};

/**
 * 溢价率单元格（「-9.40%」形态）→ 数值
 * @param raw 单元格原始 HTML
 * @returns 百分数值；缺失或非法为 null
 */
const toPercent = (raw: string): number | null => {
  const text = cleanCell(raw).replace('%', '');
  if (text === '' || text === '-') return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
};

/**
 * 解析入口（见文件头注释）
 * @param html GBK 解码后的页面 HTML
 * @returns 大宗明细列表
 */
export const parseThsBlockTradeHtml = (html: string): BlockTradeDetailItem[] => {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/g) ?? [];
  const items: BlockTradeDetailItem[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
    if (cells.length < 10) continue;
    const td = (index: number): string =>
      /<td[^>]*>([\s\S]*?)<\/td>/.exec(cells[index])?.[1] ?? '';
    const date = cleanCell(td(1));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const codeMatch = /class="stockCode"[^>]*>(\d{6})</.exec(td(2));
    const code = codeMatch?.[1] ?? cleanCell(td(2));
    if (!/^\d{6}$/.test(code)) continue;
    const dealPrice = toNumber(td(5));
    // 上游成交量单位为万股，换算为股（与 stock-sdk 口径一致）
    const volumeWan = toNumber(td(6));
    const dealVolume = volumeWan === null ? null : Math.round(volumeWan * 10_000);
    items.push({
      code,
      name: cleanCell(td(3)),
      date,
      close: toNumber(td(4)),
      // 同花顺大宗页无涨跌幅列，置 null（展示层按缺失降级）
      changePercent: null,
      dealPrice,
      dealVolume,
      // 成交额上游不直接给出：成交价 × 成交量推算
      dealAmount:
        dealPrice !== null && dealVolume !== null ? Math.round(dealPrice * dealVolume) : null,
      premiumRate: toPercent(td(7)),
      buyBranch: cleanCell(td(8)),
      sellBranch: cleanCell(td(9)),
    });
  }
  return items;
};

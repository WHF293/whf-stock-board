import type { IpoBoardItem } from '../types/ipo-board.types.ts';

/**
 * 解析同花顺「新股申购与上市」页 HTML 为新股条目清单（纯函数，可被冒烟直跑）
 *
 * 页面结构（GBK 解码后）：`table#maintable` 下唯一 `tbody.m_tbd`，每行 18 个 `td`：
 * 0 股票代码（span.jumpToclient1 的 code 属性） / 1 股票简称 / 2 申购代码 / 3 发行总数 /
 * 4 网上发行 / 5 申购上限 / 6 顶格申购需配市值 / 7 发行价格 / 8 发行市盈率 / 9 行业市盈率 /
 * 10 申购日期（「MM-DD 周X」） / 11 中签率 / 12 中签号（内嵌配号查询 DOM，取首段日期文本） /
 * 13 中签缴款日期 / 14 上市日期 / 15 打新收益 / 16 首日最高涨幅 / 17 连板天数。
 * 数值缺失上游以「-」表示 → null；日期为「MM-DD」无年份，原样返回（年份由 inferIpoYear 补全）
 * @param html GBK 解码后的页面 HTML
 * @returns 新股条目列表（保持页面顺序；解析不到表体时为空数组）
 */

/**
 * 数值 / 日期单元格文本的清理：去标签、去空白、去「周X」后缀
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
 * 提取日期段：上游两种形态并存——已发生的日期渲染完整「YYYY-MM-DD」，
 * 未来日期渲染「MM-DD」（或「MM-DD 周X」，无年份）。统一提取后返回，
 * 「MM-DD」形态由 inferIpoYear 补全年份
 * @param raw 单元格原始 HTML
 * @returns 「YYYY-MM-DD」或「MM-DD」；无法识别为空串
 */
const toDatePart = (raw: string): string => {
  const text = cleanCell(raw);
  const full = /\d{4}-\d{2}-\d{2}/.exec(text);
  if (full) return full[0];
  const short = /(^|\s)(\d{2}-\d{2})(\s|$)/.exec(text);
  return short ? short[2] : '';
};

/**
 * 解析入口（见文件头注释）
 * @param html GBK 解码后的页面 HTML
 * @returns 新股条目列表
 */
export const parseIpoBoardHtml = (html: string): IpoBoardItem[] => {
  // 只取数据表体（页面另有无数据行的固定列表头），避免重复解析
  const bodyMatch = /<tbody class="m_tbd">([\s\S]*?)<\/tbody>/.exec(html);
  if (!bodyMatch) return [];
  const rows = bodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) ?? [];

  const items: IpoBoardItem[] = [];
  for (const row of rows) {
    const cells = row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) ?? [];
    if (cells.length < 18) continue;
    const td = (index: number): string =>
      /<td[^>]*>([\s\S]*?)<\/td>/.exec(cells[index])?.[1] ?? '';
    const code = /code="(\d{6})"/.exec(td(0))?.[1] ?? cleanCell(td(0));
    const applyDate = toDatePart(td(10));
    if (code === '' || applyDate === '') continue;
    items.push({
      code,
      name: cleanCell(td(1)),
      applyCode: cleanCell(td(2)),
      totalIssueWan: toNumber(td(3)),
      onlineIssueWan: toNumber(td(4)),
      applyCapWan: toNumber(td(5)),
      topApplyNeedWan: toNumber(td(6)),
      issuePrice: toNumber(td(7)),
      issuePe: toNumber(td(8)),
      industryPe: toNumber(td(9)),
      applyDate,
      lotteryRate: toNumber(td(11)),
      paymentDate: toDatePart(td(13)),
      listDate: toDatePart(td(14)),
      earn: toNumber(td(15)),
      firstDayMaxRise: toNumber(td(16)),
      limitUpDays: toNumber(td(17)),
    });
  }
  return items;
};

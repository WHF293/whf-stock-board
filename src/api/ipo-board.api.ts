import { proxyFetch } from './proxy-fetch';
import { IPO_BOARD_URL } from '../constants/ipo-board.constants';
import { inferIpoYear } from '../utils/infer-ipo-year';
import { parseIpoBoardHtml } from '../utils/parse-ipo-board-html';
import type { IpoBoardItem } from '../types/ipo-board.types';

/**
 * 拉取同花顺「新股申购与上市」清单（行情全景-新股次新股）
 *
 * 页面为 GBK 编码的整页 HTML（服务端渲染全量清单，约 50 行），
 * 经 proxyFetch 取原始字节后按 GBK 解码；「MM-DD」无年份的日期按「距今天最近的年份」补全
 * @returns 新股条目列表（保持页面顺序：未申购在前，按申购日期升序）
 */
export const fetchIpoBoard = async (): Promise<IpoBoardItem[]> => {
  const response = await proxyFetch(IPO_BOARD_URL, {
    headers: { Referer: 'https://data.10jqka.com.cn/ipo/' },
  });
  if (!response.ok) {
    throw new Error(`新股清单请求失败：HTTP ${response.status}`);
  }
  const html = new TextDecoder('gbk').decode(await response.arrayBuffer());
  const fillYear = (date: string): string =>
    /^\d{4}-/.test(date) ? date : inferIpoYear(date);
  return parseIpoBoardHtml(html).map((item) => ({
    ...item,
    applyDate: fillYear(item.applyDate),
    paymentDate: fillYear(item.paymentDate),
    listDate: fillYear(item.listDate),
  }));
};

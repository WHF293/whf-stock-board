import { proxyFetch } from './proxy-fetch';
import {
  THS_REFERER_Q,
  THS_STOCK_BOARD_FIELDS,
  THS_STOCK_BOARD_ORDER,
  THS_STOCK_BOARD_URL_TEMPLATE,
  type ThsStockBoard,
  type ThsStockBoardField,
} from '../constants/ths-market.constants.ts';
import { parseThsStockBoardHtml } from '../utils/parse-ths-stock-board-html';
import type { ThsStockBoardPage } from '../types/ths-market.types.ts';

/** 个股行情分页请求参数 */
export interface ThsStockBoardParams {
  /** 板块（Tab 值） */
  board: ThsStockBoard;
  /** 排序字段（表头列） */
  field: ThsStockBoardField;
  /** 排序方向 */
  order: 'asc' | 'desc';
  /** 页码（1 起） */
  page: number;
}

/**
 * 拉取同花顺行情中心「个股行情」分页片段（GBK HTML table，服务端排序 + 翻页）
 *
 * curl 实测（2026-10-13 盘中）：board=all&field=zdf&page=2 返回 18KB 完整
 * `m-table m-pager-table` 片段，每页 20 行、行序号全局连续（第 2 页 21-40），
 * 分页器节点带 page 属性（含末页页码）。解析见 parseThsStockBoardHtml。
 * 轮询频率见 THS_POLLING_INTERVAL.STOCK_BOARD；失败由调用方进错误态手动重试，
 * 不做自动重试轰炸（同花顺对高频有风控先例）
 * @param params 板块 / 排序字段 / 方向 / 页码
 * @returns 当页行 + 当前页码 + 总页数（totalPages 解析不到为 null）
 */
export const fetchThsStockBoardPage = async (
  params: ThsStockBoardParams,
): Promise<ThsStockBoardPage> => {
  const url = THS_STOCK_BOARD_URL_TEMPLATE.replace(
    '{board}',
    params.board,
  )
    .replace('{field}', THS_STOCK_BOARD_FIELDS[params.field])
    .replace('{order}', params.order === 'asc' ? THS_STOCK_BOARD_ORDER.ASC : THS_STOCK_BOARD_ORDER.DESC)
    .replace('{page}', String(Math.max(1, params.page)));
  const response = await proxyFetch(url, {
    headers: { Referer: THS_REFERER_Q },
  });
  if (!response.ok) {
    throw new Error(`个股行情请求失败：HTTP ${response.status}`);
  }
  const html = new TextDecoder('gbk').decode(await response.arrayBuffer());
  const parsed = parseThsStockBoardHtml(html);
  return {
    rows: parsed.rows,
    page: Math.max(1, params.page),
    totalPages: parsed.totalPages,
  };
};

import { proxyFetch } from './proxy-fetch';
import {
  THS_HK_BOARD_URL_TEMPLATE,
  THS_HK_STOCK_BOARD_FIELDS,
  THS_STOCK_BOARD_ORDER,
  THS_REFERER_Q,
  type ThsHkStockBoardField,
} from '../constants/ths-market.constants.ts';
import { parseThsHkBoardHtml } from '../utils/parse-ths-hk-board-html';
import type { ThsHkStockBoardPage } from '../types/ths-market.types.ts';

/** 港股个股行情分页请求参数（board 仅 all 一档，无需入参） */
export interface ThsHkStockBoardParams {
  /** 排序字段（表头列） */
  field: ThsHkStockBoardField;
  /** 排序方向 */
  order: 'asc' | 'desc';
  /** 页码（1 起） */
  page: number;
}

/**
 * 拉取同花顺港股板块「个股行情」分页片段（GBK HTML table，服务端排序 + 翻页）
 *
 * curl 实测（2026-10-30）：field=zdf&page=1 返回完整 `m-table m-pager-table`
 * 片段，每页 50 行，分页器节点带 page 属性（含末页页码，全市场 ≈51 页）。
 * 代码列为 HK2715 / K81810 等非 6 位形态，解析时经 normalizeHkCode 归一化为
 * `hk02715`（腾讯符号，可直接打开详情）。解析见 parseThsHkBoardHtml。
 * 轮询频率沿用 THS_POLLING_INTERVAL.STOCK_BOARD；失败由调用方进错误态手动重试，
 * 不做自动重试轰炸（同花顺对高频有风控先例）
 * @param params 排序字段 / 方向 / 页码
 * @returns 当页行 + 当前页码 + 总页数（totalPages 解析不到为 null）
 */
export const fetchThsHkBoardPage = async (
  params: ThsHkStockBoardParams,
): Promise<ThsHkStockBoardPage> => {
  const url = THS_HK_BOARD_URL_TEMPLATE.replace(
    '{field}',
    THS_HK_STOCK_BOARD_FIELDS[params.field],
  )
    .replace(
      '{order}',
      params.order === 'asc' ? THS_STOCK_BOARD_ORDER.ASC : THS_STOCK_BOARD_ORDER.DESC,
    )
    .replace('{page}', String(Math.max(1, params.page)));
  const response = await proxyFetch(url, {
    headers: { Referer: THS_REFERER_Q },
  });
  if (!response.ok) {
    throw new Error(`港股个股行情请求失败：HTTP ${response.status}`);
  }
  const html = new TextDecoder('gbk').decode(await response.arrayBuffer());
  const parsed = parseThsHkBoardHtml(html);
  return {
    rows: parsed.rows,
    page: Math.max(1, params.page),
    totalPages: parsed.totalPages,
  };
};

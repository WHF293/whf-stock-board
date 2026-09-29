import dayjs from 'dayjs';
import { isTauri } from '@tauri-apps/api/core';
import {
  BLOCK_TRADE_RANGE_DAYS,
  DRAGON_TIGER_RANGE_DAYS,
  THS_BLOCK_TRADE_AJAX_URL,
  THS_BLOCK_TRADE_MAX_PAGES,
  THS_BLOCK_TRADE_PAGE_URL,
  THS_REQUEST_GAP_MS,
} from '../constants/dragon-tiger.constants';
import { delay } from '../utils/delay';
import { parseThsBlockTradeHtml } from '../utils/parse-ths-block-trade-html';
import type { BlockTradeDetailItem, DragonTigerDetailItem } from '../types/dragon-tiger.types';
import { proxyFetch } from './proxy-fetch';
import { sdk } from './sdk';

/**
 * 拉取龙虎榜明细（东财源，近 N 日区间）
 *
 ⚠️ 重接口：仅在进入页面或切换日期时拉取，不参与轮询
 * @returns 龙虎榜上榜明细（多日，按 date 字段区分）
 */
export const fetchDragonTigerDetail = async (): Promise<DragonTigerDetailItem[]> =>
  sdk.dragonTiger.detail({
    startDate: dayjs().subtract(DRAGON_TIGER_RANGE_DAYS, 'day').format('YYYYMMDD'),
    endDate: dayjs().format('YYYYMMDD'),
  });

/**
 * 会话 cookie（仅 Tauri 直连用）：同花顺 ajax 翻页接口无 cookie 时返回反爬挑战页
 *
 * 浏览器侧无需关心——/stock-proxy 中间件对 dzjy 目标自动注入会话 cookie
 */
let thsCookie = '';

/**
 * 从大宗交易主页收集 set-cookie（仅 Tauri；浏览器侧响应经中间件已剥离该头且不需要）
 * @returns 是否成功取得 cookie
 */
const ensureThsCookie = async (): Promise<boolean> => {
  if (thsCookie !== '') return true;
  const res = await proxyFetch(THS_BLOCK_TRADE_PAGE_URL, {
    headers: { Referer: 'https://data.10jqka.com.cn/' },
  });
  const pairs = (res.headers.getSetCookie?.() ?? [])
    .map((cookie) => cookie.split(';')[0])
    .filter((pair) => pair.includes('='));
  if (pairs.length === 0) return false;
  thsCookie = pairs.join('; ');
  return true;
};

/**
 * 拉取一页大宗交易清单并解析（命中反爬挑战页时重取会话 cookie 重试一次）
 * @param url 页面地址（首页或 ajax 分页）
 * @param isAjax 是否为 ajax 分页请求（需携带 XMLHttpRequest 头与会话 cookie）
 * @returns 明细列表；重试后仍为挑战页时抛错
 */
const fetchPage = async (url: string, isAjax: boolean): Promise<BlockTradeDetailItem[]> => {
  const request = async (): Promise<BlockTradeDetailItem[]> => {
    const headers: Record<string, string> = {
      Referer: THS_BLOCK_TRADE_PAGE_URL,
    };
    if (isAjax) {
      headers['X-Requested-With'] = 'XMLHttpRequest';
      if (isTauri() && thsCookie !== '') {
        headers.Cookie = thsCookie;
      }
    }
    const res = await proxyFetch(url, { headers });
    if (!res.ok) {
      throw new Error(`大宗交易清单请求失败：HTTP ${res.status}`);
    }
    const html = new TextDecoder('gbk').decode(await res.arrayBuffer());
    return parseThsBlockTradeHtml(html);
  };
  let items = await request();
  if (items.length === 0) {
    // 200 但无表格 = 同花顺反爬挑战页：会话 cookie 失效，重取后重试一次
    thsCookie = '';
    if (isAjax) {
      await ensureThsCookie();
    }
    items = await request();
  }
  if (items.length === 0) {
    throw new Error('大宗交易清单响应无数据（反爬挑战页）');
  }
  return items;
};

/**
 * 拉取大宗交易明细（同花顺源 data.10jqka.com.cn/market/dzjy，近 N 日区间）
 *
 * 东财同口径接口长期无数据，改走同花顺：主页渲染第一页（50 行），
 * 更早分页走 ajax 翻页接口，按日期升序回翻到覆盖 BLOCK_TRADE_RANGE_DAYS 为止；
 * ajax 接口需会话 cookie（浏览器由代理中间件注入，Tauri 由本模块自行收集携带）
 *
 ⚠️ 重接口：仅在进入页面或切换日期时拉取，不参与轮询；翻页串行错峰
 * @returns 大宗交易成交明细（多日，按 date 字段区分，日期降序）
 */
export const fetchBlockTradeDetail = async (): Promise<BlockTradeDetailItem[]> => {
  const cutoff = dayjs().subtract(BLOCK_TRADE_RANGE_DAYS, 'day').format('YYYY-MM-DD');
  await ensureThsCookie();

  // 首页即第一页（服务端渲染全表，省一次请求）
  const firstPage = await fetchPage(THS_BLOCK_TRADE_PAGE_URL, false);
  const items: BlockTradeDetailItem[] = [...firstPage];

  // 从第二页起翻页：页内最旧日期已早于截断日即停止（页面按日期降序）
  for (let page = 2; page <= THS_BLOCK_TRADE_MAX_PAGES; page += 1) {
    const oldest = items.at(-1)?.date ?? '';
    if (oldest !== '' && oldest < cutoff) break;
    await delay(THS_REQUEST_GAP_MS);
    const nextPage = await fetchPage(
      `${THS_BLOCK_TRADE_AJAX_URL}/page/${page}/ajax/1/free/1/`,
      true,
    );
    items.push(...nextPage);
  }

  return items.filter((item) => item.date >= cutoff);
};

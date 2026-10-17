import dayjs from 'dayjs';
import { proxyFetch } from './proxy-fetch';
import type { HotNewsItem } from './news.api.ts';
import type { StockAnnouncement } from '../types/stock-news.types.ts';
import { stripJsonp } from '../utils/strip-jsonp';

/**
 * 个股关联资讯（公告 + 个股新闻）· 东财源，经同源代理转发
 *
 * 两个上游 2026-10-17 实测连通（冒烟记录见 .ai/memory/2026-10-17.md）：
 * - 公告：np-anotice-stock.eastmoney.com（XHR JSON，POST 免签）；
 * - 个股新闻：search-api-web.eastmoney.com JSONP 搜索接口，按 6 位代码精确搜
 *   （返回条目的正文几乎都含代码，杂讯少；无按 code 精确过滤字段，接受该口径）；
 * - 两域命中白名单 `eastmoney.com` 后缀（proxy.constants.ts），零白名单改动。
 *
 * 低频口径：进详情拉一次 + 手动刷新，**不做轮询**（资讯不是行情，别给上游加压）。
 */

/** 公告接口原始条目（仅取展示所需字段，其余忽略） */
interface EmAnnouncementRaw {
  /** 公告标题 */
  title?: string;
  /** 公告日期（`YYYY-MM-DD HH:mm:ss` 形态） */
  notice_date?: string;
  /** 公告唯一码（详情页 URL 组装用） */
  art_code?: string;
}

/** 公告接口响应壳 */
interface EmAnnouncementResponse {
  data?: {
    list?: EmAnnouncementRaw[];
  };
}

/** 个股新闻搜索原始条目 */
interface EmStockNewsRaw {
  /** 新闻唯一码 */
  code?: string;
  /** 标题（含 `<em>` 高亮标签，需清理） */
  title?: string;
  /** 摘要（含 `<em>` 标签） */
  content?: string;
  /** 发布时间（`YYYY-MM-DD HH:mm:ss`） */
  date?: string;
  /** 原文链接 */
  url?: string;
  /** 来源媒体 */
  mediaName?: string;
}

/** 个股新闻搜索响应壳 */
interface EmStockNewsResponse {
  result?: {
    cmsArticleWebOld?: EmStockNewsRaw[];
  };
}

/** 公告详情页链接模板（与官网一致的静态路由） */
const ANNOUNCEMENT_URL_TEMPLATE =
  'https://data.eastmoney.com/notices/detail/{code}/{artCode}.html';

/** 个股新闻单次条数 */
const STOCK_NEWS_PAGE_SIZE = 20;

/**
 * 清理东财搜索接口标题 / 摘要里的 `<em>` 高亮标签
 * @param text 原始文本
 * @returns 去标签文本
 */
const stripEmTags = (text: string): string => text.replaceAll('<em>', '').replaceAll('</em>', '');

/**
 * 归一化出 6 位代码（`sh600519` / `600519` 均可）
 * @param symbol 完整符号或 6 位代码
 * @returns 6 位代码
 */
const toSixDigitCode = (symbol: string): string => symbol.replace(/^\D*/, '').slice(0, 6);

/**
 * 拉取个股公告列表（东财 np-anotice-stock，最新在前）
 * @param symbol 个股符号（sh600519 / 600519 形态均可）
 * @returns 公告条目（最多 20 条；标题缺失的脏数据已剔除）
 */
export const fetchStockAnnouncements = async (
  symbol: string,
): Promise<StockAnnouncement[]> => {
  const code = toSixDigitCode(symbol);
  const url =
    'https://np-anotice-stock.eastmoney.com/api/security/ann' +
    `?sr=-1&page_size=${STOCK_NEWS_PAGE_SIZE}&page_index=1&ann_type=A&stock_list=${code}`;
  const response = await proxyFetch(url);
  if (!response.ok) {
    throw new Error(`东财公告请求失败：${response.status}`);
  }
  const payload = JSON.parse(await response.text()) as EmAnnouncementResponse;
  return (payload.data?.list ?? [])
    .filter((item): item is EmAnnouncementRaw & { title: string; art_code: string } =>
      Boolean(item.title && item.art_code),
    )
    .map((item) => ({
      title: item.title,
      date: dayjs(item.notice_date ?? '').format('YYYY-MM-DD'),
      url: ANNOUNCEMENT_URL_TEMPLATE.replace('{code}', code).replace('{artCode}', item.art_code),
    }));
};

/**
 * 拉取个股关联新闻（东财搜索接口按代码关键词；最新在前）
 * @param symbol 个股符号（sh600519 / 600519 形态均可）
 * @returns 新闻条目（HotNewsItem 口径，最多 20 条）
 */
export const fetchStockNews = async (symbol: string): Promise<HotNewsItem[]> => {
  const code = toSixDigitCode(symbol);
  const param = JSON.stringify({
    uid: '',
    keyword: code,
    type: ['cmsArticleWebOld'],
    client: 'web',
    clientType: 'web',
    clientVersion: 'curr',
    param: {
      cmsArticleWebOld: {
        searchScope: 'default',
        sort: 'default',
        pageIndex: 1,
        pageSize: STOCK_NEWS_PAGE_SIZE,
        preTag: '<em>',
        postTag: '</em>',
      },
    },
  });
  const url = `https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=${encodeURIComponent(param)}`;
  const response = await proxyFetch(url, {
    headers: { Referer: 'https://so.eastmoney.com/' },
  });
  if (!response.ok) {
    throw new Error(`东财个股新闻请求失败：${response.status}`);
  }
  const payload = JSON.parse(stripJsonp(await response.text())) as EmStockNewsResponse;
  return (payload.result?.cmsArticleWebOld ?? [])
    .filter((item): item is EmStockNewsRaw & { title: string; url: string } =>
      Boolean(item.title && item.url),
    )
    .map((item) => ({
      oid: item.code ?? item.url,
      title: stripEmTags(item.title),
      summary: stripEmTags(item.content ?? ''),
      url: item.url,
      ctime: item.date ? String(dayjs(item.date).unix()) : '',
      media: item.mediaName || '东方财富',
      img: '',
    }));
};

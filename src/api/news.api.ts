import { proxyFetch } from './proxy-fetch';

/**
 * 新浪财经滚动热点新闻（feed.mix.sina.com.cn，非官方接口；文档见 .ai/项目资源/新浪新闻接口文档.md）
 *
 * 后续接入东财 / 同花顺 / 雪球等源时在各自函数扩展，页面层按源 tab 分发
 */

/** 热点新闻条目 */
export interface HotNewsItem {
  /** 新闻唯一 ID（去重用） */
  oid: string;
  title: string;
  summary: string;
  /** 原文 H5 链接 */
  url: string;
  /** 发布时间（秒级 Unix 时间戳字符串） */
  ctime: string;
  /** 来源媒体 */
  media: string;
  /** 缩略图（空串为无图） */
  img: string;
}

/** 新浪频道 lid：2516 财经综合热点 / 2517 股市快讯 */
export type SinaNewsLid = 2516 | 2517;

/** 新浪接口响应（仅取渲染所需字段） */
interface SinaNewsResponse {
  result: {
    /** 实测为对象 { code, msg }（文档写数字 0 不准确），兼容两种形态 */
    status: number | { code: number; msg?: string };
    total: number;
    data: Array<{
      oid: string;
      title: string;
      summary: string;
      url: string;
      ctime: string;
      media: string;
      img: string;
    }>;
  };
}

/**
 * 判定新浪业务状态是否成功（兼容数字 0 与 { code: 0 } 对象两种形态）
 * @param status 响应 status 字段
 * @returns 是否成功
 */
const isStatusOk = (status: number | { code: number } | undefined): boolean => {
  if (status === undefined || status === null) return false;
  return typeof status === 'number' ? status === 0 : status.code === 0;
};

/**
 * 拉取新浪滚动热点新闻（单页）
 * @param page 页码（从 1 开始）
 * @param num 单页条数（上游建议 5~30）
 * @param lid 频道（默认财经综合热点）
 * @returns 新闻条目（按上游返回顺序）
 */
export const fetchSinaHotNews = async (
  page: number,
  num = 20,
  lid: SinaNewsLid = 2516,
): Promise<HotNewsItem[]> => {
  const url =
    `https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=${lid}` +
    `&num=${num}&page=${page}&k=`;
  // 浏览器态经 /stock-proxy（白名单含 sina.cn）；Tauri 态 Rust 直连（capability 含 *.sina.cn）
  const response = await proxyFetch(url, {
    headers: { Referer: 'https://finance.sina.com.cn' },
  });
  if (!response.ok) {
    throw new Error(`新浪新闻请求失败：${response.status}`);
  }
  const payload = (await response.json()) as SinaNewsResponse;
  if (!isStatusOk(payload.result?.status)) {
    throw new Error('新浪新闻业务异常');
  }
  return (payload.result.data ?? []).map((item) => ({
    oid: item.oid,
    title: item.title,
    summary: item.summary,
    url: item.url,
    ctime: item.ctime,
    media: item.media,
    img: item.img,
  }));
};

// ---------- 东方财富 7×24 快讯 ----------
// 文档中的 push2 clist 接口实测不可用；改用官方 7×24 快讯列表接口（实测 GET 直连、无需 Referer）。
// 上游无 url 字段，点击跳转用站内搜索页按标题检索；翻页为 sortEnd 游标（上一页末条的 realSort）。

/** 东财快讯翻页结果（游标式） */
export interface EastmoneyNewsPage {
  items: HotNewsItem[];
  /** 下一页游标（传回 fetchEastmoneyHotNews；null 表示没有更多） */
  nextCursor: string | null;
}

/** 东财快讯原始条目 */
interface EastmoneyFastNews {
  code: string;
  title: string;
  summary: string;
  showTime: string;
  realSort: string;
}

interface EastmoneyNewsResponse {
  code: string;
  data?: {
    sortEnd?: string;
    fastNewsList?: EastmoneyFastNews[];
  };
}

/**
 * 拉取东方财富 7×24 快讯（单页，游标翻页）
 * @param cursor 翻页游标（首页传空串）
 * @param num 单页条数
 * @returns 本页条目与下一页游标
 */
export const fetchEastmoneyHotNews = async (
  cursor: string,
  num = 20,
): Promise<EastmoneyNewsPage> => {
  const url =
    `https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web` +
    `&biz=web_724&fastColumn=102&sortEnd=${cursor}&pageSize=${num}&req_trace=${Date.now()}`;
  const response = await proxyFetch(url);
  if (!response.ok) {
    throw new Error(`东财新闻请求失败：${response.status}`);
  }
  const payload = (await response.json()) as EastmoneyNewsResponse;
  if (payload.code !== '1' || !payload.data) {
    throw new Error('东财新闻业务异常');
  }
  const items = (payload.data.fastNewsList ?? []).map((item) => ({
    oid: item.code,
    title: item.title,
    summary: item.summary,
    // 上游无原文链接：跳转东财站内搜索页按标题检索
    url: `https://so.eastmoney.com/news/s?keyword=${encodeURIComponent(item.title)}`,
    // showTime 为 "YYYY-MM-DD HH:mm:SS"，转秒级时间戳与新浪口径统一
    ctime: String(Math.floor(new Date(item.showTime.replace(/-/g, '/')).getTime() / 1000)),
    media: '东方财富',
    img: '',
  }));
  return { items, nextCursor: payload.data.sortEnd ?? null };
};

// ---------- 同花顺 课堂/快讯推送 ----------
// 文档中的 news.10jqka.com.cn/api/rollnews 实测 404，改用实测可用的 tapp/news/push/stock 接口
// （GET 直连可用；文档建议携带 Referer，带上以应对 WAF 收紧）

/** 同花顺响应（仅取渲染所需字段） */
interface ThsNewsResponse {
  code: string;
  data?: {
    list?: Array<{
      id: string;
      title: string;
      digest: string;
      url: string;
      ctime: string;
      source: string;
      picUrl: string;
    }>;
  };
}

/**
 * 拉取同花顺股市快讯（单页）
 * @param page 页码（从 1 开始）
 * @param num 单页条数
 * @returns 新闻条目
 */
export const fetchThsHotNews = async (
  page: number,
  num = 20,
): Promise<HotNewsItem[]> => {
  const url =
    `https://news.10jqka.com.cn/tapp/news/push/stock/?page=${page}` +
    `&limit=${num}&pagesize=${num}&tag=&track=website`;
  // 浏览器态经 /stock-proxy（白名单含 10jqka.com.cn）；Tauri 态 Rust 直连
  const response = await proxyFetch(url, {
    headers: { Referer: 'https://10jqka.com.cn' },
  });
  if (!response.ok) {
    throw new Error(`同花顺新闻请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThsNewsResponse;
  if (payload.code !== '200' || !payload.data) {
    throw new Error('同花顺新闻业务异常');
  }
  return (payload.data.list ?? []).map((item) => ({
    oid: item.id,
    title: item.title,
    summary: item.digest,
    url: item.url,
    ctime: item.ctime,
    media: item.source || '同花顺',
    img: item.picUrl,
  }));
};

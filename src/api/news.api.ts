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

// ---------- 澎湃新闻 财经频道 ----------
// 频道页 https://www.thepaper.cn/channel_25951 的 SSR HTML 里带 __NEXT_DATA__（首批 12 条），
// 但页面**不通过 URL 翻页**：站内走 POST /contentapi/nodeCont/getByChannelId，
// 且实测 pageNum / pageSize 之外真正生效的是 **startTime 游标**（上一页末条的毫秒时间戳），
// pageNum 传任何值都返回同一批 → 必须按 startTime 逐页取。
// ⚠️ 该接口只认 POST（GET 一律返回 code 99998「系统繁忙」），故 /stock-proxy 中间件需支持 POST 透传。
// ⚠️ 列表条目**没有摘要字段**（无 summary/brief），summary 恒为空串，卡片侧按空串隐藏该行。

/** 澎湃财经频道 ID（对应 www.thepaper.cn/channel_25951） */
const THEPAPER_FINANCE_CHANNEL_ID = '25951';

/** 澎湃频道列表接口（POST JSON） */
const THEPAPER_LIST_API =
  'https://api.thepaper.cn/contentapi/nodeCont/getByChannelId';

/** 澎湃文章详情页前缀（详情页形如 /newsDetail_forward_<contId>） */
const THEPAPER_DETAIL_BASE = 'https://www.thepaper.cn/newsDetail_forward_';

/** 澎湃翻页结果（游标式） */
export interface ThepaperNewsPage {
  items: HotNewsItem[];
  /** 下一页游标（本页 startTime 毫秒时间戳字符串；null 表示没有更多） */
  nextCursor: string | null;
}

/** 澎湃列表接口原始条目（仅取渲染所需字段） */
interface ThepaperRawItem {
  contId: string;
  name: string;
  /** 毫秒时间戳（字符串或数字两种形态都有） */
  pubTimeLong?: string | number;
  /** "YYYY-MM-DD HH:mm:SS" 形态的发布时间（pubTimeLong 缺失时兜底） */
  publishTime?: string;
  /** 站外转载的原始链接（isOutForword 为 1 时才有值） */
  link?: string;
  /** 站外转载标记（实测为字符串 "0"/"1"） */
  isOutForword?: string | number;
  /**
   * 内容类型：0 文章（频道内实测全为 0）
   * ⚠️ 同一字段在 API JSON 里是**数字** 0、在页面内联 JSON（`__NEXT_DATA__`）里是**字符串** "0"，
   * 故一律经 String() 归一化后比较，别直接与 '0' 相等比较（会把全部条目过滤掉）
   */
  contType?: string | number;
  smallPic?: string;
  pic?: string;
  nodeInfo?: {
    name?: string;
  };
}

interface ThepaperResponse {
  code: number;
  desc?: string;
  data?: {
    hasNext?: boolean;
    startTime?: number;
    list?: ThepaperRawItem[];
  };
}

/**
 * 毫秒时间戳 / "YYYY-MM-DD HH:mm:SS" 文本统一转秒级时间戳字符串
 * @param ms 毫秒时间戳（字符串或数字）
 * @param text 时间文本（毫秒值缺失时兜底解析）
 * @returns 秒级时间戳字符串（均不可解析时返回空串）
 */
const toSecondTimestamp = (
  ms: string | number | undefined,
  text?: string,
): string => {
  const value = Number(ms);
  if (Number.isFinite(value) && value > 0) {
    return String(Math.floor(value / 1000));
  }
  if (text) {
    const parsed = new Date(text.replace(/-/g, '/')).getTime();
    if (!Number.isNaN(parsed)) return String(Math.floor(parsed / 1000));
  }
  return '';
};

/**
 * 拉取澎湃财经频道新闻（单页，startTime 游标翻页）
 * @param cursor 翻页游标（首页传空串，其余传上一页返回的 nextCursor）
 * @param num 单页条数（上游实测上限 20，调大无效）
 * @returns 本页条目与下一页游标
 */
export const fetchThepaperHotNews = async (
  cursor: string,
  num = 20,
): Promise<ThepaperNewsPage> => {
  const body: Record<string, string | number> = {
    channelId: THEPAPER_FINANCE_CHANNEL_ID,
    pageNum: 1,
    pageSize: num,
  };
  if (cursor) {
    // 首页不传 startTime（传 0 会被当作时间戳边界）；后续页传上一页的游标毫秒值
    body.startTime = cursor;
  }
  const response = await proxyFetch(THEPAPER_LIST_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Referer: 'https://www.thepaper.cn/',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`澎湃新闻请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThepaperResponse;
  if (payload.code !== 200 || !payload.data) {
    throw new Error(`澎湃新闻业务异常：${payload.desc ?? payload.code}`);
  }
  const items = (payload.data.list ?? [])
    // 仅保留图文文章（contType 非 0 的条目详情页 URL 规则不同，避免生成死链）；
    // contType 在 API JSON 里是数字 0、在内联 JSON 里是字符串 "0"，统一归一化后比较
    .filter((item) => String(item.contType ?? '0') === '0')
    .map((item) => ({
      oid: item.contId,
      title: item.name,
      // 上游列表无摘要字段（实测 key 全集里没有 summary/brief）
      summary: '',
      url:
        String(item.isOutForword ?? '0') === '1' && item.link
          ? item.link
          : `${THEPAPER_DETAIL_BASE}${item.contId}`,
      // pubTimeLong 为毫秒时间戳，统一转秒级与其余源口径一致
      ctime: toSecondTimestamp(item.pubTimeLong, item.publishTime),
      // 频道名（如「牛市点线面」「金改实验室」）比站点名更有信息量
      media: item.nodeInfo?.name || '澎湃新闻',
      img: item.smallPic || item.pic || '',
    }));
  const nextCursor = payload.data.hasNext
    ? String(payload.data.startTime ?? '')
    : null;
  return { items, nextCursor: nextCursor || null };
};

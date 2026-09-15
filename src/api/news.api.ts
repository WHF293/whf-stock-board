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

// ---------- 东方财富 搜索页三模块（推荐资讯 / 今日热搜 / 领涨概念） ----------
// so.eastmoney.com 首屏的「您可能感兴趣的」「今日热搜 HOT」「领涨概念」，
// 均为 GET 直连可用（实测 2026-09）；前两个是 JSONP（返回 cb(...) 包裹，需剥壳），
// 领涨概念走行情 clist 接口（push2delay，普通 JSON）。

/**
 * 剥掉 JSONP 外壳
 * @param text 原始响应文本（形如 `cb({...})` 或 `cb([...])`）
 * @returns 内层 JSON 文本
 */
const stripJsonp = (text: string): string =>
  text.replace(/^[\w$]+\(/, '').replace(/\)\s*;?\s*$/, '');

/** 东财搜索页推荐资讯原始条目（标题 / 链接可能缺失，属脏数据） */
interface EmRecommendRaw {
  Title?: string;
  Url?: string;
  ImageUrl?: string | null;
  Id?: string;
}

/**
 * 东财搜索页「您可能感兴趣的」推荐资讯（单页，官方无翻页参数——
 * 站内翻页靠滚动会话 id，热点卡片场景一次 12 条足够）
 * @param count 条数（与官网首屏一致取 12）
 * @returns 新闻条目（上游无时间字段，ctime 为空串）
 */
export const fetchEmRecommendNews = async (count = 12): Promise<HotNewsItem[]> => {
  const url =
    `https://recommend.eastmoney.com/soapi/api/articlesearch/search` +
    `?cb=cb&count=${count}&Userid=&id=`;
  const response = await proxyFetch(url, {
    headers: { Referer: 'https://so.eastmoney.com/' },
  });
  if (!response.ok) {
    throw new Error(`东财推荐资讯请求失败：${response.status}`);
  }
  const payload = JSON.parse(stripJsonp(await response.text())) as EmRecommendRaw[];
  return (Array.isArray(payload) ? payload : [])
    // ⚠️ 类型谓词必须显式写：TS 不会从 `item.Title && item.Url` 反推窄化
    .filter((item): item is EmRecommendRaw & { Title: string; Url: string } =>
      Boolean(item.Title && item.Url),
    )
    .map((item) => ({
      oid: item.Id || item.Url || item.Title,
      title: item.Title,
      summary: '',
      url: item.Url,
      ctime: '',
      media: '东方财富',
      img: item.ImageUrl ?? '',
    }));
};

/** 东财「今日热搜」热词条目 */
export interface EmHotKeyword {
  /** 热词文本 */
  phrase: string;
  /** 是否带「新」徽标（上游 HotKeywordStatus=3） */
  isNew: boolean;
  /** 点击跳转地址（站内搜索 / 数据页） */
  url: string;
}

/**
 * 东财搜索页「今日热搜 HOT」热词榜（单页快照，官网一次 20 条）
 * @param count 条数
 * @returns 热词列表（上游顺序即热度序）
 */
export const fetchEmHotKeywords = async (count = 20): Promise<EmHotKeyword[]> => {
  // token 为 so.eastmoney.com 页面内置的公共 token（所有访客相同，非密钥）
  const url =
    `https://searchadapter.eastmoney.com/api/hotkeyword/get` +
    `?count=${count}&token=32A8A21716361A5A387B0D85259A0037&cb=cb`;
  const response = await proxyFetch(url, {
    headers: { Referer: 'https://so.eastmoney.com/' },
  });
  if (!response.ok) {
    throw new Error(`东财今日热搜请求失败：${response.status}`);
  }
  const payload = JSON.parse(stripJsonp(await response.text())) as {
    Data?: Array<{
      KeyPhrase?: string;
      /** "3" = 新上榜（页面渲染「新」徽标），其余值无特殊标记 */
      HotKeywordStatus?: string;
      JumpAddress?: string;
    }>;
  };
  return (payload.Data ?? [])
    .filter(
      (item): item is { KeyPhrase: string; HotKeywordStatus?: string; JumpAddress?: string } =>
        Boolean(item.KeyPhrase),
    )
    .map((item) => ({
      phrase: item.KeyPhrase,
      isNew: item.HotKeywordStatus === '3',
      url:
        item.JumpAddress ||
        `https://so.eastmoney.com/web/s?keyword=${encodeURIComponent(item.KeyPhrase)}`,
    }));
};

/** 东财「领涨概念」板块条目 */
export interface EmConceptLeader {
  /** 板块代码（BKxxxx） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 板块涨跌幅（%，正涨负跌） */
  chgPct: number;
  /** 领涨股名称 */
  leaderStock: string;
}

/**
 * 东财搜索页「领涨概念」榜单：概念板块按涨跌幅降序取前 N（单页快照）
 *
 * 走行情 clist 接口（push2delay；fs=m:90 t:3 = 概念板块，f:!50 剔除无涨跌幅的），
 * 字段 f12 代码 / f14 名称 / f3 涨跌幅 / f128 领涨股
 * @param count 条数（官网首屏 10 条）
 * @returns 板块列表（按涨跌幅降序）
 */
export const fetchEmLeadingConcepts = async (count = 10): Promise<EmConceptLeader[]> => {
  const url =
    `https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=${count}&po=1&np=1` +
    `&fltt=2&invt=2&fid=f3&fs=m:90+t:3+f:!50&fields=f12,f14,f3,f128`;
  const response = await proxyFetch(url, {
    headers: { Referer: 'https://so.eastmoney.com/' },
  });
  if (!response.ok) {
    throw new Error(`东财领涨概念请求失败：${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: {
      diff?: Array<{
        f12?: string;
        f14?: string;
        /** 停牌 / 无数据时上游返回 '-' */
        f3?: number | string;
        f128?: string;
      }>;
    };
  };
  return (payload.data?.diff ?? [])
    .filter(
      (
        item,
      ): item is { f12: string; f14: string; f128: string; f3?: number | string } =>
        Boolean(item.f12 && item.f14 && item.f128),
    )
    .map((item) => ({
      code: item.f12,
      name: item.f14,
      chgPct: Number(item.f3),
      leaderStock: item.f128,
    }))
    .filter((item) => Number.isFinite(item.chgPct));
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

// ---------- 澎湃 热榜（频道页右侧栏「热榜」） ----------
// 频道页 / 首页右侧栏的热榜列表，来源接口为 GET wwwIndex/rightSidebar（cache 域名）。
// ⚠️ 同路径在 api.thepaper.cn 上只有 POST 才有响应（GET 返回 99998），**cache.** 子域 GET 直连可用；
// 单页快照（无翻页），返回 20 条，按热榜名次原序排列。

/** 澎湃热榜接口（GET JSON） */
const THEPAPER_HOT_LIST_API =
  'https://cache.thepaper.cn/contentapi/wwwIndex/rightSidebar';

/** 澎湃热榜条目（渲染所需的最小字段集） */
export interface ThepaperHotItem {
  /** 内容 id（详情页 newsDetail_forward_<contId>） */
  contId: string;
  title: string;
  url: string;
  /** 发布时间文本（上游原样，如「16小时前」「3天前」） */
  timeText: string;
}

/** rightSidebar 响应（仅热榜部分） */
interface ThepaperSidebarResponse {
  resultCode: number;
  resultMsg?: string;
  data?: {
    hotNews?: Array<{
      contId: string;
      name: string;
      isOutForword?: string | number;
      link?: string;
      /** 相对时间文本（如「16小时前」） */
      pubTime?: string;
    }>;
  };
}

/**
 * 拉取澎湃热榜（单页快照，按名次原序返回）
 * @param num 条数（上游固定 20，默认全取）
 * @returns 热榜条目列表
 */
export const fetchThepaperHotList = async (num = 20): Promise<ThepaperHotItem[]> => {
  const response = await proxyFetch(THEPAPER_HOT_LIST_API, {
    headers: { Referer: 'https://www.thepaper.cn/' },
  });
  if (!response.ok) {
    throw new Error(`澎湃热榜请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThepaperSidebarResponse;
  if (payload.resultCode !== 1 || !payload.data) {
    throw new Error(`澎湃热榜业务异常：${payload.resultMsg ?? payload.resultCode}`);
  }
  return (payload.data.hotNews ?? []).slice(0, num).map((item) => ({
    contId: item.contId,
    title: item.name,
    url:
      String(item.isOutForword ?? '0') === '1' && item.link
        ? item.link
        : `${THEPAPER_DETAIL_BASE}${item.contId}`,
    timeText: item.pubTime ?? '',
  }));
};

// ---------- 财联社 深度 / 热门文章榜（www.cls.cn/depth?id=1000） ----------
// 站点全部接口都要求 sign 参数：算法为「参数按 key 排序拼 k=v& 串 → sha1 → md5」，
// 已用页面真实流量两组样本穷举验证（banner / telegraph cache 的 sign 均命中）。
// 深度页与热榜均为**单页快照**（无翻页参数）：assembled/1000 返回 top_article(3 条置顶头条)
// + depth_list(25 条深度流)；v2/article/hot/list 返回 13 条热门文章排行（含 readNum 阅读数）。

/** MD5 轮常量（RFC 1321：floor(2^32 × |sin(i+1)|)，运行时计算避免硬编码抄错） */
const MD5_K = Array.from({ length: 64 }, (_, i) =>
  Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32),
);

/** MD5 每步循环左移位数（RFC 1321 表格，按 4 步一组循环） */
const MD5_S = [
  7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
  5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
  4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
  6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

/**
 * 纯 JS MD5（输出小写 hex，输入 UTF-8 字节）
 *
 * crypto.subtle 只覆盖 SHA 系列不含 MD5，故按 RFC 1321 自实现；
 * 已用空串/abc/含中文/200 字节多块输入与 Node crypto 对照全过
 * @param input UTF-8 字节序列
 * @returns 32 位小写 hex 摘要
 */
const md5Hex = (input: Uint8Array): string => {
  const origLen = input.byteLength;
  const bitLen = origLen * 8;
  const paddedLen = (((origLen + 8) >> 6) + 1) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(input);
  buf[origLen] = 0x80;
  const bdv = new DataView(buf.buffer);
  // 消息位长按 64 位小端写在末尾（split(a, b) 展开避免 >>> 运算溢出到 32 位外）
  bdv.setUint32(paddedLen - 8, bitLen % 0x100000000, true);
  bdv.setUint32(paddedLen - 4, Math.floor(bitLen / 0x100000000), true);

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;
  const M = new Int32Array(16);
  for (let chunk = 0; chunk < paddedLen; chunk += 64) {
    for (let j = 0; j < 16; j++) M[j] = bdv.getInt32(chunk + j * 4, true);
    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;
    for (let i = 0; i < 64; i++) {
      let F: number;
      let g: number;
      if (i < 16) {
        F = (B & C) | (~B & D);
        g = i;
      } else if (i < 32) {
        F = (D & B) | (~D & C);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        F = B ^ C ^ D;
        g = (3 * i + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * i) % 16;
      }
      F = (F + A + MD5_K[i] + M[g]) | 0;
      const r = MD5_S[i];
      A = D;
      D = C;
      C = B;
      B = (B + ((F << r) | (F >>> (32 - r)))) | 0;
    }
    a0 = (a0 + A) | 0;
    b0 = (b0 + B) | 0;
    c0 = (c0 + C) | 0;
    d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16);
  const odv = new DataView(out.buffer);
  odv.setInt32(0, a0, true);
  odv.setInt32(4, b0, true);
  odv.setInt32(8, c0, true);
  odv.setInt32(12, d0, true);
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
};

/** 财联社接口公共参数（sign 之外固定携带的三项） */
const CLS_COMMON_PARAMS: Record<string, string> = {
  app: 'CailianpressWeb',
  os: 'web',
  sv: '8.7.9',
};

/**
 * 计算财联社接口签名并返回完整查询串
 *
 * 算法：参数按 key ASCII 排序 → `k=v&` 连接 → sha1（hex）→ md5（hex）= sign
 * @param extra 业务参数（不含 sign）
 * @returns 已带 sign 的查询串（如 `app=...&os=...&sign=...`）
 */
const buildClsQuery = async (extra: Record<string, string> = {}): Promise<string> => {
  const params = { ...CLS_COMMON_PARAMS, ...extra };
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  const sha1Bytes = await crypto.subtle.digest(
    'SHA-1',
    new TextEncoder().encode(sorted),
  );
  const sha1Hex = Array.from(new Uint8Array(sha1Bytes), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  const sign = md5Hex(new TextEncoder().encode(sha1Hex));
  return `${sorted}&sign=${sign}`;
};

/** 财联社文章详情页前缀（详情页形如 /detail/<id>） */
const CLS_DETAIL_BASE = 'https://www.cls.cn/detail/';

/** 财联社热榜条目（渲染所需的最小字段集） */
export interface ClsHotItem {
  /** 内容 id（详情页 /detail/<id>） */
  id: number;
  title: string;
  /** 阅读数（热门榜排序依据，展示「xx.x万」） */
  readNum: number;
  /** 秒级时间戳字符串（与其余源口径一致） */
  ctime: string;
  url: string;
}

/** 财联社接口统一响应壳 */
interface ClsResponse<T> {
  errno: number;
  msg?: string;
  data?: T;
}

/** assembled/1000 条目（top_article / depth_list / hot list 共用，字段有缺省） */
interface ClsArticleRaw {
  id: number;
  title: string;
  brief?: string;
  ctime?: number;
  author?: string;
  external_link?: string;
  /** 仅热榜条目携带：阅读数 */
  readNum?: number;
}

/** 财联社深度页单页快照 */
export interface ClsDepthSnapshot {
  /** 置顶头条（页面「头条」红标区块，3 条，带全文 brief） */
  topArticles: HotNewsItem[];
  /** 深度资讯流 */
  items: HotNewsItem[];
}

/**
 * 拉取财联社深度页快照（深度 id=1000：头条 + 资讯流，无翻页）
 * @returns 置顶头条与深度流
 */
export const fetchClsDepth = async (): Promise<ClsDepthSnapshot> => {
  const query = await buildClsQuery();
  const response = await proxyFetch(
    `https://www.cls.cn/v3/depth/home/assembled/1000?${query}`,
  );
  if (!response.ok) {
    throw new Error(`财联社深度请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ClsResponse<{
    top_article?: ClsArticleRaw[];
    depth_list?: ClsArticleRaw[];
  }>;
  if (payload.errno !== 0 || !payload.data) {
    throw new Error(`财联社深度业务异常：${payload.msg ?? payload.errno}`);
  }
  const mapArticle = (item: ClsArticleRaw): HotNewsItem => ({
    oid: String(item.id),
    title: item.title,
    summary: item.brief ?? '',
    url: item.external_link || `${CLS_DETAIL_BASE}${item.id}`,
    ctime: item.ctime ? String(item.ctime) : '',
    media: item.author || '财联社',
    img: '',
  });
  return {
    topArticles: (payload.data.top_article ?? []).map(mapArticle),
    items: (payload.data.depth_list ?? []).map(mapArticle),
  };
};

/**
 * 拉取财联社热门文章榜（单页快照，按站方排序原序返回）
 * @param num 条数（上游固定 13，默认全取）
 * @returns 热榜条目列表
 */
export const fetchClsHotList = async (num = 13): Promise<ClsHotItem[]> => {
  const query = await buildClsQuery();
  const response = await proxyFetch(
    `https://www.cls.cn/v2/article/hot/list?${query}`,
  );
  if (!response.ok) {
    throw new Error(`财联社热榜请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ClsResponse<ClsArticleRaw[]>;
  if (payload.errno !== 0 || !payload.data) {
    throw new Error(`财联社热榜业务异常：${payload.msg ?? payload.errno}`);
  }
  return payload.data.slice(0, num).map((item) => ({
    id: item.id,
    title: item.title,
    readNum: item.readNum ?? 0,
    ctime: item.ctime ? String(item.ctime) : '',
    url: item.external_link || `${CLS_DETAIL_BASE}${item.id}`,
  }));
};

// ---------- 同花顺 头条（app/headline/v2/first-page） ----------
// 官方 App「头条」页的首屏接口：一次返回 importanceNews（编辑精选 3 条）+ headlineList（资讯流 20 条），
// 无翻页参数（同名"first-page"，配套的 /v1/list/{columnId} 需要栏目 id 体系，未接）→ 单页源。
// GET 直连可用；与站内其他新闻接口一样带 Referer 以应对 WAF 收紧。

/** 同花顺头条响应（仅取渲染所需字段）
 *
 * ⚠️ id 字段名两个数组不同：importanceNews 用 contentId、headlineList 用 id
 * （实测 headlineList 的 contentId 恒为 null）——映射时两者兜底取值
 */
interface ThsHeadlineResponse {
  status_code: number;
  data?: {
    importanceNews?: ThsHeadlineRawItem[];
    headlineList?: ThsHeadlineRawItem[];
  };
}

/** 同花顺头条原始条目（两个数组字段同构，仅 id 字段名不同） */
interface ThsHeadlineRawItem {
  contentId?: string | null;
  id?: string | null;
  title: string;
  url: string;
  picUrl: string | null;
  source: string | null;
  /** 秒级时间戳（数字） */
  ctime: number;
}

/**
 * 同花顺头条条目 → HotNewsItem 的公共映射
 * @param item 原始条目
 * @returns 通用新闻条目
 */
const mapThsHeadlineItem = (item: ThsHeadlineRawItem): HotNewsItem => ({
  oid: `ths-hl-${item.contentId || item.id || item.url}`,
  title: item.title,
  // 上游列表无摘要字段
  summary: '',
  url: item.url || 'https://news.10jqka.com.cn/',
  ctime: String(Math.floor(item.ctime || 0)),
  media: item.source || '同花顺',
  img: item.picUrl || '',
});

/**
 * 拉取同花顺头条首屏（精选 + 资讯流合并，单页无翻页）
 * @returns 新闻条目（按发布时间倒序，oid 去重）
 */
export const fetchThsHeadlineHotNews = async (): Promise<HotNewsItem[]> => {
  const response = await proxyFetch(
    'https://news.10jqka.com.cn/app/headline/v2/first-page',
    { headers: { Referer: 'https://10jqka.com.cn' } },
  );
  if (!response.ok) {
    throw new Error(`同花顺头条请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThsHeadlineResponse;
  if (payload.status_code !== 0 || !payload.data) {
    throw new Error('同花顺头条业务异常');
  }
  const merged = [
    ...(payload.data.importanceNews ?? []),
    ...(payload.data.headlineList ?? []),
  ].map(mapThsHeadlineItem);
  // oid 去重 + 按时间倒序（精选与资讯流有重叠与交错，展示按新在前）
  const seen = new Set<string>();
  const deduped: HotNewsItem[] = [];
  for (const item of merged) {
    if (!seen.has(item.oid)) {
      seen.add(item.oid);
      deduped.push(item);
    }
  }
  return deduped.sort((a, b) => Number(b.ctime) - Number(a.ctime));
};

// ---------- 同花顺 热点主题（hot-theme → theme → content 三级） ----------
// 链路（实测还原官方 App「热点主题」页）：
//   1. /app/headline/v1/hot-theme                  → 主题列表（themeId 形如 TZ-11476）
//   2. /app/theme/v1/theme?themeId=TZ-11476        → 主题详情，module 中 type=2 的
//      items 即资讯 tab（如 {id:5463, name:"最新动态"}）——⚠️ content 接口的
//      id 是这个**数字 tab id**，不是 TZ 主题 id（直接传 TZ id 返回空数组）
//   3. /app/theme/v1/content?id=5463&page=1&size=15 → 该 tab 的资讯流（page 页码翻页）
// 页面只消费首个资讯 tab（「最新动态」，热点新闻页语义下其余 tab 无意义）。

/** 热点主题（主题列表条目） */
export interface ThsHotTheme {
  /** 主题 id（TZ-xxxx 形态） */
  themeId: string;
  themeName: string;
}

/** 热点主题资讯流翻页结果 */
export interface ThsThemeFeedPage {
  items: HotNewsItem[];
  /** 是否可能还有下一页（页码源按满页判定） */
  hasMore: boolean;
}

/** 热点主题列表响应 */
interface ThsHotThemeResponse {
  status_code: number;
  data?: Array<{ themeId: string; themeName: string }>;
}

/** 主题详情响应（module.type=2 的 items 即资讯 tab） */
interface ThsThemeMetaResponse {
  status_code: number;
  data?: {
    module?: Array<{
      type?: number;
      items?: Array<{ id: number; name?: string } | null> | null;
    } | null>;
  };
}

/** 主题资讯流响应 */
interface ThsThemeFeedResponse {
  status_code: number;
  data?: Array<{
    time: number;
    itemId: string;
    title: string;
    source: string | null;
    contentUrl: string | null;
    webUrl: string | null;
    abstract: string | null;
    picUrl: string[] | null;
  }>;
}

/** 主题元信息缓存（TZ 主题 id → 首个资讯 tab 数字 id），避免每次翻页都查详情 */
const thsThemeTabCache = new Map<string, string>();

/** 主题接口公共头（Referer 应对 WAF） */
const THS_THEME_HEADERS = { Referer: 'https://10jqka.com.cn' } as const;

/**
 * 拉取热点主题列表（同花顺官方 App 当前热门主题，约 20 个）
 * @returns 主题列表（themeId 升序即上游热度序）
 */
export const fetchThsHotThemes = async (): Promise<ThsHotTheme[]> => {
  const response = await proxyFetch(
    'https://news.10jqka.com.cn/app/headline/v1/hot-theme',
    { headers: THS_THEME_HEADERS },
  );
  if (!response.ok) {
    throw new Error(`同花顺热点主题请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThsHotThemeResponse;
  if (payload.status_code !== 0) {
    throw new Error('同花顺热点主题业务异常');
  }
  return (payload.data ?? []).filter((item) => item.themeId && item.themeName);
};

/**
 * 解析主题的首个资讯 tab 数字 id（带模块级缓存）
 * @param themeId TZ 主题 id
 * @returns tab 数字 id（解析不到时抛错）
 */
const resolveThsThemeTabId = async (themeId: string): Promise<string> => {
  const cached = thsThemeTabCache.get(themeId);
  if (cached) return cached;
  const response = await proxyFetch(
    `https://news.10jqka.com.cn/app/theme/v1/theme?themeId=${encodeURIComponent(themeId)}`,
    { headers: THS_THEME_HEADERS },
  );
  if (!response.ok) {
    throw new Error(`同花顺主题详情请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThsThemeMetaResponse;
  if (payload.status_code !== 0 || !payload.data) {
    throw new Error('同花顺主题详情业务异常');
  }
  for (const moduleItem of payload.data.module ?? []) {
    if (!moduleItem || moduleItem.type !== 2) continue;
    for (const tab of moduleItem.items ?? []) {
      if (tab && tab.id) {
        const tabId = String(tab.id);
        thsThemeTabCache.set(themeId, tabId);
        return tabId;
      }
    }
  }
  throw new Error(`主题 ${themeId} 无资讯 tab`);
};

/**
 * 拉取热点主题的资讯流（单页，页码翻页；tab id 经模块缓存自动解析）
 * @param themeId TZ 主题 id
 * @param page 页码（从 1 开始）
 * @param num 单页条数
 * @returns 本页条目与是否还有更多
 */
export const fetchThsThemeFeed = async (
  themeId: string,
  page: number,
  num = 20,
): Promise<ThsThemeFeedPage> => {
  const tabId = await resolveThsThemeTabId(themeId);
  const url =
    `https://news.10jqka.com.cn/app/theme/v1/content?id=${tabId}` +
    `&page=${page}&size=${num}`;
  const response = await proxyFetch(url, { headers: THS_THEME_HEADERS });
  if (!response.ok) {
    throw new Error(`同花顺主题资讯请求失败：${response.status}`);
  }
  const payload = (await response.json()) as ThsThemeFeedResponse;
  if (payload.status_code !== 0 || !payload.data) {
    throw new Error('同花顺主题资讯业务异常');
  }
  const items = (payload.data ?? [])
    .filter((item) => item.itemId && item.title)
    .map((item) => ({
      oid: `ths-theme-${item.itemId}`,
      title: item.title,
      // abstract 多数条目有值（部分为 null），卡片侧按空串隐藏该行
      summary: item.abstract ?? '',
      url: item.contentUrl || item.webUrl || 'https://news.10jqka.com.cn/',
      // time 为毫秒时间戳，统一转秒级与其余源口径一致
      ctime: String(Math.floor((item.time || 0) / 1000)),
      media: item.source || '同花顺',
      // picUrl 是数组（多图），卡片单图取首张
      img: item.picUrl?.[0] ?? '',
    }));
  return { items, hasMore: items.length >= num };
};

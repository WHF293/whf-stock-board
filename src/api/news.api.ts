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

/**
 * 个股关联资讯类型（公告 + 个股新闻，详情页「资讯」页签消费）
 */

/** 个股公告条目 */
export interface StockAnnouncement {
  /** 公告标题 */
  title: string;
  /** 公告日期（YYYY-MM-DD） */
  date: string;
  /** 原文链接（东财公告详情页） */
  url: string;
}

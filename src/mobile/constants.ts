import type { SinaNewsLid } from '../api/news.api';

/**
 * 移动端常量（需求稿 v1.1：local_docs/stock-board-mobile/stock-board-mobile-dual-tab-v1.html）
 *
 * 移动端专属取值集中于此；与桌面共用的业务常量（榜单分组 / 平台顺序 / 涨跌色等）
 * 直接从 src/constants 复用，不在本文件重复声明
 */

/** 快照缓存 TTL（毫秒）：榜单与新闻快照统一 30 分钟，写入持久层（mobile.cache 命名空间） */
export const MOBILE_CACHE_TTL_MS = 30 * 60_000;

/** 新闻流单页条数（新浪 / 同花顺 page 型翻页的 num 参数） */
export const MOBILE_NEWS_PAGE_SIZE = 20;

/** 新浪频道 lid：财经综合热点（2516） */
export const SINA_LID_FINANCE: SinaNewsLid = 2516;

/** 新浪频道 lid：股市快讯（2517） */
export const SINA_LID_STOCK: SinaNewsLid = 2517;

/** 移动端前台轮询间隔选项（需求稿四档：5s / 10s / 30s / 1min） */
export const MOBILE_POLLING_OPTIONS: readonly { label: string; value: number }[] = [
  { label: '5s', value: 5_000 },
  { label: '10s', value: 10_000 },
  { label: '30s', value: 30_000 },
  { label: '1min', value: 60_000 },
];

/** 移动端默认前台轮询间隔（毫秒）：30s（需求稿 v1.1 定稿；高频档上游可能限流） */
export const MOBILE_POLLING_DEFAULT = 30_000;

/** 新闻频道加载方式：page = 页码翻页 / cursor = 游标翻页 / single = 单页快照（无更多） */
export type MobileNewsChannelType = 'page' | 'cursor' | 'single';

/** 移动端新闻子栏目 */
export interface MobileNewsChannel {
  /** 频道 key（缓存键组成部分，如 `sina:caijing`） */
  key: string;
  /** 展示名 */
  label: string;
  /** 加载方式（决定翻页与「已经到底了」行为） */
  type: MobileNewsChannelType;
}

/** 移动端新闻源（与桌面 HotNewsView 六卡一一对应，首个为默认源） */
export interface MobileNewsSource {
  /** 源 key（缓存键组成部分） */
  key: string;
  /** 展示名 */
  label: string;
  /** 该源可切换的子栏目（首期为各源主新闻通道；名次榜类子栏目随后续迭代接入） */
  channels: readonly MobileNewsChannel[];
}

/** 六源定义（命名与桌面 HotNewsView 卡片一一对应；
 * 默认顺序 2026-10-10 调整为财联社优先，与桌面 DEFAULT_SOURCE_ORDER 保持一致） */
export const MOBILE_NEWS_SOURCES: readonly MobileNewsSource[] = [
  {
    key: 'cls',
    label: '财联社',
    channels: [{ key: 'depth', label: '深度', type: 'single' }],
  },
  {
    key: 'tdx',
    label: '通达信资讯',
    channels: [
      { key: 'yw', label: '要闻', type: 'single' },
      { key: 'ag', label: 'A股', type: 'single' },
      { key: 'cj', label: '产经', type: 'single' },
    ],
  },
  {
    key: 'ths',
    label: '同花顺',
    channels: [
      { key: 'flash', label: '快讯', type: 'page' },
      { key: 'headline', label: '头条', type: 'single' },
    ],
  },
  {
    key: 'em',
    label: '东方财富',
    channels: [
      { key: 'flash', label: '快讯', type: 'cursor' },
      { key: 'rec', label: '推荐', type: 'single' },
    ],
  },
  {
    key: 'sina',
    label: '新浪财经',
    channels: [
      { key: 'caijing', label: '财经热点', type: 'page' },
      { key: 'kuaixun', label: '股市快讯', type: 'page' },
    ],
  },
  {
    key: 'tp',
    label: '澎湃新闻',
    channels: [{ key: 'flash', label: '快讯', type: 'cursor' }],
  },
];

/** 移动端底部 Tab（主 Tab 页路径 + 图标 + 文案） */
export const MOBILE_TAB_ITEMS: readonly { path: string; label: string; icon: string }[] = [
  { path: '/news', label: '热点新闻', icon: '✦' },
  { path: '/board', label: '今天炒什么', icon: '▤' },
  { path: '/mine', label: '我的', icon: '☻' },
];

/** 移动端免责声明（「我的」页底部与设置页「免责声明」共用一份文案） */
export const MOBILE_DISCLAIMER =
  '行情与资讯数据来自第三方公开接口，仅供个人学习参考，不构成任何投资建议。请以官方行情软件为准。';

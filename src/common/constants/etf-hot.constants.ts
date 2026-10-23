/**
 * 「ETF 热榜」- 同花顺 ETF 榜单的共享定义
 *
 * 数据源为同花顺基金 ETF 热榜页（fund.10jqka.com.cn 的 etf-hot-list SPA），
 * 四个榜单各占一张卡片（无分组切换），展示形式参考「今天炒什么」：
 * - 热度榜 / 自选榜：eq.10jqka 开放接口（免鉴权，只给代码 + 名称 + 热度值）；
 * - 补涨榜 / T+0 榜：fund.10jqka datahub 的 specific_data 接口（POST，免鉴权）；
 * 价格与涨跌幅由腾讯源批量报价（fetchFullQuotes）补齐，ETF 代码口径见 api 层
 */

/** ETF 榜单 key（缓存通道 / 取数路由用） */
export type EtfBoardKey = 'hot' | 'selected' | 'rebound' | 't0';

/** ETF 榜单卡片定义（数组顺序 = 卡片渲染顺序） */
export interface EtfBoardOption {
  /** 榜单 key */
  key: EtfBoardKey;
  /** 卡片标题 */
  label: string;
  /** 上游口径说明（卡片副标题） */
  desc: string;
}

/** 四个 ETF 榜单（同花顺官方口径，一个榜单单独一列） */
export const ETF_HOT_BOARDS: readonly EtfBoardOption[] = [
  { key: 'hot', label: '热度榜', desc: '24 小时内同花顺用户搜索和访问最多的 ETF' },
  { key: 'selected', label: '自选榜', desc: '按同花顺 ETF 加自选人数排行' },
  { key: 'rebound', label: '补涨榜', desc: '近 60 日跌幅较大的标的' },
  { key: 't0', label: 'T+0 榜', desc: '支持日内 T+0 交易的 ETF' },
];

/** 每榜展示条数上限（与今天炒什么同口径） */
export const ETF_BOARD_ITEM_LIMIT = 50;

/** 榜单缓存有效期（毫秒）：与今天炒什么同口径，期内直接复用快照 */
export const ETF_BOARD_CACHE_TTL_MS = 30 * 60 * 1000;

// ---------- 上游接口常量 ----------

/** 同花顺 ETF 热度榜接口（免鉴权；响应为 {data:{list:[...]}} 壳） */
export const ETF_HOT_LIST_URL = 'https://eq.10jqka.com.cn/open/api/etf_rank/v1/hot.txt';

/** 同花顺 ETF 自选榜接口（与热度榜同壳；rate = 近 7 天加自选人数） */
export const ETF_SELECTED_LIST_URL =
  'https://eq.10jqka.com.cn/open/api/etf_rank/v1/selected.txt';

/** 同花顺 datahub 指标取数接口（补涨榜 / T+0 榜；POST JSON，免鉴权） */
export const ETF_DATAHUB_URL =
  'https://fund.10jqka.com.cn/datahub/dataapi/fetch/outer/v1/specific_data';

/** ETF 榜单上游 Referer（datahub 接口实测不校验，统一带上与页面同口径） */
export const ETF_BOARD_REFERER = 'https://fund.10jqka.com.cn/';

/** datahub 榜单 data_key：补涨榜（近 60 日跌幅较大 + 热度） */
export const ETF_DATA_KEY_REBOUND = 'etf_buzhangbang';

/** datahub 榜单 data_key：T+0 榜（全部 T+0 标的按热度排序） */
export const ETF_DATA_KEY_T0 = 'etf_t0_bang';

/** datahub 指标列：证券名称 */
export const ETF_INDEX_NAME = 'security_name';

/** datahub 指标列：当日涨跌幅 %（T+0 榜消费） */
export const ETF_INDEX_CHANGE_PCT = 'price_change_ratio_pct';

/** datahub 指标列：近 60 日涨跌幅 %（补涨榜消费，上游 ext 为 -60d 求和口径） */
export const ETF_INDEX_CHANGE_60D = 'inr-price_change_ratio_pct-sum';

/** datahub 指标列：日度关注度热度值（两榜共用） */
export const ETF_INDEX_ATTENTION = 'ths-hot-data-day-attention-rate';

// ---------- 上游市场段映射 ----------

/**
 * 同花顺基金侧市场段 → 符号前缀（hot.txt 的 market 字段与 datahub 行 code
 * 前缀同一套：20 = 沪 / 36 = 深，实测 588060→20、159952→36）
 */
export const ETF_MARKET_PREFIXES: Record<string, string> = {
  '20': 'sh',
  '36': 'sz',
};

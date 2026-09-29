/**
 * 「今天炒什么」- 平台 / 分组的共享定义
 *
 * 五个热股平台（同花顺 / 东财 / 财联社 / 通达信 / 雪球）各占一张卡片，
 * 卡片内保留该平台自己的榜单分组（chips 切换，只做 A 股口径）；
 * 分组定义同时被页面与放大弹窗消费，故抽到本文件共享
 * （`<script setup>` 内不能 export，SFC 之间无法互相导入类型与常量）
 */

/** 热股平台（设置弹窗里可勾选 / 拖拽排序的粒度，即卡片粒度） */
export type BoardSource = 'ths' | 'em' | 'cls' | 'tdx' | 'xq';

/** 分组切换控件的通用选项形态（分组值 + 展示名） */
export interface BoardGroupOption {
  /** 分组值（取数函数按它路由到对应上游参数） */
  value: string;
  /** 展示名（chips 文案，与各平台页面原名一致） */
  label: string;
}

/**
 * 各平台分组定义（数组顺序 = chips 渲染顺序，首个为默认选中）
 *
 * 口径均为 A 股（雪球榜单天然含港美股，由取数层按代码过滤）
 */
export const BOARD_GROUPS: Record<BoardSource, readonly BoardGroupOption[]> = {
  // 同花顺：dq.10jqka 热榜接口的 list_type + 新股独立接口
  ths: [
    { value: 'normal', label: '大家都在看' },
    { value: 'skyrocket', label: '快速飙升中' },
    { value: 'new', label: '新股热度榜' },
    { value: 'tech', label: '技术交易派' },
    { value: 'value', label: '价值投资派' },
    { value: 'trend', label: '趋势投资派' },
  ],
  // 东财：App 人气榜接口的两个榜（getAllCurrentList / getAllHisRcList）
  em: [
    { value: 'popularity', label: '人气榜' },
    { value: 'skyrocket', label: '飙升榜' },
  ],
  // 财联社：App 端 hot_stock 单榜（页面另有资讯榜，非个股口径，不接）
  cls: [{ value: 'hot', label: '热股榜' }],
  // 通达信：TQLEX 三个 Entry（listType 区分人气/关注/热搜）
  tdx: [
    { value: 'popularity', label: '人气榜' },
    { value: 'follow', label: '关注榜' },
    { value: 'search', label: '热搜榜' },
    { value: 'skyrocket', label: '飙升榜' },
    { value: 'yesterday', label: '昨日榜' },
  ],
  // 雪球：hot_stock 系列接口（type 区分热搜/热评/自选，飙升走 new_list）
  xq: [
    { value: 'search', label: '热搜榜' },
    { value: 'skyrocket', label: '飙升榜' },
    { value: 'comment', label: '热评榜' },
    { value: 'optional', label: '自选榜' },
  ],
};

/** 平台展示名（工具条计数与卡片标题共用） */
export const BOARD_SOURCE_LABELS: Record<BoardSource, string> = {
  ths: '同花顺热榜',
  em: '东方财富热榜',
  cls: '财联社热榜',
  tdx: '通达信热榜',
  xq: '雪球热股',
};

/** 平台 logo（本地静态资源，离线可用；同花顺 / 东财 / 财联社复用热点新闻的图标） */
export const BOARD_SOURCE_LOGOS: Record<BoardSource, string> = {
  ths: '/news-logos/10jqka.ico',
  em: '/news-logos/eastmoney.ico',
  cls: '/news-logos/cls.ico',
  tdx: '/hot-board-logos/tdx.ico',
  xq: '/hot-board-logos/xueqiu.ico',
};

/** 默认平台顺序（首次进入 / 持久化数据缺源时按此补齐） */
export const BOARD_SOURCE_ORDER: readonly BoardSource[] = [
  'ths',
  'em',
  'cls',
  'tdx',
  'xq',
];

/** 每榜展示条数上限（上游多返回 100 条，页面只展示前 50 防止卡片过长） */
export const BOARD_ITEM_LIMIT = 50;

/** 榜单缓存有效期（毫秒）：期内直接复用快照不请求（与热点新闻页同口径） */
export const BOARD_CACHE_TTL_MS = 30 * 60 * 1000;

// ---------- 各平台上游接口常量 ----------

/** 同花顺热榜接口（list_type / type 参数按分组拼接；免鉴权） */
export const THS_HOT_LIST_URL =
  'https://dq.10jqka.com.cn/fuyao/hot_list_data/out/hot_list/v1/stock';

/** 同花顺新股热度榜接口（独立于通用热榜接口；.txt 后缀实为 JSON） */
export const THS_NEW_STOCK_URL =
  'https://eq.10jqka.com.cn/open/api/hot_list/rank/v1/new_stock.txt';

/** 同花顺上游 Referer（应对 WAF 收紧，与站内其他同花顺接口同口径） */
export const THS_REFERER = 'https://eq.10jqka.com.cn/';

/** 东财 App 人气榜接口（免鉴权；只返回代码 + 排名，行情另行批量补齐） */
export const EM_RANK_API = 'https://emappdata.eastmoney.com/stockrank';

/** 东财榜单接口固定 appId（页面公共值，非密钥） */
export const EM_RANK_APP_ID = 'appId01';

/** 东财榜单单页条数（人气榜/飙升榜各一次取全） */
export const EM_RANK_PAGE_SIZE = 100;

/** 财联社 App 端热股榜接口（sign 动态计算，算法与 web 端一致） */
export const CLS_HOT_STOCK_URL = 'https://api3.cls.cn/v1/hot_stock';

/** 财联社 App 端公共参数（sign 之外固定携带；sv 为 App 三位版本口径） */
export const CLS_APP_COMMON_PARAMS: Record<string, string> = {
  app: 'cailianpress',
  os: 'android',
  sv: '835',
};

/** 通达信 TQLEX RPC 网关（Entry 区分业务，POST JSON 数组体；需带页面 Referer） */
export const TDX_TQLEX_URL = 'https://pul.tdx.com.cn/TQLEX';

/** 通达信热榜页地址（作为 Referer 传入；无 cookie 校验但缺 Referer 会拒绝） */
export const TDX_REFERER =
  'https://pul.tdx.com.cn/site/app/gzhbd/tdx-topsearch/page-main.html' +
  '?pageName=page_topsearch&tabClickIndex=0&subtabIndex=0';

/** 雪球热股榜单接口（需 guest cookie：xq_a_token，获取链路见 api/hot-board.api.ts） */
export const XQ_LIST_URL =
  'https://stock.xueqiu.com/v5/stock/hot_stock/list.json';

/** 雪球飙升榜接口（与 list.json 同构，排序字段为 rank_change） */
export const XQ_NEW_LIST_URL =
  'https://stock.xueqiu.com/v5/stock/hot_stock/new_list.json';

// ---------- 上游分组参数映射（分组值 → 各平台接口参数，取数层消费） ----------

/** 同花顺分组 → 热榜接口 type 参数（热度回溯口径：大家都在看 / 快速飙升为小时榜，其余为日榜） */
export const THS_GROUP_TIME_TYPES: Record<string, string> = {
  normal: 'hour',
  skyrocket: 'hour',
  tech: 'day',
  value: 'day',
  trend: 'day',
};

/** 通达信人气 / 关注 / 热搜三榜共用的 Entry（listType 区分） */
export const TDX_HOT_STOCK_ENTRY = 'JNLPSE.hotStockList';

/** 通达信飙升榜 Entry（changeType 区分时间窗） */
export const TDX_CHANGE_ENTRY = 'JNLPSE.changeStockList';

/** 通达信昨日榜 Entry */
export const TDX_YESTERDAY_ENTRY = 'JNLPSE.yesterdayList';

/** 通达信人气 / 关注 / 热搜分组 → hotStockList 的 listType 参数 */
export const TDX_GROUP_LIST_TYPES: Record<string, string> = {
  popularity: '0',
  follow: '1',
  search: '2',
};

/** 通达信请求体固定的时间窗口参数（cycle 0 = 最新；30/60 分钟维度暂不开放） */
export const TDX_CYCLE_LATEST = '0';

/** 通达信飙升榜请求体（changeType 1 = 最新窗口） */
export const TDX_SKYROCKET_BODY = [{ changeType: '1' }] as const;

/** 通达信昨日榜请求体（上游要求空对象成员） */
export const TDX_YESTERDAY_BODY = [{}] as const;

/** 雪球分组 → list.json 的 type 参数（热搜 10 / 热评 30 / 自选 40） */
export const XQ_GROUP_TYPES: Record<string, string> = {
  search: '10',
  comment: '30',
  optional: '40',
};

/** 雪球榜单单页条数（一次取全，展示层再截断） */
export const XQ_PAGE_SIZE = 100;

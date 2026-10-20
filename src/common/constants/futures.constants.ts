/**
 * 期货·机构行为（中金所 CCPM 成交持仓排名）常量
 *
 * 数据源：中金所每日收盘披露的成交持仓排名 CSV（每品种每日一个文件，
 * 成交量 / 持买单量 / 持卖单量三榜并排，GBK 编码）。
 * 仅披露代客经纪业务、达标 / 前 20 会员；页面所有口径提示见常驻文案。
 */

/** 中金所 CCPM CSV 上游地址模板（{yyyymm}/{dd}/{product} 由调用方填充） */
export const CCPM_CSV_URL_TEMPLATE = 'http://www.cffex.com.cn/sj/ccpm/{yyyymm}/{dd}/{product}_1.csv';

/** 上游代理目标域名（浏览器侧白名单与 Tauri capabilities scope 共用此域） */
export const CCPM_UPSTREAM_HOST = 'www.cffex.com.cn';

/**
 * 品种清单（展示顺序即筛选器顺序）
 *
 * 股指四品种（IF/IH/IC/IM）支持「全股指合并」口径；国债品种持仓量级与结构
 * 与股指差异大，不参与跨品种合并。
 */
export const CCPM_PRODUCTS = [
  { code: 'IF', name: '沪深300' },
  { code: 'IH', name: '上证50' },
  { code: 'IC', name: '中证500' },
  { code: 'IM', name: '中证1000' },
  { code: 'T', name: '10年国债' },
  { code: 'TF', name: '5年国债' },
  { code: 'TS', name: '2年国债' },
  { code: 'TL', name: '30年国债' },
] as const;

/** 品种代码类型 */
export type CcpmProductCode = (typeof CCPM_PRODUCTS)[number]['code'];

/** 支持「全股指合并」口径的品种集合 */
export const CCPM_EQUITY_PRODUCTS: readonly CcpmProductCode[] = ['IF', 'IH', 'IC', 'IM'];

/** 全股指合并口径的品种顺序（聚合明细表按此排序） */
export const CCPM_EQUITY_PRODUCT_ORDER: readonly CcpmProductCode[] = ['IF', 'IH', 'IC', 'IM'];

/**
 * 行为标签阈值：|净持仓| ÷ max(多单, 空单) 低于此比例且多空同向增仓 → 对冲特征；
 * 不低于此比例 → 单边多 / 空
 */
export const CCPM_HEDGE_RATIO_THRESHOLD = 0.2;

/**
 * 移仓判定阈值（手）：近月某方向减仓、更远合约同方向增仓幅度不低于此值时，
 * 标记疑似移仓
 */
export const CCPM_ROLL_CHG_THRESHOLD = 100;

/** 时序图默认回看交易日数（席位净持仓时序） */
export const CCPM_SERIES_DAYS = 20;

/** 时序回看探测自然日上限：找不到足够披露日时停止（约一个月窗口） */
export const CCPM_SERIES_MAX_PROBE_DAYS = 45;

/** 逐日拉取并发上限（上游为静态 CSV，2 足够稳） */
export const CCPM_FETCH_CONCURRENCY = 2;

/** 会话内数据缓存 TTL（毫秒）：披露日数据收盘后定稿，缓存 30 分钟即可 */
export const CCPM_CACHE_TTL_MS = 30 * 60 * 1000;

/* -------------------- 期货总览（同花顺期货通 futgwapi） -------------------- */

/** 同花顺期货通行情网关地址（fupage 同源反代，JSON；已被 10jqka 白名单 / Tauri scope 覆盖） */
export const FUTURES_OVERVIEW_API_BASE = 'https://fupage.10jqka.com.cn/futgwapi/api/market/';

/** 主力合约榜单接口（同花顺期货通 goodsfu 首页同款，榜单合约清单；域名已被 10jqka 白名单覆盖） */
export const FUTURES_RANK_API_BASE = 'https://ftapi.10jqka.com.cn/futgwapi/api/market/homepage/v1/recommend_futures';

/** 东方财富 push2 行情接口（榜单行情快照批量拉取；eastmoney 已在白名单 / Tauri scope）。
 * 同域多镜像按序轮换：东财对高频探测会按 IP 临时限流，主 host 失败自动切下一个 */
export const FUTURES_EM_SNAPSHOT_HOSTS: readonly string[] = [
  'https://push2.eastmoney.com',
  'https://91.push2.eastmoney.com',
  'https://1.push2.eastmoney.com',
];

/** 每张榜单展示的合约数（与同花顺首页四榜一致） */
export const FUTURES_RANK_BOARD_SIZE = 4;

/**
 * 合约代码前缀 → 东财 push2 市场号（大小写敏感，最长前缀优先）。
 * 期货合约代码规则固定（品种前缀 + 年月），映射表覆盖全所现行品种即可解析任意合约。
 */
export const FUTURES_EM_MARKET_BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  // 中金所（大写；T 放最后让 TL/TS/TF 最长优先）
  ['TL', '220'], ['TS', '220'], ['TF', '220'], ['IF', '220'], ['IH', '220'], ['IC', '220'], ['IM', '220'], ['T', '220'],
  // 上期能源（小写）
  ['sc', '142'], ['lu', '142'], ['nr', '142'], ['bc', '142'], ['ec', '142'],
  // 广期所（小写）
  ['lc', '225'], ['si', '225'], ['ps', '225'],
  // 郑商所（大写）
  ['WH', '115'], ['PM', '115'], ['RI', '115'], ['JR', '115'], ['LR', '115'], ['AP', '115'], ['CF', '115'], ['CY', '115'],
  ['CJ', '115'], ['UR', '115'], ['SA', '115'], ['FG', '115'], ['TA', '115'], ['MA', '115'], ['PF', '115'], ['PK', '115'],
  ['PX', '115'], ['SH', '115'], ['PV', '115'], ['RS', '115'], ['RM', '115'], ['OI', '115'],
  // 上期所（小写）
  ['cu', '113'], ['al', '113'], ['zn', '113'], ['pb', '113'], ['ni', '113'], ['sn', '113'], ['au', '113'], ['ag', '113'],
  ['rb', '113'], ['hc', '113'], ['bu', '113'], ['ru', '113'], ['fu', '113'], ['sp', '113'], ['ao', '113'], ['br', '113'],
  // 大商所（小写；单字母放最后让 cs/c、lh 等最长优先）
  ['cs', '114'], ['lh', '114'], ['jd', '114'], ['eg', '114'], ['eb', '114'], ['pg', '114'], ['rr', '114'],
  ['fb', '114'], ['bb', '114'], ['lg', '114'], ['pp', '114'], ['jm', '114'], ['a', '114'], ['b', '114'], ['m', '114'],
  ['y', '114'], ['p', '114'], ['c', '114'], ['l', '114'], ['v', '114'], ['j', '114'], ['i', '114'],
];

/** 总览数据会话缓存 TTL（毫秒）：盘中实时变化的数据，缓存 60 秒防抖轮询/快速切换 */
export const FUTURES_OVERVIEW_CACHE_TTL_MS = 60 * 1000;

/** CSV 数据行前三列固定语义（交易日 / 合约 / 排名），用于解析校验 */
export const CCPM_DATE_CELL_LENGTH = 8;

/** 页面常驻文案（数据边界 / 口径提醒 / 风险提示，规范要求不可隐藏） */
export const FUTURES_PAGE_TEXT = {
  /** 顶部常驻数据边界提示 */
  dataBoundary:
    '数据来源中金所成交持仓排名（CCPM），仅披露代客经纪业务（会员全部客户合并数据，不等于单一机构）；仅披露达标 / 前 20 会员，非全市场数据；净持仓为收盘隔夜快照。标签为算法自动识别，仅供分析，不构成交易信号。',
  /** 全股指合并口径提醒（切到该口径时强制展示） */
  allScopeWarn: [
    '合并仅统计上榜 TOP20 合约，未上榜合约数据缺失，结果为不完全统计；',
    '代客席位是全部客户头寸合并，不是单一机构；',
    '净增减 ≠ 多头新开仓，不等于看多大盘（内部可能同时加多与加空，含套保、跨期套利）；',
    'IF / IH / IC / IM 属于不同指数，跨品种直接相加逻辑粗糙，仅供核验口径参考。',
  ],
  /** 聚合口径的部分头寸提示（isPartial 时展示） */
  partialWarn:
    '该席位仅部分合约上榜，合并结果为部分头寸（未进 TOP20 的合约无公开数据），不得当作完整净头寸解读。',
  /** 底部固定风险提示 */
  risks: [
    '所有数据为期货公司代客合并持仓：是席位全部客户总和（公募 / 私募 / 量化 / 散户 / 套保混合），不是某一家机构的单独头寸。',
    '中金所只披露达标 / 前 20 会员：未上榜会员与合约无公开数据，分析样本是部分样本。',
    '净持仓是收盘隔夜快照，看不到盘中 T+0 日内交易。',
    '空头持仓 ≠ 看空大盘：大量空单是股票现货多头的套保盘。',
    '净增减 ≠ 多头新开仓：净多变化 = 多头增减 − 空头增减，内部可能同时加多与加空。',
    '本页面仅做资金行为观测工具，所有标签、图表不构成任何投资建议。',
  ],
  /** 行为标签展示文案 */
  tagLabels: { hedge: '✅ 对冲特征', long: '⚠ 单边多头', short: '⚠ 单边空头' } as Record<string, string>,
  /** 行为标签判定说明（画像卡脚注） */
  tagRule: '|净持仓| ÷ max(多单, 空单) < 20% 且多空同向增仓 → 对冲；占比 ≥ 20% → 单边。空值席位不参与判定。',
} as const;


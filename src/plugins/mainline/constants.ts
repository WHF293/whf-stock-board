/**
 * 插件 dsh-mainline（股票主线）· 全部常量
 *
 * 口径参考本地技能 `a-share-huddle-mainline`（A 股板块抱团主线四阶段判定）：
 * 把「抱团主线」从主观感觉变成可复现的状态规则 —— 数据源换成**应用内可直连的接口**：
 * - 板块清单与板块日 K（含成交额）：同花顺（`q.10jqka.com.cn` / `d.10jqka.com.cn`，GBK 编码）
 *   —— 东财 `push2his` 在本机被封、`push2delay` 不返回 K 线（见 SERVER_API.md），故走同花顺；
 * - 沪深两市总成交额：复用宿主既有 `fetchMarketTurnover`（腾讯日 K，含真实成交额）。
 */

/** 插件 id */
export const MAINLINE_PLUGIN_ID = 'dsh-mainline';

/** 左侧导航路径（菜单贡献点带 component 时自动注册该路由） */
export const MAINLINE_MENU_PATH = '/mainline';

/** 左侧导航标题 */
export const MAINLINE_MENU_TITLE = '股票主线';

/** 菜单图标（MenuIcon 的 key） */
export const MAINLINE_MENU_ICON = 'flame';

// ---------- 数据源 ----------

/** 同花顺行业板块清单页（GBK HTML，链接里带 `detail/code/881121/` 形式的板块代码） */
export const THS_BOARD_LIST_URL = 'https://q.10jqka.com.cn/thshy/';

/**
 * 清单页分页地址基址（ajax 形态，只返回表格行）
 *
 * 实测：首页表格每页只给 **50 行**（90 个行业板块要两页），第 2 页返回剩余 40 行，
 * 两页并集与首页页脚导航里的 90 个代码**完全一致**（探针 `.ai/tmp/mainline-probe9.mjs`）。
 */
export const THS_BOARD_LIST_PAGE_URL_BASE =
  'https://q.10jqka.com.cn/thshy/index/field/199112/order/desc/page/';

/** 分页地址尾段（`<page>` 与 `/ajax/1/` 之间插页码） */
export const THS_BOARD_LIST_PAGE_URL_SUFFIX = '/ajax/1/';

/** 从第几页开始翻（首页已由清单页本身取到） */
export const THS_BOARD_LIST_NEXT_PAGE = 2;

/** 最多翻到第几页（护栏：防止上游改版导致无限翻页） */
export const THS_BOARD_LIST_MAX_PAGES = 4;

/**
 * 同花顺板块日 K 基址（年文件）
 *
 * 完整形态 `${base}${boardCode}/01/${year}.js`，如
 * `https://d.10jqka.com.cn/v6/line/48_881121/01/2026.js`；
 * 返回 JSONP `quotebridge_v6_line_48_881121_01_2026({"data":"日期,开,高,低,收,量,额,...;..."})`
 */
export const THS_BOARD_KLINE_URL_BASE = 'https://d.10jqka.com.cn/v6/line/48_';

/** 同花顺板块年 K 的路径分段符（`…/48_<code>/<复权>/<year>.js`） */
export const THS_BOARD_KLINE_URL_MIDDLE = '/';

/** 同花顺板块年 K 的路径中段（`…/<code>/<复权>/<year>.js`）：主用前复权 */
export const THS_BOARD_KLINE_ADJUST_PRIMARY = '01';

/**
 * 同花顺复权口径回退值（`00` = 不复权）
 *
 * 实测：部分板块的 `01` 年文件被上游网关拒绝（502），而 `00` 正常；也有反过来
 * 只有 `01` 可用的板块。板块点位本身不做复权处理也不影响成交额口径，
 * 因此按「主用 → 回退」逐个尝试，首个有数据的胜出。
 */
export const THS_BOARD_KLINE_ADJUST_FALLBACK = '00';

/** 复权与年份都取不到时，向前回退的年数（去年文件兜底） */
export const THS_BOARD_KLINE_YEAR_FALLBACK = 1;

/**
 * 同一候选 URL 对 5xx 网关错误的尝试次数（含首次）
 *
 * 实测（2026-09-18）：`d.10jqka.com.cn` 的 openresty 网关会**瞬时 502** ——
 * 同一代码 `01/2026` 连续 502，而同代码的 `00/2026` 立即 200，稍后重试部分自愈；
 * 一次 90 板块的扫描曾因此 14 个整板失败（四个候选 URL 恰好全撞上）。
 * 对 5xx 在原 URL 上小步重试一次，仍在频率红线内（间隔 ≥ `MAINLINE_SCAN_DELAY_MS`）。
 */
export const THS_BOARD_KLINE_URL_ATTEMPTS = 2;

/** 5xx 起始状态码（含）—— 视为可重试的网关瞬时错误 */
export const THS_HTTP_SERVER_ERROR_MIN = 500;

/** 同花顺要求带 Referer，否则可能被拒 */
export const THS_REFERER = 'https://q.10jqka.com.cn/';

/** 同花顺板块清单里板块代码的前缀（88xxxx 为行业板块；概念板块不在本期范围） */
export const THS_INDUSTRY_CODE_PREFIX = '88';

/**
 * 东财涨停池的行业名 → 同花顺行业板块名（**近似归属**）
 *
 * 涨停池的 `hybk` 用的是东财（≈申万）行业口径，与同花顺行业板块**不是同一套分类**，
 * 且长名会被上游截断到 4 个汉字（`光学光电子` → `光学光电`，由前缀匹配自动兜住）。
 * 下表是**分类口径不同、名称也不同**时的兜底映射，只收录语义等价、可确认的对应关系：
 *
 * - 截断名（光学光电 / 汽车零部 / 计算机设 …）由前缀匹配处理，不在此表；
 * - 两套分类下**无法确认**对应板块的（`文娱用品`、`照明设备`）**故意不收录** ——
 *   宁可让它们落进「未归属」计数并在界面如实展示，也不猜一个板块出去；
 * - 上游分类调整时本表会漂移，故 `scan_meta` 会记录未归属家数，便于发现漂移。
 */
export const MAINLINE_INDUSTRY_ALIAS: Readonly<Record<string, string>> = {
  '工程咨询': '建筑装饰',
  '专业工程': '建筑装饰',
  '装修装饰': '建筑装饰',
  '装修建材': '建筑材料',
  '出版': '文化传媒',
  '广告营销': '文化传媒',
  '一般零售': '零售',
  '炼化及贸': '石油加工贸易',
  '旅游及景': '旅游及酒店',
  '非白酒': '饮料制造',
  '铁路公路': '公路铁路运输',
  '冶钢原料': '钢铁',
  // 2026-09-18 真实涨停池实测补齐（申万二级名 → 同花顺板块）：
  // 航运港口 与 港口航运 属词序颠倒，前后缀匹配都救不了，必须显式别名
  '商用车': '汽车整车',
  '焦炭Ⅱ': '煤炭开采加工',
  '玻璃玻纤': '建筑材料',
  '航运港口': '港口航运',
};

/** 东财涨停池类型（主线只取涨停池） */
export const MAINLINE_LIMIT_UP_POOL_TYPE = 'zt';

/** 单次扫描的同上游并发上限（频率红线：不得高于 3） */
export const MAINLINE_SCAN_CONCURRENCY = 3;

/** 同上游连续请求间隔（毫秒，频率红线） */
export const MAINLINE_SCAN_DELAY_MS = 500;

/**
 * 扫描第二轮补采的间隔（毫秒）
 *
 * 502 网关错误呈「突发簇」分布（一轮扫描里集中出现），整轮跑完等一小段时间
 * 再补采失败板块的自愈率显著更高；第二轮轮内同上游间隔也用该值（比首轮更稀疏）。
 */
export const MAINLINE_SCAN_RETRY_DELAY_MS = 2000;

/** 每板块保留的最大历史交易日数（约一年，够算分位又不过度膨胀） */
export const MAINLINE_MAX_HISTORY_DAYS = 260;

/**
 * 基准交易日的覆盖率门槛（0-1）
 *
 * 基准日 = 最近一个「有行情 bar 的板块数 ≥ 全清单 × 本比例」的交易日。
 * 实测依据：完整交易日稳定在 88/90 ≈ 0.978；盘中只有 68/90 ≈ 0.756 且两市成交额只有半日值，
 * 两者不可比（实测同一时点「板块合计 ÷ 两市」= 35.6%，而完整日为 98.5%），故必须整表按同一日截面计算。
 */
export const MAINLINE_BENCHMARK_COVERAGE_RATIO = 0.85;

/**
 * 当日数据「落定」时刻（本地时间，当日 0 点起的分钟数）
 *
 * 收盘 15:00 后上游年 K 与成交额还需落定，取 15:30 作缓冲：早于该时刻扫描时，
 * **当日 bar 一律不写入历史**（半日 bar 一旦落库就会污染占比分位序列，且不会自愈）。
 */
export const MAINLINE_SETTLE_MINUTES = 15 * 60 + 30;

/** 元 → 亿元 的换算基数（展示用） */
export const YUAN_PER_YI = 1e8;

/** 亿元单位文案 */
export const YI_UNIT = '亿';

/** 百分比数值转小数比率时的基数 */
export const PERCENT_BASE = 100;

// ---------- 判定阈值（对应技能 phase-rules 的可自动项） ----------

/** 分位与倍数计算所需的最少历史样本（不足则判「数据不足」） */
export const MAINLINE_MIN_HISTORY_DAYS = 30;

/** 短期量能窗口（交易日）：近 5 日成交额均值 */
export const MAINLINE_SHORT_WINDOW = 5;

/** 中期量能窗口（交易日）：近 20 日成交额均值 */
export const MAINLINE_LONG_WINDOW = 20;

/**
 * 量能倍数分母的滞后长度（交易日）
 *
 * 现行量能倍数 = 近 5 日均额 ÷ 近 20 日均额，**分母含分子** → 比值被近期自身水平拉动，
 * 板块越放量比值越被低估，同一阈值对不同板块不等价（实测同一天半导体 +16.9%、
 * 通信设备 −9.6%、通用设备 +11.8% 的口径差）。故改用「前 20 日（不含最近 5 日）」作分母。
 */
export const MAINLINE_AMOUNT_BASELINE_LAG = 5;

/** 价格分位窗口（交易日） */
export const MAINLINE_PRICE_WINDOW = 60;

/** 狂热期：成交占比历史分位下线（%） */
export const MANIA_MIN_SHARE_PERCENTILE = 90;

/**
 * 狂热期：成交占比的容量门槛（%）—— 占比过小的板块即便分位到 100，
 * 也只是微板块的资金噪声，不称「狂热」（替代技能里没接入的市值容量预过滤）
 */
export const MANIA_MIN_TURNOVER_SHARE = 1;

/** 狂热期：价格分位下线（%）—— 拥挤之外还要求价格处于高位，才叫赔率恶化 */
export const MANIA_MIN_PRICE_PERCENTILE = 70;

/** 狂热期：近 20 日累计涨幅的替代口径（%）—— 价格分位不足时用中期涨幅兜底 */
export const MANIA_MIN_CHANGE20 = 15;

/** 瓦解期：成交占比历史分位下线（%）—— 高位放量下跌 */
export const COLLAPSE_MIN_SHARE_PERCENTILE = 70;

/**
 * 瓦解期：成交占比容量门槛（%）
 *
 * 原值 0.5% 与真实分布不匹配（全板块占比中位数就是 0.55%，等于不过滤），
 * 与狂热期对齐取 1%，让容量真正起「噪声过滤」作用。
 */
export const COLLAPSE_MIN_TURNOVER_SHARE = 1;

/** 瓦解期：价格分位下线（%）—— 「高位」下跌才叫瓦解，低位下跌只是弱 */
export const COLLAPSE_MIN_PRICE_PERCENTILE = 50;

/** 瓦解期：近 5 日累计涨幅上限（%） */
export const COLLAPSE_MAX_CHANGE5 = -5;

/**
 * 确认期：量能倍数下线（滞后口径：近 5 日均额 ÷ 前 20 日均额）
 *
 * 口径从「窗口重叠」改为「滞后」后需要重标：按实测 5 个板块的新旧差异（+5.8% ~ +16.9%）
 * 反推，旧口径 1.2 约等于新口径 1.35。**该阈值属一次性标定，待累积 20+ 个交易日的
 * 结构序列后应用真实分位回测复核**（界面同时展示新旧两套倍数供观察）。
 */
export const CONFIRMED_MIN_AMOUNT_RATIO = 1.35;

/** 确认期：收盘价需站上 60 日高点的比例（0.97 = 距高点 3% 以内） */
export const CONFIRMED_NEAR_HIGH_RATIO = 0.97;

/**
 * 确认期：板块内涨停家数下限
 *
 * 「抱团主线」必须有个股层面的涨停参与 —— 只有价格强、内部无涨停的板块，
 * 更可能是权重股拉抬（假确认）。取 1 是**极宽**的门槛，只否决「完全没有涨停」的极端情形；
 * 更严的结构门槛需回测后再定。
 */
export const CONFIRMED_MIN_LIMIT_UP = 1;

/** 确认期：板块宽度下限（%），涨停家数为 0 时的替代条件（上涨家数占比） */
export const CONFIRMED_MIN_BREADTH_PERCENT = 60;

/** 萌芽期：量能倍数的异常抬升下线（滞后口径）—— 低位放量是萌芽的核心特征 */
export const GERMINATION_MIN_AMOUNT_RATIO = 1.7;

/** 萌芽期：成交占比分位上限（%），超过就不是「低位」了 */
export const GERMINATION_MAX_SHARE_PERCENTILE = 50;

/** 萌芽期：近 5 日累计涨幅上限（%），已经暴涨的不算萌芽 */
export const GERMINATION_MAX_CHANGE5 = 15;

/** 主线候选：成交占比分位下线（%）—— 命中即标「主线候选」 */
export const CANDIDATE_MIN_SHARE_PERCENTILE = 70;

/** 主线候选：量能倍数下线（滞后口径） */
export const CANDIDATE_MIN_AMOUNT_RATIO = 1.7;

// ---------- 结构指标阈值（涨停 / 宽度 / 净流入） ----------

/**
 * 情绪加速：板块内最高连板数下限
 *
 * 3 板是「连板梯队成型」的经验分界（今日实测全市场最高 4 板、2 板及以上 10 家）。
 * 命中只**追加风险提示与展示标记**，不改变阶段判定 —— 只有一天的结构样本不足以定阶段门槛。
 */
export const MANIA_MIN_STREAK = 3;

/** 情绪加速：涨停占比下限（%），连板高度的替代条件 */
export const MANIA_MIN_LIMIT_UP_RATIO = 2;

// ---------- 阶段标签 ----------

/** 四阶段（+ 无 / 数据不足），取值与技能 JSON 的 `phase` 对齐 */
export const MAINLINE_PHASE = {
  /** 萌芽：低位放量，潜在新抱团（多数会证伪，只做观察） */
  GERMINATION: 'germination',
  /** 确认：抱团主线成型 */
  CONFIRMED: 'confirmed_group',
  /** 狂热：筹码拥挤 + 成交占比历史极值，赔率恶化 */
  MANIA: 'mania',
  /** 瓦解：高位放量下跌，景气/筹码松动 */
  COLLAPSE: 'collapse',
  /** 未成主线：无明显抱团特征 */
  NONE: 'none',
  /** 数据不足：历史样本不够，不下结论 */
  UNKNOWN: 'insufficient_data',
} as const;

/** 阶段取值类型 */
export type MainlinePhase = (typeof MAINLINE_PHASE)[keyof typeof MAINLINE_PHASE];

/** 阶段中文标签 */
export const MAINLINE_PHASE_LABEL = {
  germination: '萌芽',
  confirmed_group: '确认',
  mania: '狂热',
  collapse: '瓦解',
  none: '未成主线',
  insufficient_data: '数据不足',
} as const satisfies Record<MainlinePhase, string>;

/** 阶段徽标样式（宿主 token：涨红跌绿，狂热用主色提示风险） */
export const MAINLINE_PHASE_BADGE_CLASS = {
  germination: 'bg-flat-weak text-text-secondary',
  confirmed_group: 'bg-up-weak text-up',
  mania: 'bg-primary-weak text-primary',
  collapse: 'bg-down-weak text-down',
  none: 'bg-flat-weak/60 text-text-tertiary',
  insufficient_data: 'bg-flat-weak/60 text-text-tertiary',
} as const satisfies Record<MainlinePhase, string>;

/** 阶段排序权重（越小越靠前，用于看板默认排序） */
export const MAINLINE_PHASE_ORDER = {
  mania: 0,
  collapse: 1,
  confirmed_group: 2,
  germination: 3,
  none: 4,
  insufficient_data: 5,
} as const satisfies Record<MainlinePhase, number>;

/** 阶段一句话说明（判定结论文案，只讲状态不讲买卖） */
export const MAINLINE_PHASE_DESC = {
  germination:
    '萌芽期：成交占比自低位快速抬升，但拥挤度尚低。潜在新抱团，多数会证伪，仅作观察。',
  confirmed_group:
    '确认期：量能持续放大且价格创阶段新高，抱团主线成型。需连续两季业绩验证方能成立。',
  mania:
    '狂热期：筹码拥挤、成交占比处于历史极值区间，赔率恶化，瓦解风险抬升。',
  collapse:
    '瓦解期：高位放量下跌，筹码开始松动，容易超预期下跌。',
  none: '无明显抱团特征：成交占比与量能均未抬升。',
  insufficient_data: '历史样本不足，不下阶段结论 —— 缺样本不等于状态正常。',
} as const satisfies Record<MainlinePhase, string>;

/** 阶段风险提示（可为空数组；一律为状态语言，不含买卖指令） */
export const MAINLINE_PHASE_WARNINGS = {
  germination: ['萌芽期多数最终证伪，不能作为入场依据，只做观察池跟踪。'],
  confirmed_group: ['确认期需连续两季业绩验证；本期未接入业绩/估值分位数据，判定置信度受限。'],
  mania: [
    '成交占比处于历史极值，拥挤度带来的赔率恶化需要正视。',
    '抱团末期常见「利好钝化」与波动放大，瓦解风险抬升。',
  ],
  collapse: ['高位放量下跌常伴随超预期回撤，注意情绪与流动性的负反馈。'],
  none: [],
  insufficient_data: ['样本天数不足，请继续每日扫描以累积分位序列。'],
} as const satisfies Record<MainlinePhase, readonly string[]>;

// ---------- 界面文案 ----------

/** 页面标题 */
export const MAINLINE_PAGE_TITLE = '股票主线';

/** 页面副标题（说明工具定位与硬约束） */
export const MAINLINE_PAGE_SUBTITLE =
  '板块抱团主线阶段判定：成交占比分位 / 量能倍数 / 价格分位 → 萌芽·确认·狂热·瓦解。辅助研判工具，只输出阶段与风险提示，不含任何买卖或仓位指令。';

/** 扫描按钮文案 */
export const MAINLINE_SCAN_BUTTON = '扫描主线';

/** 扫描中按钮文案前缀 */
export const MAINLINE_SCAN_RUNNING = '扫描中';

/** 扫描进度文案模板（已请求数 / 总数） */
export const MAINLINE_SCAN_PROGRESS_SUFFIX = '个板块';

/** 首次空态文案 */
export const MAINLINE_EMPTY_TEXT = '还没有主线快照，点「扫描主线」拉取同花顺行业板块与成交额历史';

/** 无历史样本提示（表格内） */
export const MAINLINE_NO_SAMPLE_TEXT = '无样本';

/** 指标缺失占位（分位等无法计算时） */
export const MAINLINE_METRIC_PLACEHOLDER = '—';

/** 扫描失败文案前缀 */
export const MAINLINE_SCAN_FAILED = '扫描失败';

/** 表格列标题 */
export const MAINLINE_COLUMN_LABEL = {
  name: '板块',
  phase: '阶段',
  change: '当日',
  change5: '近5日',
  share: '成交占比',
  sharePercentile: '占比分位',
  amountRatio: '量能倍数',
  pricePercentile: '价格分位',
  limitUp: '涨停',
  breadth: '宽度',
  netInflow: '净流入',
} as const;

/** 明细区小标题 */
export const MAINLINE_DETAIL_TITLE = '指标明细';

/** 明细区字段标签 */
export const MAINLINE_DETAIL_LABEL = {
  asOf: '数据截止',
  benchmark: '基准交易日',
  historyDays: '历史样本',
  latestChange: '当日涨跌',
  change5: '近 5 日累计',
  change20: '近 20 日累计',
  amount: '当日成交额',
  turnoverShare: '当日成交占比',
  sharePercentile: '成交占比历史分位',
  amountRatio: '量能倍数（5日/前20日）',
  amountRatioOverlap: '量能倍数（旧口径 5日/20日）',
  pricePercentile: '价格分位（60 日）',
  limitUpCount: '涨停家数',
  maxStreak: '最高连板',
  sealFund: '封板资金合计',
  limitUpRatio: '涨停占比',
  riseFall: '上涨 / 下跌家数',
  breadth: '板块宽度',
  netInflow: '主力净流入',
  leader: '领涨股',
  confidence: '置信度',
} as const;

/** 明细区单位与后缀 */
export const MAINLINE_DETAIL_UNIT = {
  days: '个交易日',
  times: '×',
  houses: '家',
  boards: '板',
} as const;

/** 缺失输入标题与说明（不静默：缺什么明说） */
export const MAINLINE_MISSING_TITLE = '本期未接入的输入';

/** 缺失输入条目（数据现实：这些指标免费源拿不到或本期未实现） */
export const MAINLINE_MISSING_INPUTS = [
  '公募基金板块持仓分位（免费源无干净接口，需按报告期自建季度序列）',
  '板块 PE/PB 估值分位（东财板块快照 PE 实测返回空、PB 仅有当日值，需每日累积快照后给分位）',
  '龙头连续两季业绩验证（东财 datacenter 可按行业取，本期未接入）',
  '北向持股环比方向（实测最新披露日为 2026-06-30，属季度频率，日频环比不可得）',
] as const;

/** 已接入输入清单（与「未接入」对照展示，避免用户以为结构指标也没接） */
export const MAINLINE_CONNECTED_TITLE = '本期已接入的输入';

/** 已接入输入条目 */
export const MAINLINE_CONNECTED_INPUTS = [
  '成交占比历史分位（同花顺行业板块成交额 ÷ 沪深两市总成交额，按基准日截面）',
  '量能倍数（近 5 日均额 ÷ 前 20 日均额，已改滞后口径；界面同时给出旧口径对照）',
  '价格分位（收盘价在近 60 日区间中的分位）',
  '板块内涨停家数 / 最高连板 / 封板资金合计（东财涨停池按行业归属聚合）',
  '板块宽度（上涨 ÷ 上涨+下跌）与主力净流入（同花顺行业清单页快照）',
] as const;

/** 置信度文案 */
export const MAINLINE_CONFIDENCE_LABEL = {
  high: '高（样本充足）',
  medium: '中（样本一般）',
  low: '低（样本不足）',
} as const;

/** 置信度档位类型 */
export type MainlineConfidence = keyof typeof MAINLINE_CONFIDENCE_LABEL;

/** 样本充足所需交易日数（达到即 high） */
export const MAINLINE_CONFIDENCE_HIGH_DAYS = 120;

/** 样本中等所需交易日数（低于低档阈值即 low） */
export const MAINLINE_CONFIDENCE_MEDIUM_DAYS = 60;

/**
 * 免责声明
 *
 * 三条实测口径必须写明，否则用户会把「12.58%」直接读成全市场占比：
 * 板块合计 ≈ 全市场 98.5%（实测 9/15~9/17 为 0.984~0.986，缺口为取数失败板块与口径差）；
 * 指标一律取**最近完整交易日**截面（盘中不落半日 bar）；结构指标来自榜单快照与涨停池。
 */
export const MAINLINE_DISCLAIMER =
  '仅历史统计规则下的状态判定，是概率工具而非预言，不构成投资建议，不含任何买卖或仓位指令。成交占比口径为「同花顺行业板块成交额 ÷ 沪深两市总成交额」，板块合计约为全市场成交额的 98.5%（实测 9/15~9/17 为 98.4%~98.6%），故占比存在约 1.5% 的系统性低估，但分位是同一基准下的相对位置、不受该缺口影响。全部指标一律取**最近完整交易日**截面：盘中扫描不写入当日半日数据，避免污染占比分位序列。涨停家数、连板高度、封板资金来自东财涨停池（按行业归属聚合，未归属家数在页头如实列出）；上涨/下跌家数、主力净流入来自同花顺行业清单页。';

/** 风险提示区标题 */
export const MAINLINE_WARNING_TITLE = '风险提示';

/** 主线候选徽标文案 */
export const MAINLINE_CANDIDATE_BADGE = '主线候选';

/**
 * 数据滞后徽标文案模板
 * @param days 滞后交易日数
 * @returns 徽标文案
 */
export const MAINLINE_STALE_BADGE = (days: number): string => `滞后${days}日`;

/** 情绪加速徽标文案 */
export const MAINLINE_STRUCTURE_HOT_BADGE = '情绪加速';

/** 表格行 key 前缀（板块代码本身唯一，保留前缀便于将来区分来源） */
export const MAINLINE_ROW_KEY_PREFIX = 'ths-';

// ---------- 页头说明文案 ----------

/** 页头字段标签 */
export const MAINLINE_HEADER_LABEL = {
  benchmark: '基准交易日',
  coverage: '覆盖板块',
  boardCount: '板块总数',
  marketAmount: '两市成交额',
  scannedAt: '上次扫描',
  limitUp: '基准日涨停',
  structure: '结构指标',
} as const;

/**
 * 基准日覆盖率文案模板（如「88 / 90 个板块」）
 * @param coverage 基准日有行情的板块数
 * @param total 板块总数
 * @returns 文案
 */
export const MAINLINE_COVERAGE_TEXT = (coverage: number, total: number): string =>
  `${coverage} / ${total} 个板块`;

/**
 * 结构指标采集说明模板（涨停家数 + 未归属家数）
 * @param total 基准日全市场涨停家数
 * @param unmapped 未能归属到板块的涨停家数
 * @returns 文案
 */
export const MAINLINE_LIMIT_UP_TEXT = (total: number, unmapped: number): string =>
  unmapped > 0 ? `全市场 ${total} 家（未归属板块 ${unmapped} 家）` : `全市场 ${total} 家`;

/** 结构指标未采集文案 */
export const MAINLINE_STRUCTURE_UNAVAILABLE = '未采集（本次取数失败）';

/**
 * 盘中未落定提示模板（说明当日 bar 为何没写入）
 * @param date 被排除的日期
 * @param benchmark 实际采用的基准交易日
 * @returns 文案
 */
export const MAINLINE_INTRADAY_NOTICE = (date: string, benchmark: string): string =>
  `${date} 当日数据尚未落定（盘中为半日值），本次未写入当日行情；全部指标按最近完整交易日 ${benchmark} 计算。`;

/**
 * 基准日覆盖率不足提示模板（连完整交易日都凑不齐覆盖率时的降级说明）
 * @param benchmark 实际采用的基准交易日
 * @returns 文案
 */
export const MAINLINE_DEGRADED_NOTICE = (benchmark: string): string =>
  `未找到覆盖率达标的交易日，已退回覆盖最全的 ${benchmark}；该日部分板块行情缺失，横截面比较需谨慎。`;

// ---------- 判定层动态文案 ----------

/**
 * 滞后板块的风险提示模板
 * @param days 滞后交易日数
 * @returns 提示文案
 */
export const MAINLINE_WARNING_STALE = (days: number): string =>
  `该板块行情滞后基准日 ${days} 个交易日，指标非同一截面，本行不参与阶段判定（等取数恢复后自动回到正常判定）。`;

/** 结构指标缺失时的风险提示 */
export const MAINLINE_WARNING_NO_STRUCTURE =
  '本期未采集到板块内涨停与宽度数据，结构门槛未参与本次判定。';

/**
 * 确认期被结构门槛否决时的提示模板
 * @param limitUpCount 板块内涨停家数
 * @param breadth 板块宽度（%）
 * @returns 提示文案
 */
export const MAINLINE_WARNING_STRUCTURE_FAIL = (limitUpCount: number, breadth: number): string =>
  `量价与拥挤度特征具备，但板块内涨停 ${limitUpCount} 家、宽度 ${breadth.toFixed(1)}%，内部结构不支持抱团主线，故不判「确认」。`;

/**
 * 情绪加速的风险提示模板
 * @param maxStreak 板块内最高连板数
 * @param limitUpRatio 涨停占比（%）
 * @returns 提示文案
 */
export const MAINLINE_WARNING_STRUCTURE_HOT = (maxStreak: number, limitUpRatio: number): string =>
  `板块内最高 ${maxStreak} 板、涨停占比 ${limitUpRatio.toFixed(1)}%，个股层面已进入情绪加速段，波动通常同步放大。`;

/**
 * 确认期板块无涨停的提示模板
 * @param breadth 板块宽度（%）
 * @returns 提示文案
 */
export const MAINLINE_WARNING_NO_LIMIT_UP = (breadth: number): string =>
  `板块内无涨停个股（宽度 ${breadth.toFixed(1)}%），确认期的个股参与度偏弱，需继续观察。`;

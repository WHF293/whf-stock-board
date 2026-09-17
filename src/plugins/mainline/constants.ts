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

/** 同花顺要求带 Referer，否则可能被拒 */
export const THS_REFERER = 'https://q.10jqka.com.cn/';

/** 同花顺板块清单里板块代码的前缀（88xxxx 为行业板块；概念板块不在本期范围） */
export const THS_INDUSTRY_CODE_PREFIX = '88';

/** 单次扫描的同上游并发上限（频率红线：不得高于 3） */
export const MAINLINE_SCAN_CONCURRENCY = 3;

/** 同上游连续请求间隔（毫秒，频率红线） */
export const MAINLINE_SCAN_DELAY_MS = 500;

/** 每板块保留的最大历史交易日数（约一年，够算分位又不过度膨胀） */
export const MAINLINE_MAX_HISTORY_DAYS = 260;

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

/** 瓦解期：成交占比容量门槛（%）—— 同狂热期，过滤微板块噪声 */
export const COLLAPSE_MIN_TURNOVER_SHARE = 0.5;

/** 瓦解期：价格分位下线（%）—— 「高位」下跌才叫瓦解，低位下跌只是弱 */
export const COLLAPSE_MIN_PRICE_PERCENTILE = 50;

/** 瓦解期：近 5 日累计涨幅上限（%） */
export const COLLAPSE_MAX_CHANGE5 = -5;

/** 确认期：量能倍数（5 日均额 / 20 日均额）下线 */
export const CONFIRMED_MIN_AMOUNT_RATIO = 1.2;

/** 确认期：收盘价需站上 60 日高点的比例（0.97 = 距高点 3% 以内） */
export const CONFIRMED_NEAR_HIGH_RATIO = 0.97;

/** 萌芽期：量能倍数的异常抬升下线 —— 低位放量是萌芽的核心特征 */
export const GERMINATION_MIN_AMOUNT_RATIO = 1.5;

/** 萌芽期：成交占比分位上限（%），超过就不是「低位」了 */
export const GERMINATION_MAX_SHARE_PERCENTILE = 50;

/** 萌芽期：近 5 日累计涨幅上限（%），已经暴涨的不算萌芽 */
export const GERMINATION_MAX_CHANGE5 = 15;

/** 主线候选：成交占比分位下线（%）—— 命中即标「主线候选」 */
export const CANDIDATE_MIN_SHARE_PERCENTILE = 70;

/** 主线候选：量能倍数下线 */
export const CANDIDATE_MIN_AMOUNT_RATIO = 1.5;

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
} as const;

/** 明细区小标题 */
export const MAINLINE_DETAIL_TITLE = '指标明细';

/** 明细区字段标签 */
export const MAINLINE_DETAIL_LABEL = {
  asOf: '数据截止',
  historyDays: '历史样本',
  latestChange: '当日涨跌',
  change5: '近 5 日累计',
  change20: '近 20 日累计',
  amount: '当日成交额',
  turnoverShare: '当日成交占比',
  sharePercentile: '成交占比历史分位',
  amountRatio: '量能倍数（5日/20日）',
  pricePercentile: '价格分位（60 日）',
  confidence: '置信度',
} as const;

/** 明细区单位与后缀 */
export const MAINLINE_DETAIL_UNIT = {
  days: '个交易日',
  times: '×',
} as const;

/** 缺失输入标题与说明（不静默：缺什么明说） */
export const MAINLINE_MISSING_TITLE = '本期未接入的输入';

/** 缺失输入条目（数据现实：这些指标免费源拿不到或本期未实现） */
export const MAINLINE_MISSING_INPUTS = [
  '公募基金板块持仓分位（免费源无干净接口，需人工/自建序列）',
  '板块 PE/PB 估值分位（需累积日度快照或人工序列）',
  '龙头连续两季业绩验证（东财 datacenter 接口本期未接入）',
  '北向持股环比方向（季度频率，本期未接入）',
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

/** 免责声明 */
export const MAINLINE_DISCLAIMER =
  '仅历史统计规则下的状态判定，是概率工具而非预言，不构成投资建议，不含任何买卖或仓位指令。成交占比口径为「同花顺行业板块成交额 ÷ 沪深两市总成交额」，板块口径与全市场口径存在少量重叠差异。';

/** 风险提示区标题 */
export const MAINLINE_WARNING_TITLE = '风险提示';

/** 主线候选徽标文案 */
export const MAINLINE_CANDIDATE_BADGE = '主线候选';

/** 表格行 key 前缀（板块代码本身唯一，保留前缀便于将来区分来源） */
export const MAINLINE_ROW_KEY_PREFIX = 'ths-';

/**
 * 板块日历（板块热点 · 赚钱效应）常量集中管理
 *
 * 数据源与口径的实测依据见
 * `.ai/开发方案/2026-09-14-板块日历与赚钱效应开发方案.md`
 */

/* --------------------------------- 上游接口 --------------------------------- */

/**
 * 上游接口地址
 *
 * 全部为本机实测可达通道；`push2.eastmoney.com` / `push2his.eastmoney.com`
 * （含数字前缀镜像）已被 TCP 层封禁，勿改回——板块数据只能走 `push2delay`。
 */
export const BOARD_CALENDAR_URL = {
  /** 板块列表（行业 496 / 概念 504），单页硬上限 100，需 pn 翻页 */
  BOARD_LIST: 'https://push2delay.eastmoney.com/api/qt/clist/get',
  /** 板块批量快照（`secids` 一次查整个板块池，含涨跌家数） */
  BOARD_QUOTE: 'https://push2delay.eastmoney.com/api/qt/ulist.np/get',
  /** 涨停池（date 参数可回溯约 14 个交易日） */
  LIMIT_UP_POOL: 'https://push2ex.eastmoney.com/getTopicZTPool',
  /** 跌停池 */
  LIMIT_DOWN_POOL: 'https://push2ex.eastmoney.com/getTopicDTPool',
  /** 交易日轴（腾讯日 K，与 turnover.api.ts 同源） */
  TENCENT_KLINE: 'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get',
} as const;

/** 涨停 / 跌停池接口固定 token（实测可用） */
export const LIMIT_POOL_TOKEN = '7eea3edcaed734bea9cbfc24409ed989';

/** 涨停池排序：按首封时间升序（与东财涨停池页一致） */
export const LIMIT_UP_POOL_SORT = 'fbt:asc';

/** 跌停池排序：按封单资金升序 */
export const LIMIT_DOWN_POOL_SORT = 'fund:asc';

/** 涨跌停池单次拉取条数（该接口 pagesize 不受 100 限制，实测 1000 全返回） */
export const LIMIT_POOL_PAGE_SIZE = 1000;

/** 列表类接口单页条数（clist 硬上限 100，调大只会返回 100；成分股翻页用） */
export const BOARD_LIST_PAGE_SIZE = 100;

/**
 * 板块 secid 前缀（东财「板块」市场号为 90）
 *
 * 用于 `ulist.np/get?secids=90.BKxxxx` 一次批量查询整个板块池（行业与概念板块同接口）。
 */
export const BOARD_SECID_PREFIX = '90';

/**
 * 板块快照批量查询字段
 *
 * `f104/f105/f106` = 上涨 / 下跌 / 平盘家数（2026-09-14 实测 `ulist.np/get` 单请求即返回）
 */
export const BOARD_SNAPSHOT_FIELDS = 'f12,f14,f3,f6,f104,f105,f106';

/** 交易日轴读取的日 K 条数（≈1.5 年交易日，覆盖「180 天」档且留余量） */
export const TRADING_KLINE_LIMIT = 400;

/** 腾讯源 Referer（缺失可能被拒） */
export const TENCENT_REFERER = 'https://gu.qq.com/';

/** 东财上游 User-Agent（缺失可能被拒） */
export const EASTMONEY_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

/** 串行请求间隔（毫秒）：收敛对公共上游的压力 */
export const BOARD_REQUEST_GAP_MS = 300;

/** 成分股映射拉取的并发上限 */
export const CONSTITUENT_SYNC_CONCURRENCY = 3;

/**
 * 历史回补时「同时在探的交易日」上限
 *
 * 每日 2 请求（涨停池 + 跌停池，日内 300ms 错峰）→ 在飞请求 ≤ 3 × 1 = 3，与全局
 * 并发上限一致；首次全窗口（`ZT_BACKFILL_DAYS` 天）补采从串行 ~15s 压到 ~5s。
 */
export const BACKFILL_CONCURRENCY = 3;

/* ------------------------------ 申万一级行业白名单 ------------------------------ */

/**
 * 候选池：31 个申万一级行业 → 东财板块代码
 *
 * 2026-09-14 实测：名称精确匹配 `f14` **31/31 命中、无重名**；
 * 31 个板块成分股合计 5621 只、**跨一级行业重复 0**（确为不重叠划分）。
 *
 * ⚠️ 匹配必须用「精确等于」，不要用 includes——
 * 否则「综合」会命中「综合Ⅱ / 综合Ⅲ / 综合乘用车」等 14 条。
 */
export const SW_LEVEL1_BOARDS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'BK0433', name: '农林牧渔' },
  { code: 'BK1206', name: '基础化工' },
  { code: 'BK0479', name: '钢铁' },
  { code: 'BK0478', name: '有色金属' },
  { code: 'BK1201', name: '电子' },
  { code: 'BK1211', name: '汽车' },
  { code: 'BK0456', name: '家用电器' },
  { code: 'BK0438', name: '食品饮料' },
  { code: 'BK0436', name: '纺织服饰' },
  { code: 'BK1212', name: '轻工制造' },
  { code: 'BK1216', name: '医药生物' },
  { code: 'BK0427', name: '公用事业' },
  { code: 'BK1210', name: '交通运输' },
  { code: 'BK1202', name: '房地产' },
  { code: 'BK1213', name: '商贸零售' },
  { code: 'BK1214', name: '社会服务' },
  { code: 'BK1217', name: '综合' },
  { code: 'BK1208', name: '建筑材料' },
  { code: 'BK1209', name: '建筑装饰' },
  { code: 'BK1200', name: '电力设备' },
  { code: 'BK1204', name: '国防军工' },
  { code: 'BK1207', name: '计算机' },
  { code: 'BK0486', name: '传媒' },
  { code: 'BK1215', name: '通信' },
  { code: 'BK1283', name: '银行' },
  { code: 'BK1203', name: '非银金融' },
  { code: 'BK1035', name: '美容护理' },
  { code: 'BK0464', name: '石油石化' },
  { code: 'BK0728', name: '环保' },
  { code: 'BK1205', name: '机械设备' },
  { code: 'BK0437', name: '煤炭' },
];

/* ------------------------------ 追加板块（热门题材） ------------------------------ */

/**
 * 追加板块：热门题材 / 细分行业（东财板块口径，**不是**申万一级）
 *
 * 2026-09-15 实测（`ulist.np/get` 单请求批量可查，且 f104/f105/f106 涨跌平家数对
 * 行业板块与概念板块**都返回**，故与一级行业同一套采集口径）：
 *
 * | 代码 | 名称 | 类型 | 成分股 |
 * |---|---|---|---|
 * | BK1036 | 半导体 | 行业板块 | 186 |
 * | BK0480 | 航天航空 | 概念板块 | 58 |
 * | BK1408 | 机器人 | 行业板块 | 22 |
 * | BK1031 | 光伏设备 | 行业板块 | 69 |
 * | BK0493 | 新能源 | 概念板块 | 219 |
 *
 * 名称取自上游 `f14` 原文（本文件的名称是展示与落库用，不做匹配依据）：
 * - 上游没有叫「航空航天」的板块，最接近的是概念板块「航天航空」BK0480；
 * - 上游没有叫「光伏」的板块，「光伏设备」BK1031 是唯一对应的细分行业
 *   （另有概念板块「光伏概念」BK0588，447 只，口径更宽）。
 *
 * ⚠️ 与申万一级**必然重叠**（半导体 ⊂ 电子、光伏设备 ⊂ 电力设备、机器人 ⊂ 机械设备…），
 * 故成分股映射必须按「一对多」处理（见 `listConstituentBoardMap`）：
 * 同一只票同时计入它的一级行业与命中的追加板块，两边互不排斥。
 */
export const EXTRA_BOARDS: ReadonlyArray<{ code: string; name: string }> = [
  { code: 'BK1036', name: '半导体' },
  { code: 'BK0480', name: '航天航空' },
  { code: 'BK1408', name: '机器人' },
  { code: 'BK1031', name: '光伏设备' },
  { code: 'BK0493', name: '新能源' },
];

/**
 * 板块日历完整板块池（31 个申万一级 + 追加板块）
 *
 * 数组顺序 = 默认行序（申万一级在前，追加板块在后）；
 * 采集、快照批量查询、成分股映射、行序归一化全部以本常量为唯一来源。
 */
export const CALENDAR_BOARDS: ReadonlyArray<{ code: string; name: string }> = [
  ...SW_LEVEL1_BOARDS,
  ...EXTRA_BOARDS,
];

/** 板块池板块数（采集校验 / 页面计数用） */
export const CALENDAR_BOARD_COUNT = CALENDAR_BOARDS.length;

/* --------------------------------- 拼接口径 --------------------------------- */

/**
 * 得分权重（净额口径：涨停 / 跌停不重复计入上涨 / 下跌）
 *
 * 需求字面公式把「上涨家数」里的涨停股计了两次，故默认改用净额口径；
 * 原始口径可由 up/down/limitUp/limitDown 在前端现算，无需重新采集。
 */
export const BOARD_SCORE_WEIGHT = {
  LIMIT_UP: 10,
  LIMIT_DOWN: -10,
  UP: 5,
  DOWN: -5,
} as const;

/**
 * 净额口径得分：涨停 / 跌停不重复计入上涨 / 下跌
 * @param input 当日计数（涨停 / 跌停 / 上涨 / 下跌家数）
 * @param input.limitUp 涨停家数
 * @param input.limitDown 跌停家数
 * @param input.upCount 上涨家数（含涨停）
 * @param input.downCount 下跌家数（含跌停）
 * @returns 原始得分
 */
export const calcBoardScore = (input: {
  limitUp: number;
  limitDown: number;
  upCount: number;
  downCount: number;
}): number =>
  (input.upCount - input.limitUp) * BOARD_SCORE_WEIGHT.UP +
  (input.downCount - input.limitDown) * BOARD_SCORE_WEIGHT.DOWN +
  input.limitUp * BOARD_SCORE_WEIGHT.LIMIT_UP +
  input.limitDown * BOARD_SCORE_WEIGHT.LIMIT_DOWN;

/* ---------------------------------- 色阶 ---------------------------------- */

/**
 * 得分档位（与 theme.css 的 7 档涨跌语义色一一对应）
 *
 * 禁 enum：const 对象 + `BoardScoreBucket` 派生类型（types/board-calendar.types.ts）
 */
export const BOARD_SCORE_BUCKET = {
  UP_STRONG: 'upStrong',
  UP: 'up',
  UP_LIGHT: 'upLight',
  FLAT: 'flat',
  DOWN_LIGHT: 'downLight',
  DOWN: 'down',
  DOWN_STRONG: 'downStrong',
  /** 该日无快照 */
  NONE: 'none',
} as const;

/**
 * 色阶阈值：作用于**得分率**（score ÷ 成分股数）
 *
 * 依据 2026-09-14 实测 31 个一级行业得分率分布 -4.12 ~ +3.93（中位 0.13）标定；
 * 原始分极差过大（5 ~ 1915）必须先归一化，否则大板块永远满色。
 * （2026-09-15 追加的热门板块未单独重标定：得分率口径不变，档位继续沿用。）
 */
export const BOARD_SCORE_LEVEL = {
  STRONG: 3,
  MEDIUM: 1.5,
} as const;

/** 深色档单元格文字色（浅色文字，配深底） */
export const BOARD_CELL_TEXT_ON_STRONG = '#ffffff';

/** 浅色档单元格文字色（深色文字）——`--color-up-light` / `--color-down-light` 在暗色主题下未被覆盖，仍是浅底 */
export const BOARD_CELL_TEXT_ON_LIGHT = '#1f2733';

/** 档位图例（强多 → 极空；hint 由 BOARD_SCORE_LEVEL 拼出，改阈值自动同步） */
export const BOARD_SCORE_LEGEND = [
  { bucket: BOARD_SCORE_BUCKET.UP_STRONG, label: '强多', hint: `≥ +${BOARD_SCORE_LEVEL.STRONG}` },
  {
    bucket: BOARD_SCORE_BUCKET.UP,
    label: '偏多',
    hint: `+${BOARD_SCORE_LEVEL.MEDIUM} ~ +${BOARD_SCORE_LEVEL.STRONG}`,
  },
  { bucket: BOARD_SCORE_BUCKET.UP_LIGHT, label: '微多', hint: `0 ~ +${BOARD_SCORE_LEVEL.MEDIUM}` },
  { bucket: BOARD_SCORE_BUCKET.FLAT, label: '中性', hint: '= 0' },
  { bucket: BOARD_SCORE_BUCKET.DOWN_LIGHT, label: '微空', hint: `-${BOARD_SCORE_LEVEL.MEDIUM} ~ 0` },
  {
    bucket: BOARD_SCORE_BUCKET.DOWN,
    label: '偏空',
    hint: `-${BOARD_SCORE_LEVEL.STRONG} ~ -${BOARD_SCORE_LEVEL.MEDIUM}`,
  },
  { bucket: BOARD_SCORE_BUCKET.DOWN_STRONG, label: '极空', hint: `≤ -${BOARD_SCORE_LEVEL.STRONG}` },
] as const;

/* ------------------------------ 赚钱效应气泡图 ------------------------------ */

/**
 * 气泡图口径（决定气泡面积与横向位置）
 *
 * 默认用**得分率**：同一档位内板块体量差异极大（银行 42 只 vs 医药生物 511 只），
 * 用原始得分会让大板块永远最大（实测原始分极差 5 ~ 1960，得分率仅 -4.4 ~ +4.3）。
 * 颜色档位恒按得分率判定，与表格色阶保持同一口径。
 */
export const BOARD_PROFIT_METRIC = {
  /** 得分率 = 得分 ÷ 成分股数（默认，跨板块可比） */
  SCORE_RATE: 'scoreRate',
  /** 原始得分（净额口径绝对值） */
  SCORE: 'score',
} as const;

/** 气泡图口径默认值 */
export const BOARD_PROFIT_METRIC_DEFAULT = BOARD_PROFIT_METRIC.SCORE_RATE;

/** 气泡图口径选项（BaseTabs） */
export const BOARD_PROFIT_METRIC_OPTIONS = [
  { label: '得分率', value: BOARD_PROFIT_METRIC.SCORE_RATE },
  { label: '原始得分', value: BOARD_PROFIT_METRIC.SCORE },
] as const;

/**
 * 气泡图几何参数（viewBox 单位，实际尺寸由容器宽度等比缩放）
 *
 * 半径取「下限 + 增量 × √(|值| ÷ 最大|值|)」：面积随 |值| 单调同增，
 * 但保留下限让 0 值（多空完全均衡）也画得出来。详见 `utils/bubble-layout.ts`。
 */
export const BOARD_PROFIT_BUBBLE = {
  /** 画布宽度 */
  WIDTH: 1280,
  /** 最小高度（气泡堆叠不高时上下均分留白） */
  MIN_HEIGHT: 380,
  /** 半径下限 */
  MIN_RADIUS: 14,
  /** 半径上限 */
  MAX_RADIUS: 58,
  /** 气泡最小间距 */
  GAP: 4,
  /** 顶部留白 */
  TOP_PADDING: 16,
  /** 底部留白（刻度文案） */
  BOTTOM_PADDING: 46,
  /** 向上堆叠的搜索步长 */
  STACK_STEP: 2,
  /** 气泡内名称字号 */
  NAME_FONT_SIZE: 12,
  /** 气泡内数值字号 */
  VALUE_FONT_SIZE: 10,
  /** 刻度数量目标 */
  TICK_COUNT: 6,
} as const;

/* -------------------------------- 页面交互选项 -------------------------------- */

/** 热门口径（决定行的排序） */
export const BOARD_CALENDAR_HEAT_BASIS = {
  /** 近 N 个交易日累计涨停家数（默认） */
  LIMIT_STREAK: 'limitStreak',
  /** 当日成交额 */
  AMOUNT: 'amount',
} as const;

/** 热门口径默认值 */
export const BOARD_CALENDAR_HEAT_BASIS_DEFAULT = BOARD_CALENDAR_HEAT_BASIS.LIMIT_STREAK;

/** 热门口径选项（BaseTabs） */
export const BOARD_CALENDAR_HEAT_OPTIONS = [
  { label: '近5日涨停', value: BOARD_CALENDAR_HEAT_BASIS.LIMIT_STREAK },
  { label: '当日成交额', value: BOARD_CALENDAR_HEAT_BASIS.AMOUNT },
] as const;

/** 展示范围（交易日列数） */
export const BOARD_CALENDAR_RANGE = {
  D10: '10',
  D20: '20',
  D30: '30',
  D60: '60',
  D180: '180',
  ALL: 'all',
} as const;

/** 展示范围默认值（需求：默认最近 10 天） */
export const BOARD_CALENDAR_RANGE_DEFAULT = BOARD_CALENDAR_RANGE.D10;

/** 展示范围选项（BaseTabs） */
export const BOARD_CALENDAR_RANGE_OPTIONS = [
  { label: '10天', value: BOARD_CALENDAR_RANGE.D10 },
  { label: '20天', value: BOARD_CALENDAR_RANGE.D20 },
  { label: '30天', value: BOARD_CALENDAR_RANGE.D30 },
  { label: '60天', value: BOARD_CALENDAR_RANGE.D60 },
  { label: '180天', value: BOARD_CALENDAR_RANGE.D180 },
  { label: '全部', value: BOARD_CALENDAR_RANGE.ALL },
] as const;

/** 热门口径「近 N 个交易日累计涨停」的 N */
export const HEAT_STREAK_WINDOW = 5;

/* ---------------------------------- 尺寸 ---------------------------------- */

/** 左侧板块列宽度（像素；含板块名 + 代码 + 近 5 日涨停） */
export const BOARD_CALENDAR_NAME_COL_WIDTH = 176;

/** 日期列宽度（像素） */
export const BOARD_CALENDAR_COL_WIDTH = 96;

/** 数据行高度（像素；固定高度是横向虚拟化的前提） */
export const BOARD_CALENDAR_ROW_HEIGHT = 56;

/** 表头行高度（像素） */
export const BOARD_CALENDAR_HEAD_HEIGHT = 44;

/** 横向虚拟化的列过扫描数量（视窗左右各多渲染几列，避免滚动白边） */
export const BOARD_CALENDAR_COL_OVERSCAN = 4;

/* -------------------------------- 采集编排参数 -------------------------------- */

/** stock-board.db 连接地址（唯一落库出口使用） */
export const BOARD_DB_URL = 'sqlite:stock-board.db';

/** 启动采集延迟（毫秒）：不阻塞首屏渲染 */
export const BOARD_SYNC_START_DELAY_MS = 3_000;

/** 成分股映射表刷新间隔（毫秒，7 天）：行业归属变动极少，周更足够 */
export const CONSTITUENT_SYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1_000;

/** 当日快照采集节流（毫秒）：已定稿的快照在此窗口内不重复采集（force 可绕过） */
export const BOARD_SNAPSHOT_THROTTLE_MS = 10 * 60 * 1_000;

/** 历史回补交易日数（涨停池 date 实测仅可回溯约 14 个交易日，超窗口返回 tc=0 自动跳过） */
export const ZT_BACKFILL_DAYS = 20;

/** 收盘定稿时刻（本地小时）：此时间后首次采集标记 is_final */
export const BOARD_FINAL_HOUR = 15;

/** 数据级别：完整快照（当日采集，涨跌家数齐全） */
export const BOARD_DATA_LEVEL = {
  /** 仅回补到涨跌停明细，无涨跌家数 → 不参与色阶 */
  PARTIAL: 0,
  /** 当日完整快照 */
  FULL: 1,
} as const;

/* ------------------------------ 增量采集（关键） ------------------------------ */

/**
 * 增量采集状态键（board_sync_state 键值表）
 *
 * 落库之后的一次采集应当只请求「新增的那一份」：这两项状态把
 * 「每次运行都要重拉的静态数据」与「每次都要重探的窗口外日期」都变成一次性开销。
 */
export const BOARD_SYNC_STATE_KEY = {
  /** 交易日轴缓存（JSON 字符串数组） */
  TRADE_DATES: 'trade_dates',
  /** 涨跌停池可回溯边界（≤ 该日期的历史已探明不可达，不再重试） */
  POOL_BOUNDARY_DATE: 'pool_boundary_date',
  /**
   * 板块池签名（板块代码按默认行序拼接）
   *
   * 板块池变化（如新增热门板块）时，库内历史行缺少新板块 → 需要重跑一次回补窗口；
   * 签名一致则完全不受影响（「入库之后只做增量」的前提）。
   */
  BOARD_POOL: 'board_pool',
} as const;

/**
 * 开盘确认时刻（当日分钟数 = 09:35）
 *
 * 腾讯日 K 实测盘中已含当天 bar（2026-09-14 14:58 验证），故「轴内是否含今天」
 * 即「今天是否交易日」的权威判据；但盘前拉到的轴不含今天，
 * 需在跨过该时刻后重查一次完成确认（此后当天不再查）。
 */
export const TRADE_AXIS_CONFIRM_MINUTE = 9 * 60 + 35;

/**
 * 交易日轴兜底重查间隔（毫秒，60 分钟）
 *
 * 用于「已过确认时刻但仍未确认今天」的场景（上游补当天 bar 有延迟、工作日节假日）——
 * 避免因为一次过早的确认失败而让当天彻底不再采集。
 */
export const TRADE_AXIS_RETRY_MS = 60 * 60 * 1_000;

/**
 * 当日快照最早可采集时刻（当日分钟数 = 09:25）
 *
 * ⚠️ 盘前 `ulist` 返回的是**上一交易日的收盘值**，此时采集会把昨收数据写进今天的行，
 * 且该行此后不会被回补流程覆盖（已入库即视为已有数据）→ 必须等开盘后再采。
 */
export const BOARD_SNAPSHOT_EARLIEST_MINUTE = 9 * 60 + 25;

/**
 * 当日快照盘中刷新窗口上界（当日分钟数 = 15:00）
 *
 * 与之对齐的 `BOARD_FINAL_HOUR`（15 时）在此后把当日快照置为已定稿并停止采集；
 * 窗口外不重复采集，避免开盘前 / 收盘后空刷。
 */
export const BOARD_SNAPSHOT_REFRESH_END_MINUTE = 15 * 60;

/** 午休区间起点（当日分钟数 = 11:35）：此间行情不再变化，重复采集纯属浪费请求 */
export const BOARD_SNAPSHOT_LUNCH_START_MINUTE = 11 * 60 + 35;

/** 午休区间终点（当日分钟数 = 12:55）：留出 5 分钟缓冲，等下午首笔成交落地 */
export const BOARD_SNAPSHOT_LUNCH_END_MINUTE = 12 * 60 + 55;

/**
 * 收盘定稿采集时刻（当日分钟数）
 *
 * ⚠️ 页面轮询是**交易窗口感知**的（A 股 09:15~15:00，见 `market-status` store），
 * 15:00 后即暂停；而 `is_final` 只在此后的首次采集才置位 → 若 App 整日运行、页面常开，
 * 当日快照会永远停在盘中状态（**丢掉尾盘变化**，且该行此后不会被回补覆盖）。
 * 故启动钩子额外挂一个「收盘定稿」一次性采集，每天只多发 3 个请求。
 *
 * 时刻 = 收盘 + `BOARD_SNAPSHOT_THROTTLE_MS` + 2 分钟余量：必须晚于节流窗口，
 * 否则盘中最后一次采集的节流会把定稿采集自己挡掉（从常量推导，
 * 以后调整节流档位时自动跟随，不要改成硬编码）。
 */
export const BOARD_FINALIZE_MINUTE =
  15 * 60 + Math.ceil(BOARD_SNAPSHOT_THROTTLE_MS / 60_000) + 2;

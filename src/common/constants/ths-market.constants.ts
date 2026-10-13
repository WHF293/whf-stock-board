/**
 * 同花顺市场数据三源常量（2026-10-13 接入，接口均已 curl 实测）
 *
 * 上游为同花顺 Web 页面自用接口，对高频有风控先例（板块日历踩过连发封禁）——
 * 轮询间隔定 30s/60s，前台轮询、页面隐藏即停，不做失败自动重试轰炸。
 */
import type { ThsChartHeaderItem, ThsChartResponse } from '../types/ths-market.types.ts';

// ---------- dq 域：市场成交额分时 / 日K（同花顺首页「实时成交额」模块数据源） ----------

/** get_chart_data 接口地址（JSON/UTF-8） */
export const THS_CHART_DATA_URL =
  'https://dq.10jqka.com.cn/fuyao/market_analysis_api/chart/v1/get_chart_data';

/** chart_key 取值 */
export const THS_CHART_KEY = {
  /** 市场成交额分时（241 个分钟点，含同时刻环比与预测全天） */
  TURNOVER_MINUTE: 'turnover_minute',
  /** 市场成交额日 K（近 60 个交易日，含 60 日均） */
  TURNOVER_DAY: 'turnover_day',
} as const;

/** 分时 header 的字段 key（get_chart_data 返回 header 数组，按 key 取值） */
export const THS_TURNOVER_HEADER_KEY = {
  /** 当日累计成交额 */
  TURNOVER: 'turnover',
  /** 昨日同时刻累计 */
  TURNOVER_PRE: 'turnover_pre',
  /** 较昨日变动（同时刻环比） */
  TURNOVER_CHANGE: 'turnover_change',
  /** 预测全天成交额 */
  PREDICT_TURNOVER: 'predict_turnover',
  /** 预测变化率(%) */
  PREDICT_CHANGE_RATE: 'predict_turnover_change_rate',
  /** 日 K：近 60 日平均成交额 */
  AVERAGE_TURNOVER: 'average_turnover',
} as const;

// ---------- q 域：大盘评级（同花顺行情中心「大盘评级」环形分数） ----------

/** indexflash 接口地址（GBK JSON） */
export const THS_INDEX_FLASH_URL = 'https://q.10jqka.com.cn/api.php?t=indexflash&';

// ---------- q 域：个股行情（行情中心 ajax HTML 片段，GBK） ----------

/** 个股行情片段地址模板 */
export const THS_STOCK_BOARD_URL_TEMPLATE =
  'https://q.10jqka.com.cn/index/index/board/{board}/field/{field}/order/{order}/page/{page}/ajax/1/';

/** 板块 Tab → board 参数（与同花顺行情中心 Tab 一一对应，实测确认） */
export const THS_STOCK_BOARD_TABS = [
  { board: 'all', label: '全部' },
  { board: 'hs', label: '沪市A股' },
  { board: 'ss', label: '深市A股' },
  { board: 'bj', label: '北交所' },
  { board: 'cyb', label: '创业板' },
  { board: 'kcb', label: '科创板' },
] as const;

/** 板块 board 取值（供类型与 API 入参收窄） */
export type ThsStockBoard = (typeof THS_STOCK_BOARD_TABS)[number]['board'];

/** 排序列 → field 参数（表头 field 属性实测确认） */
export const THS_STOCK_BOARD_FIELDS = {
  price: 'xj',
  changePercent: 'zdf',
  change: 'zd',
  speed: 'zs',
  turnoverRate: 'hs',
  volumeRatio: 'lb',
  amplitude: 'zf',
  amountText: 'cje',
  floatSharesText: 'ltg',
  floatMarketCapText: 'ltsz',
  peText: 'syl',
} as const;

/** 可排序字段的 key（ThsStockRow 的数值/文案列；seq/code/name 不参与排序） */
export type ThsStockBoardField = keyof typeof THS_STOCK_BOARD_FIELDS;

/** 排序方向参数 */
export const THS_STOCK_BOARD_ORDER = {
  ASC: 'asc',
  DESC: 'desc',
} as const;

/** 每页条数（实测 board=all 翻页：第 2 页序号 21-40） */
export const THS_STOCK_BOARD_PAGE_SIZE = 20;

// ---------- 大盘评级文案映射（照抄同花顺前端 hssc_v1.min.js 的五档写死映射） ----------

/** 评分 → 投资建议五档（升序阈值；命中「首个 score < min」之前的一档） */
export const THS_RATING_GRADES = [
  { min: 8, text: '大盘走势极好，积极参与' },
  { min: 6, text: '大盘走势良好，积极参与' },
  { min: 4, text: '大盘震荡，适当参与' },
  { min: 2.5, text: '大盘风险较大，请谨慎参与' },
  { min: Number.NEGATIVE_INFINITY, text: '大盘风险极大，请勿参与' },
] as const;

/**
 * 评分 → 投资建议文案
 * @param score 大盘评分（0-10）
 * @returns 五档文案之一（score 为 null 时返回 null，由 UI 展示「--」或空态）
 */
export const getThsRatingAdvice = (score: number | null): string | null => {
  if (score === null || Number.isNaN(score)) return null;
  const grade = THS_RATING_GRADES.find((item) => score >= item.min);
  return grade?.text ?? null;
};

// ---------- 轮询间隔（前台轮询，页面隐藏即停；不做后台轮询） ----------

/** 同花顺三源轮询间隔（毫秒） */
export const THS_POLLING_INTERVAL = {
  /** 成交额分时（分钟级更新，30s 足够且礼貌） */
  TURNOVER_MINUTE: 30_000,
  /** 个股行情列表（服务端排序翻页，30s 同频） */
  STOCK_BOARD: 30_000,
  /** 大盘评分（低频） */
  RATING: 60_000,
} as const;

/** 请求 Referer（项目惯例带上，实测可不带但带上更稳） */
export const THS_REFERER_HOME = 'https://www.10jqka.com.cn/';
export const THS_REFERER_Q = 'https://q.10jqka.com.cn/';

/**
 * get_chart_data 响应 → header key-value 映射
 * @param response get_chart_data 原始响应
 * @returns key → val（val 缺失归 null）
 */
export const toThsChartHeaderMap = (
  response: ThsChartResponse,
): Record<string, number | null> => {
  const header: ThsChartHeaderItem[] = response?.data?.charts?.header ?? [];
  const map: Record<string, number | null> = {};
  for (const item of header) {
    if (!(item.key in map)) {
      map[item.key] = typeof item.val === 'number' ? item.val : null;
    }
  }
  return map;
};

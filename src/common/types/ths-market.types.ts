/**
 * 同花顺市场数据三源的类型定义（dq 域成交额分时/日K、q 域大盘评级、q 域个股行情片段）
 *
 * 上游均为同花顺 Web 页面自用接口，无稳定性承诺：所有业务字段缺失时归 null，
 * 由 UI 层以「--」展示（解析层容错，不让单个坏字段拖垮整页）
 */

/** get_chart_data 响应的 header 项（val 为当前值，key 为字段名） */
export interface ThsChartHeaderItem {
  val: number;
  name: string;
  key: string;
}

/** get_chart_data 响应体（charts 为单个图表对象） */
export interface ThsChartResponse {
  status_code: number;
  data: {
    charts: {
      total: number;
      name: string;
      header: ThsChartHeaderItem[];
      /** 分钟/日K 点列：[时间戳ms, 主值, ...附加值]，附加位可能为 null */
      point_list: (number | null)[][];
    };
  };
}

/** header 数组 → key→value 记录（重复 key 保留首个） */
export type ThsChartHeaderMap = Record<string, number | null>;

/** 市场成交额分时（turnover_minute，241 个分钟点） */
export interface ThsTurnoverMinute {
  /** 当日累计成交额（元） */
  turnover: number | null;
  /** 昨日同时刻累计成交额（元） */
  turnoverPre: number | null;
  /** 较昨日变动（元）——同时刻环比，后端直出 */
  turnoverChange: number | null;
  /** 预测全天成交额（元） */
  predictTurnover: number | null;
  /** 预测变化率（%） */
  predictChangeRate: number | null;
  /** 最后一个分钟点的时间戳（毫秒；非交易时段为当日/上日末点） */
  updatedAt: number | null;
  /** 分时点列（升序） */
  points: {
    /** 时间戳（毫秒） */
    time: number;
    /** 当日累计（元） */
    turnover: number | null;
    /** 昨日同时刻累计（元） */
    pre: number | null;
    /** 较昨日变动（元） */
    change: number | null;
  }[];
}

/** 市场成交额日 K（turnover_day，近 60 个交易日） */
export interface ThsTurnoverDay {
  /** 当日成交额（元） */
  turnover: number | null;
  /** 近 60 日平均成交额（元，后端直出） */
  averageTurnover: number | null;
  /** 日 K 点列（升序） */
  points: {
    /** 时间戳（毫秒） */
    time: number;
    /** 当日成交额（元） */
    turnover: number | null;
  }[];
}

/** api.php?t=indexflash 响应（GBK JSON；本期仅消费 dppj_data，其余登记备查） */
export interface ThsIndexFlash {
  /** 大盘评分（0-10，一位小数；同花顺「大盘评级」环形的分数） */
  dppj: number | null;
  /** 涨跌停分时原始结构（本期不消费，透传登记） */
  zdtData: unknown | null;
  /** 昨涨停均涨原始结构（本期不消费，透传登记） */
  jrbxData: unknown | null;
}

/** 个股行情单行（同花顺行情中心 ajax 片段，14 列；金额类上游为「7233.25万/1.53亿」格式文本） */
export interface ThsStockRow {
  /** 序号（服务端按当前排序全局编号） */
  seq: number;
  /** 6 位代码 */
  code: string;
  /** 股票简称（如 `万里股份`、`N粤芯-U`） */
  name: string;
  /** 现价（元） */
  price: number | null;
  /** 涨跌幅（%） */
  changePercent: number | null;
  /** 涨跌（元） */
  change: number | null;
  /** 涨速（%） */
  speed: number | null;
  /** 换手率（%） */
  turnoverRate: number | null;
  /** 量比 */
  volumeRatio: number | null;
  /** 振幅（%） */
  amplitude: number | null;
  /** 成交额展示文案（上游原文，如 `7233.25万` / `1.53亿`） */
  amountText: string;
  /** 流通股展示文案（上游原文） */
  floatSharesText: string;
  /** 流通市值展示文案（上游原文） */
  floatMarketCapText: string;
  /** 市盈率展示文案（数字文本或「亏损」） */
  peText: string;
}

/** 个股行情分页结果 */
export interface ThsStockBoardPage {
  /** 当页行（保持页面顺序） */
  rows: ThsStockRow[];
  /** 当前页码（1 起） */
  page: number;
  /** 总页数（从片段分页器解析；解析不到为 null） */
  totalPages: number | null;
}

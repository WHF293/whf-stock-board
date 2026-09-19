/**
 * 插件 dsh-flow-cycle（资金周期）类型
 */

/** 热点板块排行行（clist f174/f164 排行解析产物） */
export interface FlowCycleHotBoard {
  /** 板块代码（东财 BK 编号） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 当日涨跌幅（%，null 为未知） */
  changePercent: number | null;
  /** 10 日主力净额（元，null 为未知） */
  net10d: number | null;
  /** 5 日主力净额（元，null 为未知） */
  net5d: number | null;
}

/** 逐日净流入单日点 */
export interface FlowCycleDayPoint {
  /** 交易日（YYYY-MM-DD） */
  date: string;
  /** 当日主力净流入（元） */
  net: number;
}

/** 板块逐日资金流历史（api 原始产物，日期升序） */
export interface FlowCycleBoardHistory {
  /** 板块代码（BK 编号） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 逐日序列（日期升序） */
  points: FlowCycleDayPoint[];
}

/** 数据完整度 */
export type FlowCycleCompleteness = 'complete' | 'partial';

/** 页面消费的板块周期数据（judge 聚合产物，history 对齐基准交易日轴） */
export interface FlowCycleBoard {
  /** 板块代码（BK 编号） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 区间内逐日序列（对齐基准交易日轴，缺日为 null） */
  history: Array<{ date: string; net: number | null }>;
  /** 区间净额合计（元；缺日按 0 计入） */
  netSum: number;
  /** 数据完整度（partial = 区间内有缺日 / 历史不足） */
  completeness: FlowCycleCompleteness;
  /** 当日涨跌幅（%，来自热点排行） */
  changePercent: number | null;
}

/** 期间聚合结果（页面一次渲染的全部数据） */
export interface FlowCycleSummary {
  /** 基准交易日轴（升序；取各板块区间截取后最长的一组日期） */
  dates: string[];
  /** 板块周期数据（区间净额降序） */
  boards: FlowCycleBoard[];
  /** 交易日数（= dates.length，可能小于期间档位） */
  tradeDays: number;
  /** 全板块区间净额合计（元） */
  netTotal: number;
}

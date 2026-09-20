/**
 * 板块逐日资金流历史（行业/概念板块 × 交易日的主力净流入拆解）类型
 *
 * 数据源：东财 fflow/daykline（push2his 直连）+ clist f174 排行（热点名单）。
 * 消费方：Agent MCP 工具 `get_board_flow_history`（原「资金周期」插件已移除，能力收敛到 Agent 层）。
 */

/** 热点板块排行行（clist f174/f164 排行解析产物） */
export interface BoardFlowHotBoard {
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
export interface BoardFlowDayPoint {
  /** 交易日（YYYY-MM-DD） */
  date: string;
  /** 当日主力净流入（元） */
  net: number;
}

/** 板块逐日资金流历史（api 原始产物，日期升序） */
export interface BoardFlowHistory {
  /** 板块代码（BK 编号） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 逐日序列（日期升序） */
  points: BoardFlowDayPoint[];
}

/** 数据完整度 */
export type BoardFlowCompleteness = 'complete' | 'partial';

/** 聚合后的板块周期数据（对齐基准交易日轴） */
export interface BoardFlowSummaryBoard {
  /** 板块代码（BK 编号） */
  code: string;
  /** 板块名称 */
  name: string;
  /** 区间内逐日序列（对齐基准交易日轴，缺日为 null） */
  history: Array<{ date: string; net: number | null }>;
  /** 区间净额合计（元；缺日按 0 计入） */
  netSum: number;
  /** 数据完整度（partial = 区间内有缺日 / 历史不足） */
  completeness: BoardFlowCompleteness;
  /** 当日涨跌幅（%，来自热点排行） */
  changePercent: number | null;
}

/** 期间聚合结果（区间截取 + 轴对齐 + 合计的最终产物） */
export interface BoardFlowSummary {
  /** 基准交易日轴（升序；取各板块区间截取后最长的一组日期） */
  dates: string[];
  /** 板块周期数据（区间净额降序） */
  boards: BoardFlowSummaryBoard[];
  /** 交易日数（= dates.length，可能小于期间档位） */
  tradeDays: number;
  /** 全板块区间净额合计（元） */
  netTotal: number;
}

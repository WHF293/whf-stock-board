/**
 * 行业板块分时资金曲线类型（市场榜单「板块净流入」页签曲线视图）
 *
 * 数据源：东方财富板块分时资金流（push2delay fflow/kline，klt=1 分钟线），
 * 值为当日**累计**主力净流入（元），09:31 → 15:00 逐分钟一点
 */

/** 曲线单点 */
export interface SectorFlowCurvePoint {
  /** 时间（HH:mm 形态） */
  time: string;
  /** 当日累计主力净流入（元） */
  mainNetInflow: number;
}

/** 单个行业板块的当日分时资金曲线 */
export interface SectorFlowCurve {
  /** 板块代码（东方财富 BK 编号） */
  code: string;
  /** 曲线归属的交易日（YYYY-MM-DD） */
  tradeDate: string;
  /** 分时点序列（时间升序） */
  points: SectorFlowCurvePoint[];
}

/** 图表消费的曲线视图模型（曲线 + 板块排名侧信息合并） */
export interface SectorFlowCurveView extends SectorFlowCurve {
  /** 板块名称 */
  name: string;
  /** 板块当日涨跌幅（%，null 为未知） */
  changePercent: number | null;
}

/**
 * 行业资金曲线模块常量（市场榜单「板块净流入」页签曲线视图）
 *
 * 上游：东方财富板块分时资金流 kline（klt=1 分钟线，值为当日累计主力净流入）。
 * 实测口径（2026-09-19）：push2delay 返回当日完整 241 点；push2his 的 klt=1
 * 返回空 klines（勿改道，与 fflow/daykline 历史日线口径相反）；klt=5 返回 rc=102
 * 无数据，仅 klt=1 可用
 */

/** 上游 URL 模板（{secid} 占位符，请求时注入 90.BKxxxx） */
export const SECTOR_FLOW_KLINE_URL_TEMPLATE =
  'https://push2delay.eastmoney.com/api/qt/stock/fflow/kline/get?secid={secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&klt=1&lmt=0' as const;

/** 板块 secid 市场号前缀（90 = 沪深板块） */
export const SECTOR_SECID_PREFIX = '90.' as const;

/** klines 行的字段下标（fields2=f51..f56；恒等式：主力 = 大单 + 超大单） */
export const SECTOR_FLOW_KLINE_COLUMN = {
  /** 第 0 列：时间（"YYYY-MM-DD HH:mm"） */
  TIME: 0,
  /** 第 1 列：当日累计主力净流入（元） */
  MAIN: 1,
} as const;

/** 曲线行业数量上限（防请求风暴，用户自选不可超） */
export const SECTOR_CURVE_MAX_COUNT = 26;

/** 默认展示数量：按收盘主力净流入取流入 / 流出各前 N */
export const SECTOR_CURVE_DEFAULT_TOP = 8;

/** 批量拉取并发上限（东财系红线：并发不得超过 3，与信号扫描同口径） */
export const SECTOR_CURVE_CONCURRENCY = 3;

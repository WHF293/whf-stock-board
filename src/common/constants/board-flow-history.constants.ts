/**
 * 板块逐日资金流历史常量（`api/board-flow-history.api.ts` 专用）
 *
 * 上游（实测口径 2026-09-19 / 2026-09-20）：
 * - 热点名单：东财 clist 按 f174（10 日主力净额）排行，行业 t:2 + 概念 t:3 两源合并；
 * - 逐日历史：东财 fflow/daykline（klt=101）直连 push2his（push2delay 只有当日 1 条，勿改道）；
 * - ⚠️ push2his 会间歇性对本机 IP 做接口级 TCP RST 封禁（2026-09-20 实测，数字镜像同封）：
 *   30 连发无间隔是诱因之一，故并发 3 之外每请求再错峰 500ms。
 */

/** 热点板块数量上限（对齐原参考实现） */
export const BOARD_FLOW_BOARD_LIMIT = 30;

/** 热点名单单源候选数（行业 / 概念各取前 N，合并后再截前 30） */
export const BOARD_FLOW_HOT_CANDIDATES = 60;

/** 逐日历史批量拉取并发上限（东财系红线：并发不得超过 3） */
export const BOARD_FLOW_CONCURRENCY = 3;

/** 逐日历史相邻请求的最小间隔（ms；东财系红线「同一上游连续请求 delay(500) 错峰」，防触发风控封禁） */
export const BOARD_FLOW_REQUEST_GAP_MS = 500;

/** clist 排行 URL 模板（{pz} 注入条数，{fid} 注入 f174 / f164，{fs} 注入板块类型） */
export const BOARD_FLOW_CLIST_URL_TEMPLATE =
  'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz={pz}&po=1&np=1&fltt=2&invt=2&fid={fid}&fs={fs}&fields=f12,f14,f174,f164,f3' as const;

/** 行业板块 fs 参数 */
export const BOARD_FLOW_FS_INDUSTRY = 'm:90+t:2' as const;

/** 概念板块 fs 参数 */
export const BOARD_FLOW_FS_CONCEPT = 'm:90+t:3' as const;

/** 10 日主力净额排行字段 */
export const BOARD_FLOW_FID_10D = 'f174' as const;

/** 板块逐日资金流 URL 模板（{secid} 注入 90.BKxxxx；lmt=0 取全部，调用方自行截区间） */
export const BOARD_FLOW_DAYKLINE_URL_TEMPLATE =
  'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid={secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=0' as const;

/** 板块 secid 市场号前缀（90 = 沪深板块） */
export const BOARD_FLOW_SECID_PREFIX = '90.' as const;

/** daykline 行字段下标（fields2=f51..f56；恒等式：主力 = 大单 + 超大单） */
export const BOARD_FLOW_DAYKLINE_COLUMN = {
  /** 第 0 列：日期（YYYY-MM-DD） */
  DATE: 0,
  /** 第 1 列：当日主力净流入（元） */
  MAIN: 1,
} as const;

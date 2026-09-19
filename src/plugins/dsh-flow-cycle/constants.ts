/**
 * 插件 dsh-flow-cycle（资金周期）常量
 *
 * 参考 coooapi.cn/cycle「资金周期」页的等价实现：
 * 热点板块 × 交易日的逐日主力净流入拆解。
 * 上游（实测口径 2026-09-19）：
 * - 热点名单：东财 clist 按 f174（10 日主力净额）排行，行业 t:2 + 概念 t:3 两源合并；
 * - 逐日历史：东财 fflow/daykline（klt=101）直连 push2his（push2delay 只有当日 1 条，勿改道），
 *   每板块 1 请求，用户触发、并发 3、不轮询
 */

/** 插件 id（ctx.db / 存储命名空间用） */
export const FLOW_CYCLE_PLUGIN_ID = 'dsh-flow-cycle';

/** 页面主标题 */
export const FLOW_CYCLE_PAGE_TITLE = '资金周期';

/** 页面副标题 */
export const FLOW_CYCLE_PAGE_SUBTITLE =
  '热点板块（行业 + 概念，按近 10 日主力净额排名）逐日主力净流入拆解，看资金是持续流入还是一轮游。';

/** 逐日明细视图值 */
export const FLOW_CYCLE_VIEW_DAILY = 'daily' as const;

/** 区间总览视图值 */
export const FLOW_CYCLE_VIEW_SUMMARY = 'summary' as const;

/** 期间选项文案（{days} 注入交易日数） */
export const FLOW_CYCLE_PERIOD_LABEL = '{days}日' as const;

/** 逐日明细视图文案 */
export const FLOW_CYCLE_VIEW_DAILY_LABEL = '逐日明细' as const;

/** 区间总览视图文案 */
export const FLOW_CYCLE_VIEW_SUMMARY_LABEL = '区间总览' as const;

/** 统计卡标签：板块数 */
export const FLOW_CYCLE_STAT_BOARDS = '板块数';

/** 统计卡标签：交易日 */
export const FLOW_CYCLE_STAT_TRADE_DAYS = '交易日';

/** 统计卡标签：区间净额 */
export const FLOW_CYCLE_STAT_NET_TOTAL = '区间净额';

/** 统计卡标签：日期范围 */
export const FLOW_CYCLE_STAT_DATE_RANGE = '日期范围';

/** 统计卡副文：板块数（{total} 热点板块） */
export const FLOW_CYCLE_STAT_BOARDS_SUB = '{total} 个热点板块';

/** 统计卡副文：交易日 */
export const FLOW_CYCLE_STAT_TRADE_DAYS_SUB = '近 {days} 个交易日';

/** 统计卡副文：区间净额（仅完整板块参与合计） */
export const FLOW_CYCLE_STAT_NET_TOTAL_SUB = '仅数据完整的板块参与合计';

/** 统计卡副文：失败板块提示（{failed} 个板块取数失败） */
export const FLOW_CYCLE_STAT_FAILED_SUB = '{failed} 个板块取数失败，可刷新重试';

/** 统计卡副文：完整度（完整 {complete} · 部分 {partial}） */
export const FLOW_CYCLE_STAT_COMPLETENESS_SUB = '完整 {complete} · 部分 {partial}';

/** 区间净额空态（尚无完整板块） */
export const FLOW_CYCLE_NET_TOTAL_EMPTY = '--';

/** 完整度标签：完整 */
export const FLOW_CYCLE_COMPLETE_LABEL = '完整';

/** 完整度标签：部分 */
export const FLOW_CYCLE_PARTIAL_LABEL = '部分';

/** 逐日卡片行 tooltip（{date} {direction} {net}） */
export const FLOW_CYCLE_BAR_TITLE = '{date} 主力净流入 {net}' as const;

/** 页面加载失败文案 */
export const FLOW_CYCLE_LOAD_FAILED = '热点板块名单加载失败，请稍后重试';

/** 空数据文案 */
export const FLOW_CYCLE_EMPTY_TEXT = '暂无板块资金数据';

/** 刷新按钮文案 */
export const FLOW_CYCLE_REFRESH_LABEL = '刷新';

/** 刷新中按钮文案 */
export const FLOW_CYCLE_REFRESHING_LABEL = '刷新中…';

/** 拉取进度文案（{done}/{total}） */
export const FLOW_CYCLE_PROGRESS_LABEL = '{done}/{total}';

/** 菜单路由路径 */
export const FLOW_CYCLE_MENU_PATH = '/flow-cycle';

/** 菜单标题 */
export const FLOW_CYCLE_MENU_TITLE = '资金周期';

/** 菜单图标（MenuIcon 名称） */
export const FLOW_CYCLE_MENU_ICON = 'calendar';

/** 期间档位（交易日数） */
export const FLOW_CYCLE_PERIODS = [5, 10, 20] as const;

/** 期间档位默认值 */
export const FLOW_CYCLE_PERIOD_DEFAULT = 10;

/** 热点板块数量上限（对齐参考实现） */
export const FLOW_CYCLE_BOARD_LIMIT = 30;

/** 热点名单单源候选数（行业 / 概念各取前 N，合并后再截 30） */
export const FLOW_CYCLE_HOT_CANDIDATES = 60;

/** 逐日历史批量拉取并发上限（东财系红线：并发不得超过 3） */
export const FLOW_CYCLE_CONCURRENCY = 3;

/** clist 排行 URL 模板（{fid} 注入 f174 / f164，{fs} 注入板块类型） */
export const FLOW_CYCLE_CLIST_URL_TEMPLATE =
  'https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz={pz}&po=1&np=1&fltt=2&invt=2&fid={fid}&fs={fs}&fields=f12,f14,f174,f164,f3' as const;

/** 行业板块 fs 参数 */
export const FLOW_CYCLE_FS_INDUSTRY = 'm:90+t:2' as const;

/** 概念板块 fs 参数 */
export const FLOW_CYCLE_FS_CONCEPT = 'm:90+t:3' as const;

/** 10 日主力净额排行字段 */
export const FLOW_CYCLE_FID_10D = 'f174' as const;

/** 5 日主力净额排行字段 */
export const FLOW_CYCLE_FID_5D = 'f164' as const;

/** 板块逐日资金流 URL 模板（{secid} 注入 90.BKxxxx；lmt=0 取全部，前端截区间） */
export const FLOW_CYCLE_DAYKLINE_URL_TEMPLATE =
  'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?secid={secid}&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56&klt=101&lmt=0' as const;

/** 板块 secid 市场号前缀（90 = 沪深板块） */
export const FLOW_CYCLE_SECID_PREFIX = '90.' as const;

/** daykline 行字段下标（fields2=f51..f56；恒等式：主力 = 大单 + 超大单） */
export const FLOW_CYCLE_DAYKLINE_COLUMN = {
  /** 第 0 列：日期（YYYY-MM-DD） */
  DATE: 0,
  /** 第 1 列：当日主力净流入（元） */
  MAIN: 1,
} as const;

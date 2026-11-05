/**
 * 「每日汇金持仓变化（估算）」模块魔法值集中地（资金动向页底部，2026-11-06 王总指定新增）
 *
 * 估算模型：汇金重仓宽基 ETF 的当日总份额变动 × 最近季报披露的机构持有比例
 * = 估算汇金（国家队，宽基机构盘主导力量）当日增减持。
 *
 * ⚠️ 口径声明（硬性）：这是估算值而非官方披露——汇金无任何公开的日度持仓数据；
 * ETF 总份额变动来自全部申赎方（含其他机构 / 套利盘 / 做市商），汇金二级市场
 * 直接买卖不改变总份额因此不可见。季报披露后基准随之更新（天然校准）。
 */

/** 东财批量行情接口（ulist.np）：一次带全部 secid 拿份额 + 市值（实测 f38=最新份额，份） */
export const HUIJIN_EM_ULIST_URL_TEMPLATE =
  'https://push2delay.eastmoney.com/api/qt/ulist.np/get?secids={secids}&fields={fields}&fltt=2&invt=2';

/** ulist 拉取字段：代码 / 名称 / 最新份额（份）/ 总市值（元） */
export const HUIJIN_EM_FIELDS = 'f12,f14,f38,f20';

/** 东财行情域 Referer（站内防 404，与板块日历同款） */
export const HUIJIN_EM_REFERER = 'https://quote.eastmoney.com/';

/** 上交所 ETF 规模查询（官方逐日口径，TOT_VOL 单位万份；仅覆盖沪市） */
export const HUIJIN_SSE_URL_TEMPLATE =
  'https://query.sse.com.cn/commonQuery.do?isPagination=true&pageHelp.pageSize={pageSize}' +
  '&pageHelp.pageNo=1&pageHelp.beginPage=1&pageHelp.cacheSize=1&pageHelp.endPage=1' +
  '&sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L&STAT_DATE={date}';

/** SSE 单页拉取条数（一次拿全当日沪市全部 ETF，2026-11-06 实测总量约 923） */
export const HUIJIN_SSE_PAGE_SIZE = 3000;

/** SSE 请求 Referer（缺省时上游 403） */
export const HUIJIN_SSE_REFERER = 'https://www.sse.com.cn/';

/** 天天基金 f10「持有人结构」接口参数（`FundArchivesDatas.aspx?type=cyrjg`，季报披露口径） */
export const HUIJIN_CYRJG_QUERY_TEMPLATE = 'type=cyrjg&code={code}&rt={rt}';

/** 持有人结构缓存自动刷新阈值（毫秒）：比例按季度披露，与持仓同款约一个季度 */
export const HUIJIN_BASELINE_TTL_MS = 100 * 24 * 60 * 60 * 1000;

/** 份额历史保留的最大交易日数（约一年；防独立 key 无限膨胀） */
export const HUIJIN_HISTORY_MAX_DAYS = 250;

/** 份额历史存储结构版本（结构不兼容变更时递增并弃置重建） */
export const HUIJIN_STORE_VERSION = 1;

/** 当日快照重复拉新的最小间隔（毫秒）：盘中重复进页 5 分钟内不重复请求 */
export const HUIJIN_SNAPSHOT_MIN_INTERVAL_MS = 5 * 60 * 1000;

/** 首次起步回看天数：库空时从「昨日」往回找最近一个有 SSE 数据的交易日（长假最长约 10 天） */
export const HUIJIN_SSE_LOOKBACK_DAYS = 10;

/** 亿份换算基数（份 -> 亿份） */
export const HUIJIN_YI_SHARES = 1e8;

/** 万份换算基数（SSE TOT_VOL 万份 -> 份） */
export const HUIJIN_WAN_SHARES = 1e4;

/**
 * 汇金占比覆盖表（code -> 汇金精确占比 %）：
 * 默认为空——基准走 cyrjg「机构持有比例」（真实披露，宽基机构盘以汇金系为主）；
 * 今后拿到定期报告的汇金精确占比可在此按代码覆盖，覆盖项 source 标 override
 */
export const HUIJIN_RATIO_OVERRIDES: Readonly<Record<string, number>> = {};

/** 汇金主体名称关键词（供覆盖表维护者对照定期报告前十大持有人披露） */
export const HUIJIN_HOLDER_KEYWORDS = ['中央汇金投资', '中央汇金资产管理'] as const;

/** 图表周期选项（BaseTabs；value 为交易日数字字符串，0 = 全部） */
export const HUIJIN_FLOW_RANGE_OPTIONS = [
  { label: '近30日', value: '30' },
  { label: '近60日', value: '60' },
  { label: '全部', value: '0' },
] as const;

/** 默认图表周期（近30日的字符串形态，BaseTabs value） */
export const HUIJIN_FLOW_RANGE_DEFAULT = '30';

/** 模块顶部警示条文案（估算口径声明，硬性要求醒目展示） */
export const HUIJIN_ETF_FLOW_NOTICE =
  '估算值，非汇金官方日度披露：按宽基 ETF 总份额变动 × 最近季报机构持有比例推算，' +
  '汇金二级市场直接买卖不可见，其他机构申赎 / 套利盘亦会扰动，仅作资金情绪参考。';

/** 标题旁问号说明（口径细节与校准机制） */
export const HUIJIN_ETF_FLOW_TIP =
  '估算模型：当日 ETF 总份额变动 × 最近季报披露的机构持有比例。宽基 ETF 的机构持有盘' +
  '以汇金系（中央汇金投资 / 汇金资管）为绝对主导，故以机构比例近似汇金；拿到定期报告的' +
  '精确占比后可在常量覆盖表中校准。历史曲线自首次使用起本地逐日累积（东财无公开日频' +
  '份额历史），首次起步用上交所官方接口查昨日份额；深市 ETF 无交易所快照源，首日空缺次日齐。';

/** 首日无前值的占位文案（未参与估算，次日齐） */
export const HUIJIN_ESTIMATE_SKIP_NO_PREV = '首日待累积';

/** 占比基准缺失行的占位文案（未参与估算，可点「刷新」重拉） */
export const HUIJIN_ESTIMATE_SKIP_NO_BASELINE = '基准待披露';

/** 单日无变化文案（份额零变动） */
export const HUIJIN_ESTIMATE_FLAT_TEXT = '—';

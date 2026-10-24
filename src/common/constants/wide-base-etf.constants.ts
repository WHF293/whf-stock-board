import type { TabOption } from '../composables/use-tab-config';

/**
 * 宽基ETF 页（国家队 / 汇金系核心操作宽基监控）相关魔法值集中地
 *
 * 页面用途：跟踪中央汇金投资 / 汇金资管等「国家队」资金的宽基ETF操作动向——
 * 汇金系历史上以大额申购、买入头部宽基ETF为主要护盘手段（沪深300为第一主力，
 * 其次上证50 / 中证500 / 中证1000 / 科创50 / 创业板），据此观察当日有无大额操作迹象
 */

/** 宽基ETF 条目（symbol 为 sh/sz 前缀完整形态，name 为展示名，含基金公司便于区分同名宽基） */
export interface WideBaseEtfItem {
  /** 完整符号（sh510300 形态） */
  symbol: string;
  /** 展示名称 */
  name: string;
  /** 所属分组（页签切换，见 WIDE_BASE_ETF_GROUP） */
  group: string;
}

/** 分组键（页签值） */
export const WIDE_BASE_ETF_GROUP = {
  /** 大盘蓝筹（持仓最重） */
  LARGE: 'large',
  /** 中小盘宽基 */
  MID_SMALL: 'midSmall',
  /** 科技 / 创业板宽基 */
  TECH: 'tech',
} as const;

/** 分组类型 */
export type WideBaseEtfGroup = (typeof WIDE_BASE_ETF_GROUP)[keyof typeof WIDE_BASE_ETF_GROUP];

/** 分组页签选项（BaseTabs 消费） */
export const WIDE_BASE_ETF_GROUP_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '大盘蓝筹', value: WIDE_BASE_ETF_GROUP.LARGE },
  { label: '中小盘宽基', value: WIDE_BASE_ETF_GROUP.MID_SMALL },
  { label: '科技 / 创业板', value: WIDE_BASE_ETF_GROUP.TECH },
] as const;

/** 分组键 -> 组名（页签配置弹窗的分组标题，与分组页签同文案单源） */
export const WIDE_BASE_ETF_GROUP_LABELS: Record<string, string> = Object.fromEntries(
  WIDE_BASE_ETF_GROUP_OPTIONS.map((option) => [option.value, option.label]),
);

/** 页签配置存储分桶（tab-config store 的 pageId） */
export const WIDE_BASE_ETF_TAB_CONFIG_PAGE_ID = 'wide-base-etf';

/** 汇金系核心操作宽基ETF清单（组内顺序即页面展示顺序） */
export const WIDE_BASE_ETFS: readonly WideBaseEtfItem[] = [
  { symbol: 'sh510300', name: '沪深300ETF', group: WIDE_BASE_ETF_GROUP.LARGE },
  { symbol: 'sh510310', name: '沪深300ETF易方达', group: WIDE_BASE_ETF_GROUP.LARGE },
  { symbol: 'sh510330', name: '沪深300ETF华夏', group: WIDE_BASE_ETF_GROUP.LARGE },
  { symbol: 'sz159919', name: '沪深300ETF嘉实', group: WIDE_BASE_ETF_GROUP.LARGE },
  { symbol: 'sh510050', name: '上证50ETF', group: WIDE_BASE_ETF_GROUP.LARGE },
  { symbol: 'sh510500', name: '中证500ETF', group: WIDE_BASE_ETF_GROUP.MID_SMALL },
  { symbol: 'sh512100', name: '中证1000ETF', group: WIDE_BASE_ETF_GROUP.MID_SMALL },
  { symbol: 'sz159845', name: '中证1000ETF华夏', group: WIDE_BASE_ETF_GROUP.MID_SMALL },
  { symbol: 'sh560010', name: '中证1000ETF广发', group: WIDE_BASE_ETF_GROUP.MID_SMALL },
  { symbol: 'sh588080', name: '科创50ETF', group: WIDE_BASE_ETF_GROUP.TECH },
  { symbol: 'sz159915', name: '创业板ETF', group: WIDE_BASE_ETF_GROUP.TECH },
] as const;

/**
 * 页签配置项（TabConfigButton / useTabConfig 消费）：
 * 每只 ETF 一项，组首项带 groupStart/groupName——弹窗按声明分组（组内可拖拽、组间固定），
 * 勾选显隐 + 顺序持久化走 tab-config store（与盘面雷达同机制）
 */
export const WIDE_BASE_ETF_TAB_OPTIONS: readonly TabOption<string>[] = WIDE_BASE_ETFS.map(
  (item, index, list) => {
    const isGroupStart = index === 0 || list[index - 1]!.group !== item.group;
    return {
      label: item.name,
      value: item.symbol,
      ...(isGroupStart
        ? { groupStart: true, groupName: WIDE_BASE_ETF_GROUP_LABELS[item.group] }
        : {}),
    };
  },
);

/** 图表视图模式值 */
export const WIDE_BASE_ETF_VIEW_MODE = {
  /** 当日分时（均价线 + 成交量） */
  MINUTE: 'minute',
  /** 日K（MA + 成交量） */
  DAILY: 'daily',
} as const;

/** 图表视图模式类型 */
export type WideBaseEtfViewMode =
  (typeof WIDE_BASE_ETF_VIEW_MODE)[keyof typeof WIDE_BASE_ETF_VIEW_MODE];

/** 视图切换选项（BaseTabs 消费） */
export const WIDE_BASE_ETF_VIEW_OPTIONS: readonly { label: string; value: string }[] = [
  { label: '分时', value: WIDE_BASE_ETF_VIEW_MODE.MINUTE },
  { label: '日K', value: WIDE_BASE_ETF_VIEW_MODE.DAILY },
] as const;

/** 日K 拉取根数（约半年：满足 MA30 计算有余量，避免整页灌 7.5 年全量历史） */
export const WIDE_BASE_ETF_DAILY_BAR_LIMIT = 140;

/** 盘中分时数据刷新间隔（毫秒）：11 只 × 每分钟 1 次新浪分钟线，保持克制 */
export const WIDE_BASE_ETF_MINUTE_REFRESH_MS = 60_000;

/**
 * 卡片图表高度（px）：三列栅格下的紧凑规格，主图 + 成交量副图；
 * 2026-10-26 王总指定由 300 压到约 80%（240），一行放下更多视野不占屏
 */
export const WIDE_BASE_ETF_CHART_HEIGHT_PX = 240;

/** 页面顶部公告文案（说明页面用途，可读性优先） */
export const WIDE_BASE_ETF_NOTICE_TEXT =
  '本页用于跟踪「国家队」（中央汇金投资 / 汇金资管）的宽基ETF操作动向：汇金系历史上以大额申购、' +
  '买入头部宽基ETF为主要护盘手段，首选沪深300，其次上证50 / 中证500 / 中证1000 / 科创50 / 创业板。' +
  '可结合分时放量与日K异动，观察国家队当日有无大额操作迹象。';

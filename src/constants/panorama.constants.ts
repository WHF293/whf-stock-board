/**
 * 行情全景页常量集中管理
 */

/** 东财 clist 单次拉取条数（上游单页上限 100，全球指数 63 条一页拿尽） */
export const PANORAMA_CLIST_PAGE_SIZE = 100;

/** 东财 clist 全域 fs 码：全球指数 */
export const PANORAMA_GLOBAL_INDEX_FS = 'm:100';

/**
 * 全球宏观分组展示配置：label 为分组标题，keywords 逐项在上游数据源内
 * 按名称包含匹配（优先精确命中 / 主力连续合约，未命中的条目自动隐藏）
 *
 * 数据源覆盖说明：外盘期货无「伦敦金 / 焦煤 / 多晶硅 / 碳酸锂」等国内品种，
 * 上游以 COMEX / NYMEX / LME / IPE 命名（如 COMEX黄金、布伦特原油、10年美国债）
 */
export const PANORAMA_MACRO_GROUPS = [
  {
    label: '全球指数',
    source: 'index',
    keywords: [
      '富时中国A50',
      '恒生指数',
      '道琼斯',
      '纳斯达克',
      '标普500',
      '日经225',
      '韩国KOSPI',
      '美元指数',
      '德国DAX30',
      '英国富时100',
    ],
  },
  {
    label: '贵金属',
    source: 'futures',
    keywords: ['COMEX黄金', 'COMEX白银', 'NYMEX铂金', 'NYMEX钯金'],
  },
  {
    label: '其他商品',
    source: 'futures',
    keywords: ['布伦特', 'NYMEX原油', '天然气', '综合铜', '综合铝'],
  },
  {
    label: '利率债',
    source: 'futures',
    keywords: ['10年美国债', '2年美国债', '30年美国债'],
  },
] as const;

/** 宏观数据源类型（clist 全球指数与 SDK 全球期货） */
export type PanoramaMacroSource = (typeof PANORAMA_MACRO_GROUPS)[number]['source'];

/** 美股全景展示的行业 ETF 清单（secid 市场码 107 = NYSE Arca，SPDR 行业系列） */
export const PANORAMA_US_SECIDS = [
  '107.XLK',
  '107.XLE',
  '107.XLF',
  '107.XLI',
  '107.XLY',
  '107.XLP',
  '107.XLU',
  '107.XLB',
  '107.XLRE',
  '107.XLC',
  '107.XLV',
  '107.SPY',
  '107.DIA',
] as const;

/**
 * 行情全景 · A股板块排行展示形式
 */
export const PANORAMA_CN_VIEW_MODE = {
  /** 列表表格（默认：统计 + 筛选 + 列配置表格） */
  LIST: 'list',
  /** 平铺网格（与美股全景一致：板块名 + 涨跌幅） */
  TILE: 'tile',
} as const satisfies Record<string, string>;

/** A股板块排行展示形式 */
export type PanoramaCnViewMode = (typeof PANORAMA_CN_VIEW_MODE)[keyof typeof PANORAMA_CN_VIEW_MODE];

/** 默认展示形式：列表 */
export const PANORAMA_CN_VIEW_MODE_DEFAULT: PanoramaCnViewMode = PANORAMA_CN_VIEW_MODE.LIST;

/** 展示形式切换选项 */
export const PANORAMA_CN_VIEW_MODE_OPTIONS: readonly { label: string; value: PanoramaCnViewMode }[] = [
  { label: '列表', value: PANORAMA_CN_VIEW_MODE.LIST },
  { label: '平铺', value: PANORAMA_CN_VIEW_MODE.TILE },
];

/**
 * 行情全景页常量集中管理
 *
 * 大盘云图三常量（嵌入 URL / 原站 URL / postMessage 信源）已于 2026-10-29
 * 随页面转插件分发迁往插件仓库 dsh-dapanyuntu
 */

/** 东财 clist 单次拉取条数（上游单页上限 100，全球指数 63 条一页拿尽） */
export const PANORAMA_CLIST_PAGE_SIZE = 100;

/** 东财 clist 全域 fs 码：全球指数 */
export const PANORAMA_GLOBAL_INDEX_FS = 'm:100';

/**
 * 全球指数 ulist secid（市场码 100 = 全球指数），顺序即市场总览展开区卡片顺序：
 * 恒生指数 / 道琼斯 / 纳斯达克 / 标普500 / 日经225 / 韩国KOSPI
 *
 * 注：腾讯行情源（qt.gtimg.cn）不覆盖日经 225 与 KOSPI，
 * 故全球指数统一走东财 push2delay ulist 精确 secid 查询（可带最新价）
 */
export const PANORAMA_GLOBAL_INDEX_SECIDS = [
  '100.HSI',
  '100.DJIA',
  '100.NDX',
  '100.SPX',
  '100.N225',
  '100.KS11',
] as const;

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
 * 美股科技巨头清单（2026-11-02 王总指定新增模块；secid 市场码 105 = 纳斯达克 / 106 = 纽交所）
 *
 * 王总点名：Meta / 美光 / 台积电 / 阿斯麦 / 高通 / 微软 / 甲骨文 / 谷歌 / 闪迪 / 英特尔；
 * 补充：英伟达 / 苹果 / 亚马逊 / 特斯拉 / 博通 / AMD / 应用材料 / 德州仪器 / 迈威尔。
 * 顺序即展示顺序（按市值 / 知名度排列，不做涨跌幅重排）；
 * 闪迪为 2025 年 2 月自西部数据拆分独立上市（SNDK），上游缺行时该标的自动缺省。
 */
export const PANORAMA_US_TECH_SECIDS = [
  '105.NVDA', // 英伟达
  '105.AAPL', // 苹果
  '105.MSFT', // 微软
  '105.GOOGL', // 谷歌
  '105.AMZN', // 亚马逊
  '105.META', // Meta
  '105.TSLA', // 特斯拉
  '105.AVGO', // 博通
  '106.TSM', // 台积电（ADR）
  '105.ASML', // 阿斯麦（ADR）
  '105.AMD', // 超威半导体（AMD）
  '106.ORCL', // 甲骨文
  '105.QCOM', // 高通
  '105.AMAT', // 应用材料
  '105.MU', // 美光科技
  '105.TXN', // 德州仪器
  '105.INTC', // 英特尔
  '105.SNDK', // 闪迪
  '105.MRVL', // 迈威尔科技
] as const;

/**
 * 行情全景 · A股板块排行展示形式
 *
 * @deprecated 2026-10-29 起 A股全景改为 36 板块纯平铺（无列表形式），本组常量与
 * `settings.panoramaCnViewMode` 仅保留以兼容旧持久化数据，不再有消费方
 */
export const PANORAMA_CN_VIEW_MODE = {
  /** 列表表格 */
  LIST: 'list',
  /** 平铺网格 */
  TILE: 'tile',
} as const satisfies Record<string, string>;

/** A股板块排行展示形式 @deprecated 见 PANORAMA_CN_VIEW_MODE */
export type PanoramaCnViewMode = (typeof PANORAMA_CN_VIEW_MODE)[keyof typeof PANORAMA_CN_VIEW_MODE];

/** 默认展示形式 @deprecated 见 PANORAMA_CN_VIEW_MODE */
export const PANORAMA_CN_VIEW_MODE_DEFAULT: PanoramaCnViewMode = PANORAMA_CN_VIEW_MODE.LIST;

/** 展示形式切换选项 @deprecated 见 PANORAMA_CN_VIEW_MODE */
export const PANORAMA_CN_VIEW_MODE_OPTIONS: readonly { label: string; value: PanoramaCnViewMode }[] = [
  { label: '列表', value: PANORAMA_CN_VIEW_MODE.LIST },
  { label: '平铺', value: PANORAMA_CN_VIEW_MODE.TILE },
];

import type {
  PanoramaSecidEntry,
  PanoramaTechGroupConfig,
} from '../types/panorama.types.ts';

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

/** 美股全景展示的行业 ETF 清单（secid 市场码 107 = NYSE Arca，SPDR 行业系列；名称为上游 f14 原文） */
export const PANORAMA_US_SECIDS: readonly PanoramaSecidEntry[] = [
  { secid: '107.XLK', name: '科技行业精选指数ETF-SPDR' },
  { secid: '107.XLE', name: '能源指数ETF-SPDR' },
  { secid: '107.XLF', name: '金融ETF-SPDR' },
  { secid: '107.XLI', name: '工业ETF-SPDR' },
  { secid: '107.XLY', name: '可选消费ETF-SPDR' },
  { secid: '107.XLP', name: '日常消费ETF-SPDR' },
  { secid: '107.XLU', name: '公用事业ETF-SPDR' },
  { secid: '107.XLB', name: '基础材料ETF-SPDR' },
  { secid: '107.XLRE', name: '房地产ETF-SPDR' },
  { secid: '107.XLC', name: '通讯服务行业精选指数ETF-SPDR' },
  { secid: '107.XLV', name: '医疗ETF-SPDR' },
  { secid: '107.SPY', name: '标普500ETF-SPDR' },
  { secid: '107.DIA', name: '道琼斯指数ETF-SPDR' },
] as const satisfies readonly PanoramaSecidEntry[];

/**
 * 国外科技巨头分组配置（2026-11-03 王总指定：由「美股科技巨头」扩为「国外科技巨头」，
 * 补充日本 / 韩国与大 A 科技板块关联较大的半导体 / CPO / PCB / MLCC 公司，按市场分组展示）
 *
 * secid 市场码：105 = 纳斯达克 / 106 = 纽交所 / 176 = 日股（东京东证）/ 177 = 韩股（KOSPI），
 * 176/177 经东财 suggest 接口逐只解析、ulist 实测 36/36 全部有返回（2026-11-03）。
 * TDK（东京 6808）上游不覆盖未收录；MLCC 已有村田 / 太阳诱电 / 三星电机。
 * 组内顺序按产业链重要性排列（展示顺序 = 配置顺序，不做涨跌幅重排）；
 * 上游缺行的标的名称仍显示、涨跌幅为 `--`。
 */
export const PANORAMA_GLOBAL_TECH_GROUPS: readonly PanoramaTechGroupConfig[] = [
  {
    label: '美国',
    entries: [
      { secid: '105.NVDA', name: '英伟达' },
      { secid: '105.AAPL', name: '苹果' },
      { secid: '105.MSFT', name: '微软' },
      { secid: '105.GOOGL', name: '谷歌' },
      { secid: '105.AMZN', name: '亚马逊' },
      { secid: '105.META', name: 'Meta' },
      { secid: '105.TSLA', name: '特斯拉' },
      { secid: '105.AVGO', name: '博通' },
      { secid: '106.TSM', name: '台积电' },
      { secid: '105.ASML', name: '阿斯麦' },
      { secid: '105.AMD', name: '超威半导体' },
      { secid: '106.ORCL', name: '甲骨文' },
      { secid: '105.QCOM', name: '高通' },
      { secid: '105.AMAT', name: '应用材料' },
      { secid: '105.MU', name: '美光科技' },
      { secid: '105.TXN', name: '德州仪器' },
      { secid: '105.INTC', name: '英特尔' },
      { secid: '105.SNDK', name: '闪迪' },
      { secid: '105.MRVL', name: '迈威尔科技' },
    ],
  },
  {
    label: '日本',
    entries: [
      // 半导体设备 / 硅片
      { secid: '176.8035', name: '东京电子' },
      { secid: '176.6857', name: '爱德万测试' },
      { secid: '176.6146', name: '迪斯科' },
      { secid: '176.6920', name: 'Lasertec' },
      { secid: '176.7735', name: '斯库林集团' },
      { secid: '176.4063', name: '信越化学工业' },
      { secid: '176.3436', name: '胜高' },
      // IC 载板（PCB 链）
      { secid: '176.4062', name: '揖斐电电子' },
      // 陶瓷封装 / 被动元件
      { secid: '176.6971', name: '京瓷' },
      // MLCC
      { secid: '176.6981', name: '村田制作所' },
      { secid: '176.6976', name: '太阳诱电' },
      // 光纤光器件（CPO 链）
      { secid: '176.5802', name: '住友电气工业' },
    ],
  },
  {
    label: '韩国',
    entries: [
      { secid: '177.005930', name: '三星电子' },
      { secid: '177.000660', name: 'SK海力士' },
      // FC-BGA 载板
      { secid: '177.011070', name: 'LG Innotek' },
      // MLCC / FC-BGA 载板
      { secid: '177.009150', name: '三星电机' },
      // AI 服务器 PCB
      { secid: '177.007660', name: 'Isu Petasys' },
    ],
  },
] as const satisfies readonly PanoramaTechGroupConfig[];

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

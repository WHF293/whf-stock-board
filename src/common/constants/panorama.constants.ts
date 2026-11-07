import type {
  PanoramaTechGroupConfig,
  PanoramaThemeFundGroup,
} from '../types/panorama.types.ts';

/** 全景页四组卡片定义（id 兼作卡片折叠设置与模块排序的 key） */
export interface PanoramaCardDef {
  /** 卡片 id（`cn` / `globalTech` / `usBoards` / `macro`） */
  id: string;
  /** 展示名（模块排序弹窗条目） */
  label: string;
}

/**
 * 全景页四组卡片清单（2026-11-07 王总指定模块排序）：单一事实源——
 * 卡片渲染顺序（settings.panoramaModuleOrder）与排序弹窗条目都从这里取
 */
export const PANORAMA_CARDS: readonly PanoramaCardDef[] = [
  { id: 'cn', label: 'A股板块平铺' },
  { id: 'globalTech', label: '国外科技巨头' },
  { id: 'usBoards', label: '美股基金' },
  { id: 'macro', label: '全球宏观' },
];

/** 四组卡片默认顺序（用户编排存 settings.panoramaModuleOrder） */
export const PANORAMA_CARD_DEFAULT_ORDER: readonly string[] = PANORAMA_CARDS.map(
  (card) => card.id,
);

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

/**
 * 美股基金主题分组（2026-11-07 王总指定替换「美股行业 ETF」模块，分类对标美基星图
 * 「全球产业数据」）：每主题一篮子代表性标的，主题涨跌幅 = 成分平均。
 *
 * 成分选型：有干净行业 ETF 的主题优先单挂 ETF（半导体 SMH / 机器人 BOTZ / 黄金矿业 GDX
 * 等），无对应 ETF 的主题用 2~4 只龙头股篮子（CPO / 存储 / 数据中心 / 商业航天 / 卫星 /
 * 核电 / 量子计算等）；成分股与 ETF 可跨主题复用（同一标的本就服务多条产业链）。
 *
 * secid 市场码：105 / 106 / 107 均经东财 ulist 实测 72/72 全部有返回（2026-11-07，
 * 其中 SMH / BOTZ / WMT / STX 在东财归 105、UUUU 归 107，与真实交易所归属不同，
 * 以东财 suggest 接口的 MktNum 为准）；主题顺序对标美基星图截图，不做涨跌幅重排。
 */
export const PANORAMA_US_THEME_FUNDS: readonly PanoramaThemeFundGroup[] = [
  { label: 'AI 算力', secids: ['105.NVDA', '105.AMD', '105.AVGO', '105.MRVL'] },
  { label: 'CPO', secids: ['106.COHR', '106.FN', '106.CIEN', '105.AVGO'] },
  { label: '半导体', secids: ['105.SMH'] },
  { label: '存储', secids: ['105.MU', '105.WDC', '105.STX'] },
  { label: '数据中心', secids: ['106.VRT', '105.EQIX', '106.DLR'] },
  { label: '云计算', secids: ['105.MSFT', '106.NOW', '106.CRM'] },
  { label: '商业航天', secids: ['105.RKLB', '105.ASTS', '105.LUNR'] },
  { label: '卫星', secids: ['105.IRDM', '105.VSAT', '105.GSAT'] },
  { label: '机器人', secids: ['105.BOTZ', '105.TER'] },
  { label: '自动驾驶', secids: ['105.TSLA', '105.GOOG', '106.UBER'] },
  { label: '核电', secids: ['106.CCJ', '106.OKLO', '106.SMR'] },
  { label: '电网', secids: ['106.ETN', '106.HUBB', '106.PWR'] },
  { label: '军工', secids: ['106.LMT', '106.RTX', '106.NOC'] },
  { label: '光伏', secids: ['105.ENPH', '105.FSLR', '105.RUN'] },
  { label: '锂电池', secids: ['106.ALB', '106.SQM', '107.LIT'] },
  { label: '油气', secids: ['106.XOM', '106.CVX', '107.XOP'] },
  { label: '铜有色', secids: ['106.FCX', '106.SCCO'] },
  { label: '黄金矿业', secids: ['107.GDX', '106.NEM', '106.GOLD'] },
  { label: '银行金融', secids: ['106.JPM', '106.BAC', '106.GS'] },
  { label: '生物医药', secids: ['106.LLY', '106.JNJ', '107.XBI'] },
  { label: '消费', secids: ['105.WMT', '105.COST', '106.PG'] },
  { label: '稀土', secids: ['106.MP', '107.UUUU'] },
  { label: '通信设备', secids: ['106.ANET', '105.CSCO'] },
  { label: '量子计算', secids: ['106.IONQ', '105.RGTI', '105.QBTS'] },
  { label: '区块链', secids: ['105.COIN', '105.MSTR'] },
  { label: 'AI 应用', secids: ['105.PLTR', '105.META', '105.APP'] },
];

/**
 * 美股盘前涨跌幅字段（东财 push2 ulist；社区口径 f248 = 盘前价 / f249 = 盘前涨跌额 /
 * f250 = 盘前涨跌幅）。2026-11-07（周六）实测四字段全为 `'-'`，语义待交易时段复验——
 * **首个美股盘前时段（周一北京 16:00 后）须探活校正**，不符则调整本常量或置 null。
 * 置 null 时盘前口径自动停用（盘前窗口内退化为显示最近收盘涨跌）。
 */
export const US_PREMARKET_PCT_FIELD: string | null = 'f250';

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

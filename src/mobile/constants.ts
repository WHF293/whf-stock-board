import type { SinaNewsLid } from '../common/api/news.api.ts';

/**
 * 移动端常量（需求稿 v1.1：.ai/项目资源/stock-board-mobile-dual-tab-v1.html）
 *
 * 移动端专属取值集中于此；与桌面共用的业务常量（榜单分组 / 平台顺序 / 涨跌色等）
 * 直接从 src/constants 复用，不在本文件重复声明
 */

/** 快照缓存 TTL（毫秒）：榜单与新闻快照统一 30 分钟，写入持久层（mobile.cache 命名空间） */
export const MOBILE_CACHE_TTL_MS = 30 * 60_000;

/** 新闻流单页条数（新浪 / 同花顺 page 型翻页的 num 参数） */
export const MOBILE_NEWS_PAGE_SIZE = 20;

/** 新浪频道 lid：财经综合热点（2516） */
export const SINA_LID_FINANCE: SinaNewsLid = 2516;

/** 新浪频道 lid：股市快讯（2517） */
export const SINA_LID_STOCK: SinaNewsLid = 2517;

/** 移动端前台轮询间隔选项（需求稿四档：5s / 10s / 30s / 1min） */
export const MOBILE_POLLING_OPTIONS: readonly { label: string; value: number }[] = [
  { label: '5s', value: 5_000 },
  { label: '10s', value: 10_000 },
  { label: '30s', value: 30_000 },
  { label: '1min', value: 60_000 },
];

/** 移动端默认前台轮询间隔（毫秒）：30s（需求稿 v1.1 定稿；高频档上游可能限流） */
export const MOBILE_POLLING_DEFAULT = 30_000;

/** 新闻频道加载方式：page = 页码翻页 / cursor = 游标翻页 / single = 单页快照（无更多） */
export type MobileNewsChannelType = 'page' | 'cursor' | 'single';

/**
 * 特殊渲染频道（模板分支渲染，不走 NewsRow 通用新闻列表）
 *
 * 对齐桌面 HotNewsView 的卡片分支：
 * - clsHot / tpHot：名次榜（财联社热榜含阅读数 / 澎湃热榜含相对时间）
 * - emHot：东财热搜热词榜；emConcept：东财领涨概念榜（板块 + 涨跌幅 + 领涨股）
 * - theme：同花顺热点主题（主题 chips + 主题资讯流，资讯流走通用列表）
 */
export type MobileNewsSpecialKind = 'clsHot' | 'tpHot' | 'emHot' | 'emConcept' | 'theme';

/** 移动端新闻子栏目 */
export interface MobileNewsChannel {
  /** 频道 key（缓存键组成部分，如 `sina:caijing`） */
  key: string;
  /** 展示名 */
  label: string;
  /** 加载方式（决定翻页与「已经到底了」行为） */
  type: MobileNewsChannelType;
  /** 特殊渲染分支（缺省走 NewsRow 通用新闻列表） */
  special?: MobileNewsSpecialKind;
}

/** 移动端新闻源（与桌面 HotNewsView 六卡一一对应，首个为默认源） */
export interface MobileNewsSource {
  /** 源 key（缓存键组成部分） */
  key: string;
  /** 展示名 */
  label: string;
  /** 该源可切换的子栏目（首期为各源主新闻通道；名次榜类子栏目随后续迭代接入） */
  channels: readonly MobileNewsChannel[];
}

/** 六源定义（命名与桌面 HotNewsView 卡片一一对应；
 * 默认顺序 2026-10-10 调整为财联社优先，与桌面 DEFAULT_SOURCE_ORDER 保持一致） */
export const MOBILE_NEWS_SOURCES: readonly MobileNewsSource[] = [
  {
    key: 'cls',
    label: '财联社',
    // 子视图序对齐桌面 CLS_SUB_VIEWS：深度 → 热榜
    channels: [
      { key: 'depth', label: '深度', type: 'single' },
      { key: 'hot', label: '热榜', type: 'single', special: 'clsHot' },
    ],
  },
  {
    key: 'tdx',
    label: '通达信资讯',
    channels: [
      { key: 'yw', label: '要闻', type: 'single' },
      { key: 'ag', label: 'A股', type: 'single' },
      { key: 'cj', label: '产经', type: 'single' },
    ],
  },
  {
    key: 'ths',
    label: '同花顺',
    // 子视图序对齐桌面 THS_SUB_VIEWS：热点主题 → 快讯 → 头条
    channels: [
      { key: 'theme', label: '热点主题', type: 'page', special: 'theme' },
      { key: 'flash', label: '快讯', type: 'page' },
      { key: 'headline', label: '头条', type: 'single' },
    ],
  },
  {
    key: 'em',
    label: '东方财富',
    // 子视图序对齐桌面 EM_SUB_VIEWS：快讯 → 推荐 → 热搜 → 领涨概念
    channels: [
      { key: 'flash', label: '快讯', type: 'cursor' },
      { key: 'rec', label: '推荐', type: 'single' },
      { key: 'hot', label: '热搜', type: 'single', special: 'emHot' },
      { key: 'concept', label: '领涨概念', type: 'single', special: 'emConcept' },
    ],
  },
  {
    key: 'sina',
    label: '新浪财经',
    channels: [
      { key: 'caijing', label: '财经热点', type: 'page' },
      { key: 'kuaixun', label: '股市快讯', type: 'page' },
    ],
  },
  {
    key: 'tp',
    label: '澎湃新闻',
    // 子视图序对齐桌面 TP_SUB_VIEWS：快讯 → 热榜
    channels: [
      { key: 'flash', label: '快讯', type: 'cursor' },
      { key: 'hot', label: '热榜', type: 'single', special: 'tpHot' },
    ],
  },
];

/** 新闻源 logo（public/news-logos/ 本地资源离线可用，key 对齐 MOBILE_NEWS_SOURCES；navbar 标题前展示） */
export const MOBILE_NEWS_SOURCE_LOGOS: Record<string, string> = {
  cls: '/news-logos/cls.ico',
  tdx: '/news-logos/tdx.ico',
  ths: '/news-logos/10jqka.ico',
  em: '/news-logos/eastmoney.ico',
  sina: '/news-logos/sina.ico',
  tp: '/news-logos/thepaper.ico',
};

/**
 * 移动端底部 Tab（主 Tab 页路径 + 图标 + 文案；icon 为 Vant 图标名，2026-10-30 起
 * 五 Tab：首页 / 插件 / 自选 / 新闻 / 我的——行情模块并入首页（P4），原行情 Tab 槽位
 * 换插件入口（/plugins，与 MOBILE_PLUGINS_PATH 同源；今天炒什么等行情页金刚区入口
 * 迁回首页金刚区候选集）
 */
export const MOBILE_TAB_ITEMS: readonly { path: string; label: string; icon: string }[] = [
  { path: '/', label: '首页', icon: 'wap-home-o' },
  { path: '/plugins', label: '插件', icon: 'apps-o' },
  { path: '/watchlist', label: '自选', icon: 'star-o' },
  { path: '/news', label: '新闻', icon: 'newspaper-o' },
  { path: '/mine', label: '我的', icon: 'user-o' },
];

/** 移动端免责声明（「我的」页底部与设置页「免责声明」共用一份文案） */
export const MOBILE_DISCLAIMER =
  '行情与资讯数据来自第三方公开接口，仅供个人学习参考，不构成任何投资建议。请以官方行情软件为准。';

/* ---- 小米自由窗口 / 大屏断点（2026-10-28，方案见 .ai/开发方案/ 同日文档）----
 * 三档：Compact <600（现状单列 + 底部 TabBar）/ Medium 600-840（Rail + 2 列）/
 * Expanded ≥840（Rail + 3 列 + 个股详情双栏）。
 * 数值必须与 mobile.css 末尾「断点适配」分档的 @media 阈值一致（CSS 侧无法引用
 * TS 常量，两侧以注释互指，改这里必须同步改那边） */

/** Medium 档下限（px）：底部 TabBar 换左侧 NavigationRail、列表 2 列 */
export const MOBILE_BREAKPOINT_MD_PX = 600;

/** Expanded 档下限（px）：列表 3 列、个股详情双栏 */
export const MOBILE_BREAKPOINT_LG_PX = 840;

/* ---- TabBar 指示胶囊切换动效（DESIGN-MOBILE.md §3）----
 * 行程：位移 + 均匀缩小至 65% + 降低不透明度；接近落点时回弹放大恢复默认。
 * 规格来源：.ai/项目资源/stock-board-mobile-ui-clean-v2.html 附录 §1-② */

/** 行程位移时长（毫秒；先快后慢曲线） */
export const MOBILE_TAB_THUMB_TRAVEL_MS = 340;

/** 行程缓动（easeOutQuint 感，与横滑过渡同族） */
export const MOBILE_TAB_THUMB_EASE_TRAVEL = 'cubic-bezier(0.16, 1, 0.3, 1)';

/** 行程中的缩小比例（拖拽跟手时用同一档，保持手感一致） */
export const MOBILE_TAB_THUMB_TRAVEL_SCALE = 0.8;

/** 行程中的不透明度 */
export const MOBILE_TAB_THUMB_TRAVEL_OPACITY = '0.55';

/** 行程开始多少毫秒后开始恢复（接近落点） */
export const MOBILE_TAB_THUMB_RESTORE_DELAY_MS = 160;

/** 恢复时长（毫秒；轻回弹曲线） */
export const MOBILE_TAB_THUMB_RESTORE_MS = 220;

/** 恢复缓动（轻微过冲的回弹） */
export const MOBILE_TAB_THUMB_EASE_RESTORE = 'cubic-bezier(0.3, 1.35, 0.6, 1)';

/** 按住气泡拖拽时位移小于多少 px 视为普通点击（不进入拖拽态、不吞 click） */
export const MOBILE_TAB_DRAG_SLOP_PX = 8;

/* ---- 首页「书本翻页」容器（BookFlipBook：成交额 / 涨跌分布 / 板块热力 三模块横翻）---- */

/** 单次翻页动画时长（毫秒；翻页中互斥锁按此时长持有） */
export const MOBILE_BOOK_FLIP_MS = 560;

/** 书页统一高度（px）：三模块共用一张「纸」的定高，超出裁切
 * （480：2026-10-13 成交额卡并入实时摘要两行（今日实时/预测全天 + 5/60日均）后，
 *  440 已容不下 240px 图表下限，x 轴被内嵌手势条遮挡，故整体加高） */
export const MOBILE_BOOK_PAGE_HEIGHT = 480;

/** 左右翻页热区宽度（px；贴书本左右边缘的透明点击条，避免误触图区交互） */
export const MOBILE_BOOK_EDGE_WIDTH = 40;

/** 底部滑块拖动位移小于多少 px 视为点选（按点位直接选页，不进入拖拽态） */
/** 手势条滑动切页阈值（|dx| 不小于此值且 |dx| > |dy| 才切页；与资金流向页翻页同值） */
export const MOBILE_BOOK_SWIPE_PX = 48;

/* ---- 首页金刚区动态行（2026-10-30 P3：解除 10 格上限，5 列动态行数 + 超 2 行折叠）---- */

/** 金刚区每行入口数 */
export const MOBILE_KING_ROW_SIZE = 5;

/** 折叠态展示行数（超出的行收进展开区，通栏 chevron 展开/收起；会话内记忆不持久化，
 * 交互对齐行情页全球指数「下拉显示更多」，方案 P3 定稿） */
export const MOBILE_KING_COLLAPSED_ROWS = 2;

/** 插件入口 icon 兜底（插件声明的 icon 是 PC MenuIcon 体系的 key，非 Vant 图标名时兜底） */
export const MOBILE_KING_PLUGIN_ICON_FALLBACK = 'apps-o';

/** 插件入口固定彩色调色板（取值域与内置金刚区彩色同一套；按路径稳定哈希取色，
 * 同一入口恒同色、亮暗同一套，不随主题——2026-10-11 王总指定的金刚区彩色口径） */
export const MOBILE_KING_PLUGIN_COLORS: readonly string[] = [
  '#0ea5e9',
  '#3b82f6',
  '#10b981',
  '#eab308',
  '#14b8a6',
  '#0e9488',
  '#ef4444',
  '#8b5cf6',
  '#f97316',
  '#ec4899',
];

/**
 * 插件金刚区入口的固定彩色（按路径稳定哈希取调色板色）
 * @param path 插件页路由路径
 * @returns 调色板色值
 */
export const mobileKingPluginColor = (path: string): string => {
  let hash = 0;
  for (let i = 0; i < path.length; i += 1) {
    hash = (hash * 31 + path.charCodeAt(i)) % 0x7fffffff;
  }
  return MOBILE_KING_PLUGIN_COLORS[hash % MOBILE_KING_PLUGIN_COLORS.length]!;
};

/** TabBar 液态玻璃折射（SVG feDisplacementMap；移植自 shuding/liquid-glass）----
 * 中间区域零位移、仅边缘环带折射；仅 Chromium 系 WebView 生效（backdrop-filter: url(#滤镜)），
 * 不支持的环境由 util 探测后回退现有磨砂玻璃。 */

/** 折射环带内边界：距边缘多少（占半高比例）开始位移，越小环带越厚 */
export const MOBILE_TAB_GLASS_RIM = 0.12;

/** 折射位移强度倍率（1 = 与原版一致；真机看着晕就调小） */
export const MOBILE_TAB_GLASS_STRENGTH = 1;

/** resize 后防抖多少毫秒再重建置换图（旋转 / 分屏场景） */
export const MOBILE_TAB_GLASS_RESIZE_DEBOUNCE_MS = 300;

/* ---- 资金流向页（v4.3 主 Tab；数据模块与 PC 同源，参数口径对齐）---- */

/** 主力净流入折线展示天数（与 PC 市场总览 MARKET_FLOW_DAYS 同口径） */
export const FUND_FLOW_MARKET_DAYS = 10;

/** 板块资金 / 历史净流入最多选中板块数（复用 PC 同一上限变量，单轮最多勾 8 个） */
export { SECTOR_CURVE_MAX_COUNT as FUND_FLOW_SECTOR_MAX } from '../common/constants/sector-flow-curve.constants.ts';

/** 默认勾选：按当日主力净流入流入 / 流出各取前 N（合计 2N ≤ 上限） */
export const FUND_FLOW_SECTOR_DEFAULT_PER_SIDE = 4;

/** 主力净流入折线图高度（像素；2026-10-13 王总：模块高度压到原来的 2/3，230 → 153） */
export const FUND_FLOW_CHART_HEIGHT_MAIN = 153;

/** 板块资金多曲线图高度（像素） */
export const FUND_FLOW_CHART_HEIGHT_SECTOR = 270;

/** 历史净流入展示天数（2026-10-13 王总：只显示最近 10 个交易日） */
export const FUND_FLOW_HISTORY_DAYS = 10;

/** 历史净流入翻页卡固定高度（像素；按 10 行逐日 + 头部定高，不再内部滚动） */
export const FUND_FLOW_HISTORY_CARD_HEIGHT = 230;

/** 手势翻页：横滑判定阈值（|dx| 不小于此值且 |dx| > |dy| 才切页） */
export const FUND_FLOW_PAGER_SWIPE_PX = 48;

/** 资金流向取数超时（毫秒；2026-10-30 真机反馈弱网 TCP 挂起 → 图表区骨架/白屏无出口，
 * 与新闻频道 MOBILE_CHANNEL_LOAD_TIMEOUT_MS 同口径的竞速兜底） */
export const FUND_FLOW_LOAD_TIMEOUT_MS = 15_000;

/* ---- 首页成交额曲线（移动端专属窗口；PC 市场总览为 30/60/180，共用 common 常量互不影响）---- */

/** 可选交易日窗口（最近 N 个交易日；2026-10-13 起与 PC 共用 common 变量，10/30/60 同源） */
export {
  TURNOVER_RANGE_DAYS as MOBILE_TURNOVER_RANGES,
  TURNOVER_RANGE_DEFAULT as MOBILE_TURNOVER_RANGE_DEFAULT,
} from '../common/constants/turnover.constants.ts';

/* ---- 调试模式（「我的」页应用信息卡连点开启；网络请求面板 + 悬浮球）---- */

/** 开启调试模式的连击次数 */
export const DEBUG_TAP_COUNT = 10;

/** 连击判定时间窗口（毫秒，窗口内点击数达到 DEBUG_TAP_COUNT 才生效） */
export const DEBUG_TAP_WINDOW_MS = 3_000;

/** 网络请求环形缓冲上限（超出淘汰最旧记录） */
export const DEBUG_NETWORK_MAX_RECORDS = 200;

/** 单条响应体截断上限（字符数，防止大响应撑爆内存） */
export const DEBUG_BODY_MAX_CHARS = 64 * 1024;

/** 悬浮球直径（像素） */
export const DEBUG_BALL_SIZE = 44;

/** 悬浮球拖动位移判定阈值（px，小于此值视为点按开面板） */
export const DEBUG_BALL_DRAG_SLOP_PX = 6;

/** 悬浮球默认位置：距视口右缘 / 底缘的偏移（px；底部避开 TabBar） */
export const DEBUG_BALL_DEFAULT_INSET = { x: 16, y: 120 };

/* ==== 横滑切源手势（use-swipe-switch，参数对齐 youtube-desktop useSwipeSwitch） ==== */

/** 轴向锁定阈值（px）：横向位移达到该值且纵模比达标才进入跟手拖拽 */
export const SWIPE_AXIS_LOCK_PX = 12;

/** 轴向锁定纵横比：横向位移须大于纵向位移 × 该比值（纵向占优整轮让位原生滚动） */
export const SWIPE_AXIS_RATIO = 1.2;

/** 边界越拖橡皮筋阻尼系数（首项右拖 / 末项左拖） */
export const SWIPE_OVERDRAG_DAMP = 0.28;

/** 轻扫判定最小位移（px） */
export const SWIPE_FLICK_MIN_PX = 40;

/** 内层步进判定位移（px）：源内 tab 还可切时，横滑过该位移（或轻扫）即切 tab 不切源 */
export const SWIPE_INNER_STEP_PX = 48;

/** 轻扫判定最小速度（px/ms） */
export const SWIPE_FLICK_VELOCITY = 0.5;

/** 切换过渡动画时长（毫秒） */
export const SWIPE_ANIM_MS = 260;

/** 切换过渡动画缓动曲线 */
export const SWIPE_EASE = 'cubic-bezier(0.22, 0.61, 0.36, 1)';

/** 骨架屏行数（新闻列表 / 榜单首载与横滑切源过渡态统一行数） */
export const SKELETON_ROW_COUNT = 10;

/* ---- 插件装配（2026-10-30 移动端插件体系，方案：.ai/开发方案/ 同日文档）---- */

/** 个股详情二级页路径前缀（与 mobile/router.ts 的 /stock/:code 同源；app:stock-open 落点） */
export const MOBILE_STOCK_DETAIL_PATH_PREFIX = '/stock';

/** 市场状态时钟 tick 间隔（毫秒）：分钟级驱动交易窗口 getter（与 PC MainLayout 同值） */
export const MOBILE_MARKET_STATUS_TICK_MS = 60_000;

/**
 * 频道加载超时（毫秒）：横滑切 tab / 首载的上游请求竞速上限——
 * 弱网下上游 TCP 挂起不落地会让 loading 永真、骨架屏无限等待（2026-10-30 真机反馈），
 * 超时后经 ensureChannel / ensureBoard 既有 catch 落错误态（带「重新加载」出口）
 */
export const MOBILE_CHANNEL_LOAD_TIMEOUT_MS = 15_000;

/* ---- 插件页 / 插件市场页（2026-10-30 移动端插件体系 P2/P5，方案：.ai/开发方案/ 同日文档）---- */

/** 插件管理页路径（二级页，入口在「我的」） */
export const MOBILE_PLUGINS_PATH = '/plugins';

/** 插件市场页路径（二级页，入口在插件管理页空态与页内） */
export const MOBILE_PLUGIN_MARKET_PATH = '/plugin-market';

/** 插件管理页标题 */
export const MOBILE_PLUGINS_TITLE = '插件';

/** 插件市场页标题 */
export const MOBILE_PLUGIN_MARKET_TITLE = '插件市场';

/** 插件清单空态标题 */
export const MOBILE_PLUGINS_EMPTY_TEXT = '还没有支持移动端的插件';

/** 插件清单空态引导（方案 P2 定稿文案口径） */
export const MOBILE_PLUGINS_EMPTY_HINT = '在 PC 端或插件市场安装声明支持移动端的插件';

/** 插件清单空态的「去插件市场」按钮文案 */
export const MOBILE_PLUGINS_GO_MARKET_LABEL = '去插件市场';

/** 插件清单底部的市场入口按钮文案（已装有插件时也能进市场装更多） */
export const MOBILE_PLUGINS_MARKET_ENTRY_LABEL = '插件市场 · 安装更多插件';

/** 内置插件的归属说明文案（不可卸载，只能启停） */
export const MOBILE_PLUGIN_BUILTIN_OWNER_LABEL = '随应用分发 · 只能启停，不能卸载';

/** 插件清单里「进入插件页」按钮文案（插件贡献了 menu 页面才显示） */
export const MOBILE_PLUGIN_OPEN_PAGE_LABEL = '进入';

/** 插件清单里失败插件的「重试」按钮文案 */
export const MOBILE_PLUGIN_RETRY_LABEL = '重试';

/** 插件清单里用户插件的「卸载」按钮文案 */
export const MOBILE_PLUGIN_UNINSTALL_LABEL = '卸载';

/** 卸载确认弹窗标题 */
export const MOBILE_PLUGIN_UNINSTALL_TITLE = '卸载插件';

/**
 * 卸载确认弹窗正文（第一段确认；数据表处置是第二段）
 * @param name 插件展示名
 * @param version 插件版本
 * @returns 正文文案
 */
export const MOBILE_PLUGIN_UNINSTALL_MESSAGE = (name: string, version: string): string =>
  `将卸载「${name}」v${version}：插件贡献的全部能力即刻撤销，插件运行时数据保留（重装后恢复）。是否继续？`;

/** 数据表处置弹窗标题（卸载后插件声明过数据表时的第二段确认） */
export const MOBILE_PLUGIN_DB_CLEANUP_TITLE = '插件数据表';

/**
 * 数据表处置弹窗正文
 * @param pluginName 插件展示名
 * @param tables 该插件名下的数据表（插件内表名）
 * @returns 正文文案
 */
export const MOBILE_PLUGIN_DB_CLEANUP_MESSAGE = (pluginName: string, tables: readonly string[]): string =>
  `「${pluginName}」已卸载。它在本地数据库有 ${tables.length} 张数据表（${tables.join('、')}），是否一并删除？删除后数据不可恢复。`;

/** 数据表处置弹窗的「一并删除」按钮（确认键） */
export const MOBILE_PLUGIN_DB_CLEANUP_DROP_LABEL = '一并删除';

/** 数据表处置弹窗的「保留数据」按钮（取消键） */
export const MOBILE_PLUGIN_DB_CLEANUP_KEEP_LABEL = '保留数据';

/** 市场页「在线市场」分组标题 */
export const MOBILE_PLUGIN_MARKET_SECTION_ONLINE = '在线市场';

/** 市场页「本地安装」分组标题 */
export const MOBILE_PLUGIN_MARKET_SECTION_LOCAL = '本地安装（zip 包）';

/** 市场页本地安装分组说明 */
export const MOBILE_PLUGIN_MARKET_LOCAL_HINT =
  '选择 .zip 插件包即可解析安装，支持一次多选；仅「移动端可用」的包允许装到本机。';

/** 本地 zip 安装的「选择插件包」按钮文案 */
export const MOBILE_PLUGIN_ZIP_PICK_LABEL = '选择插件包';

/** zip 包选择框的 accept（与 PC 安装弹窗同口径） */
export const MOBILE_PLUGIN_ZIP_ACCEPT = '.zip';

/** zip 任务卡「移除」按钮文案 */
export const MOBILE_PLUGIN_ZIP_REMOVE_LABEL = '移除';

/** 市场卡片与 zip 任务卡的「仅 PC 端可用」禁用说明（装不上移动端，展示但不放开安装） */
export const MOBILE_PLUGIN_PC_ONLY_LABEL = '仅 PC 端可用';

/** 安装成功提示（common 层浮窗在移动端无承载，由页面用 Toast 补位） */
export const MOBILE_PLUGIN_INSTALL_OK_TOAST = '安装成功，可在插件页查看';

/** 安装失败提示前缀（失败原因拼接在后） */
export const MOBILE_PLUGIN_INSTALL_FAIL_TOAST = '安装失败';

/** 插件信任提示（插件页 / 市场页页脚共用） */
export const MOBILE_PLUGIN_TRUST_NOTE = '插件与应用同权限运行，请只安装来源可信的插件。';

/** 市场目录加载中文案 */
export const MOBILE_PLUGIN_MARKET_LOADING_TEXT = '正在加载插件列表…';

/** 添加插件源弹窗标题 */
export const MOBILE_PLUGIN_MARKET_SOURCE_ADD_TITLE = '添加插件源';

/** 删除自定义源确认弹窗标题 */
export const MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_TITLE = '删除插件源';

/**
 * 删除自定义源确认弹窗正文
 * @param repo 仓库全名
 * @returns 确认文案
 */
export const MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_MESSAGE = (repo: string): string =>
  `将删除自定义源 ${repo}，其目录缓存一并清除（已安装的插件不受影响）。是否继续？`;

/** 添加源成功提示 */
export const MOBILE_PLUGIN_MARKET_SOURCE_ADD_OK_TOAST = '插件源已添加';

/** 添加源失败提示（具体原因由弹窗行内错误承载） */
export const MOBILE_PLUGIN_MARKET_SOURCE_ADD_FAIL_TOAST = '添加插件源失败';

/** 删除源成功提示 */
export const MOBILE_PLUGIN_MARKET_SOURCE_REMOVE_OK_TOAST = '插件源已删除';

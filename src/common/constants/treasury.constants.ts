/**
 * 大A宝典内容（股民圈流传的经验口诀与段子，纯娱乐向）
 *
 * 大A宝典独立窗口（treasury.html 轻量入口，src/widget/TreasuryWindow.vue）的
 * 静态文案单源：顶部轮播区逐句轮播（序列 = 大A祖训 → 短线口诀 → 游资金句），
 * 分组列表完整展示，底部免责提示。文案为王总 2026-10-26 指定版本，
 * 仅可整体替换，不做动态拼接。
 * 2026-11-03 王总指定：页内气泡 + 弹窗统一改为独立窗口（参考盯盘小组件模式）。
 */

/** 祖训 / 口诀条目：主句 + 补充说明（说明弱色小字展示，可空） */
export interface TreasuryRule {
  /** 口诀主句（加粗展示） */
  title: string;
  /** 补充说明（弱色小字） */
  desc?: string;
}

/** 游资大佬金句：人物 + 原话 */
export interface TreasuryQuote {
  /** 人物名（chip 展示） */
  name: string;
  /** 金句原文 */
  text: string;
}

/** 轮播页类型：祖训 / 短线口诀 / 游资金句 */
export type TreasurySlideKind = 'rule' | 'tip' | 'quote';

/** 轮播页条目：三类口诀统一结构（祖训 = title+desc；口诀 = text；金句 = author+text） */
export interface TreasurySlide {
  /** 页类型（决定渲染形态与角标文案） */
  kind: TreasurySlideKind;
  /** 祖训主句 */
  title?: string;
  /** 祖训补充说明 */
  desc?: string;
  /** 口诀 / 金句原文 */
  text?: string;
  /** 金句人物（仅 quote） */
  author?: string;
}

/** 弹窗底部免责提示（⚠️，硬性保留） */
export const TREASURY_DISCLAIMER =
  '这些都是股民圈流传的经验口诀、段子，不是投资真理，不构成投资建议，股市有风险。';

/** 弹窗标题 */
export const TREASURY_TITLE = '大A宝典';

/** 完整列表第一组标题：流传最广的大A祖训 */
export const TREASURY_RULES_GROUP_TITLE = '流传最广的大A祖训';

/** 完整列表第二组标题：短线老股民配套口诀 */
export const TREASURY_TIPS_GROUP_TITLE = '短线老股民配套口诀';

/** 完整列表第三组标题：游资大佬经典金句 */
export const TREASURY_QUOTES_GROUP_TITLE = '游资大佬经典金句';

/** 完整列表第三组标题备注（常被归入祖训） */
export const TREASURY_QUOTES_GROUP_NOTE = '常被归入祖训';

/** 轮播单页停留时长（毫秒；2026-11-03 王总指定改 8s） */
export const TREASURY_CAROUSEL_INTERVAL_MS = 8000;

/** 轮播页来源文案（正文下方单独一行的分组名；金句附人物落款） */
export const TREASURY_SLIDE_KIND_LABELS = {
  rule: '大A祖训',
  tip: '短线口诀',
  quote: '游资金句',
} as const satisfies Record<TreasurySlideKind, string>;

/** 大A祖训（流传最广的 12 条） */
export const TREASURY_RULES: readonly TreasuryRule[] = [
  { title: '会空仓的才是祖师爷', desc: '行情不好管住手，等待也是交易' },
  { title: '不要和股票谈恋爱', desc: '股票只是筹码，错了就认，不要死扛深套' },
  { title: '买在无人问津，卖在人声鼎沸', desc: '狂热时不追，恐慌时不乱割' },
  { title: '高开多半要砸盘，利好常常是兑现', desc: '利好落地容易出货' },
  { title: '地量见地价，天量见天价', desc: '高位巨量小心跑路；长期缩量才容易磨底' },
  { title: '下跌趋势不抄底', desc: '你以为是底，下面还有底，不跟趋势作对' },
  { title: '只做龙头，少碰杂毛', desc: '龙头有资金溢价，跟风股经常涨不动、跌得快' },
  {
    title: '账户连红三天减一半，连红五天考虑清仓',
    desc: '当你觉得自己无敌想晒收益的时候，往往就是风险临近',
  },
  { title: '二选一必选错', desc: '同时看好两只票，选的那只常常跑输没选的那只（圈内名梗）' },
  { title: '宁可卖飞，不要深套', desc: '小赚也是赚，不要总想着吃满每一段行情' },
  { title: '缩量拉升多诱多，放量大跌不是底', desc: '量能是资金的真话' },
  { title: '龙头死于加速，分歧走更远', desc: '连续一字加速的龙头，很容易突然断板崩盘' },
];

/** 短线老股民配套口诀（单行句式） */
export const TREASURY_TIPS: readonly string[] = [
  '早盘大涨要减仓，下午大涨不追高；早盘大跌不急割，下午大跌次日防',
  '低位放量多看一眼，高位放量抓紧避险',
  '断板不格局，连板断板先离场',
  '券商涨停非牛市，常是行情兑现信号',
];

/** 游资大佬经典金句（常被归入祖训） */
export const TREASURY_QUOTES: readonly TreasuryQuote[] = [
  { name: '炒股养家', text: '别人贪婪我恐慌，别人恐慌我贪婪；买在分歧，卖在一致' },
  { name: '赵老哥', text: '二板定龙头，一板看不出个毛' },
  { name: '章盟主', text: '只做龙头，只做主升，只做惯性' },
];

/** 轮播页序列（祖训 → 短线口诀 → 游资金句，气泡逐句播放） */
export const TREASURY_SLIDES: readonly TreasurySlide[] = [
  ...TREASURY_RULES.map(
    (rule): TreasurySlide => ({ kind: 'rule', title: rule.title, desc: rule.desc }),
  ),
  ...TREASURY_TIPS.map((tip): TreasurySlide => ({ kind: 'tip', text: tip })),
  ...TREASURY_QUOTES.map(
    (quote): TreasurySlide => ({ kind: 'quote', author: quote.name, text: quote.text }),
  ),
];

/**
 * 弹窗平铺清单标题与附注（2026-11-03 王总指定移除分组概念：祖训 / 口诀 / 金句 /
 * 我的祖训不再分节，合成一个连续编号的清单，我的祖训追加末尾、悬浮可删）
 */
export const TREASURY_FLAT_LIST_TITLE = '大A祖训';

// ---------- 桌面横条窗口（2026-11-03 王总指定：固钉升级为独立桌面横条，参考盯盘条形态） ----------

/** 宝典横条窗口 label（capabilities 按此授权；全局唯一） */
export const TREASURY_BAR_WINDOW_LABEL = 'treasury-fab';

/** 大A宝典气泡（桌面横条）默认开关（2026-11-03 王总指定默认关闭，设置页开启） */
export const TREASURY_BAR_ENABLED_DEFAULT = false;

/** 宝典弹窗窗口 label（单例，横条点击打开） */
export const TREASURY_POPUP_WINDOW_LABEL = 'treasury-bubble';

/** 横条窗口加载地址（多页入口 + 视图参数；bar 视图与弹窗视图共用 treasury.html） */
export const TREASURY_BAR_WINDOW_URL = 'treasury.html?view=bar';

/**
 * 横条宽度（逻辑像素；单行一句，放不下跑马灯，点击开弹窗看全文；
 * 2026-11-03 王总澄清：一行两个指弹窗列表，横条仍单句；后指定缩到 200）
 */
export const TREASURY_BAR_WIDTH = 200;

/** 横条高度（逻辑像素）= 图标 20 + 上下各 8 padding + 上下各 1 边框 */
export const TREASURY_BAR_HEIGHT = 38;

/** appStorage 命名空间：横条窗口位置持久化（JSON {x,y} = 物理像素，随屏幕缩放） */
export const STORAGE_NS_TREASURY_BAR_POSITION = 'treasury.barPosition';

/** 横条位置记忆的落点判定窗口（毫秒）：拖动停止该时长后才写存储，避免拖动期间高频写 */
export const TREASURY_BAR_MOVE_SETTLE_MS = 300;

/** 横条跑马灯滚动速度（像素 / 秒；单句超出可视宽时按此速度无缝循环，2026-11-03 王总指定） */
export const TREASURY_MARQUEE_SPEED_PX_S = 30;

/** 横条跑马灯内容副本间距（像素；无缝循环单程位移 = 单份文本宽 + 该间距） */
export const TREASURY_MARQUEE_GAP_PX = 24;

/** 横条跑马灯句尾停顿（毫秒）：长句滚完一轮后停留该时长再切下一句（短句仍按轮播间隔切） */
export const TREASURY_MARQUEE_PAUSE_MS = 800;

/** 跨窗口事件名（主窗口 → 横条/弹窗窗口的通信协议） */
export const TREASURY_EVENTS = {
  /** 主窗口 → 宝典窗口：主题三要素（明暗 / 主题色 / 涨跌配色）实时同步；不走 storage 事件（WebView2 跨窗口 storage 事件实测不可靠） */
  THEME: 'treasury://theme',
} as const satisfies Record<string, string>;

// ---------- 我的祖训（2026-11-03 王总指定：自定义祖训，持久化记住） ----------

/** 「我的祖训」分组标题（弹窗列表组标题） */
export const TREASURY_CUSTOM_GROUP_TITLE = '我的祖训';

/** 自定义祖训上限（防止无限膨胀拖慢横条轮播与列表渲染） */
export const TREASURY_CUSTOM_RULES_MAX = 50;

/** appStorage 命名空间：自定义祖训持久化（JSON TreasuryRule[]，跨窗口共享 localStorage） */
export const STORAGE_NS_TREASURY_CUSTOM_RULES = 'treasury.customRules';

/**
 * 组装横条轮播序列：内置序列（祖训 → 口诀 → 金句）+ 自定义祖训（kind = rule，
 * 追加到末尾）。自定义条目为空时即内置序列本身
 * @param custom 自定义祖训列表
 * @returns 轮播序列
 */
export const buildTreasurySlides = (
  custom: readonly TreasuryRule[],
): readonly TreasurySlide[] => [
  ...TREASURY_SLIDES,
  ...custom.map((rule): TreasurySlide => ({ kind: 'rule', title: rule.title, desc: rule.desc })),
];

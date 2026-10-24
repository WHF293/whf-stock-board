/**
 * 大A宝典内容（股民圈流传的经验口诀与段子，纯娱乐向）
 *
 * 全局固钉（MainLayout 右下角 TreasuryFab）弹窗的静态文案单源：
 * 弹窗为逐句轮播式（一次一句），序列 = 大A祖训 → 短线口诀 → 游资金句；
 * 底部固定免责提示。文案为王总 2026-10-26 指定版本，仅可整体替换，不做动态拼接
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

/** 轮播单页停留时长（毫秒） */
export const TREASURY_CAROUSEL_INTERVAL_MS = 5000;

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

/** 气泡轮播模式选项（弹窗顶部「轮播设置」按钮组） */
export const TREASURY_BUBBLE_MODES = [
  { value: 'auto', label: '自动' },
  { value: 'hover', label: 'hover' },
  { value: 'off', label: '关闭' },
] as const;

/** 气泡轮播模式：自动 = 气泡常驻轮播 / hover = 悬停出现 / 关闭 = 永不出现 */
export type TreasuryBubbleMode = (typeof TREASURY_BUBBLE_MODES)[number]['value'];

/** 气泡轮播默认模式（hover，王总 2026-10-26 指定） */
export const TREASURY_BUBBLE_MODE_DEFAULT: TreasuryBubbleMode = 'hover';

/** appStorage 命名空间：气泡轮播模式持久化 */
export const STORAGE_NS_TREASURY_BUBBLE_MODE = 'treasury.bubbleMode';

/** 弹窗顶部轮播设置分组标签 */
export const TREASURY_BUBBLE_SETTING_LABEL = '轮播设置';

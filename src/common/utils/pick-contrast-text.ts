/**
 * 按背景色明度挑选可读的文字色
 *
 * 自定义主题色没有「配好的文字色」（内置黑金是手工调的 --color-on-primary），
 * 用户可能选中任何颜色：亮色（鹅黄 / 浅粉）上白字会看不清，深色（藏蓝 / 墨绿）上
 * 黑字会看不清 —— 按 WCAG 相对亮度公式现场算一遍，自动二选一。
 */

/** 相对亮度阈值：高于它视为「亮背景」，用深色文字；否则用白色文字 */
const LUMINANCE_THRESHOLD = 0.45;

/** 亮背景上的文字色（与 theme.css 浅色档文字色同源） */
const TEXT_ON_LIGHT_BG = '#1f2733';

/** 深背景上的文字色 */
const TEXT_ON_DARK_BG = '#ffffff';

/**
 * 解析 #rrggbb 为 0-255 三通道
 * @param hex 颜色值（#rrggbb）
 * @returns [r, g, b]；格式非法返回 null
 */
const parseHex = (hex: string): [number, number, number] | null => {
  const match = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(hex);
  if (!match) return null;
  return [
    Number.parseInt(match[1]!, 16),
    Number.parseInt(match[2]!, 16),
    Number.parseInt(match[3]!, 16),
  ];
};

/**
 * 单通道 sRGB 分量的线性化（WCAG 相对亮度公式第一步）
 * @param channel 0-255 通道值
 * @returns 0-1 线性值
 */
const linearize = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/**
 * 按背景色挑选可读的文字色
 * @param hex 背景色（#rrggbb）
 * @returns 文字色（深色 / 白色二选一；解析失败回退白色）
 */
export const pickContrastText = (hex: string): string => {
  const rgb = parseHex(hex);
  if (!rgb) return TEXT_ON_DARK_BG;
  const [r, g, b] = rgb.map(linearize);
  const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  return luminance > LUMINANCE_THRESHOLD ? TEXT_ON_LIGHT_BG : TEXT_ON_DARK_BG;
};

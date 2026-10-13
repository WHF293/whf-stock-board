/**
 * 高亮玻璃透明度常量（2026-10-13 王总：玻璃按钮半透明化 UI 稿定稿后新增设置项）
 *
 * 消费链路：设置页滑杆 → settings store（持久化）→ use-document-theme 写
 * <html> 内联 CSS 变量 → theme.css `.pc-nav-bubble` 等玻璃样式读变量生效。
 */

/** 玻璃底色默认透明度（方案A 推荐档：亮色白底 0.24；暗色在同值上 +0.2 补偿） */
export const GLASS_OPACITY_DEFAULT = 0.24;

/** 玻璃透明度下限（再低描边+光带撑不起按钮形状） */
export const GLASS_OPACITY_MIN = 0.06;

/** 玻璃透明度上限（超过后接近稿子里的「现状」发白档，失去透出意义） */
export const GLASS_OPACITY_MAX = 0.6;

/** 滑杆步进 */
export const GLASS_OPACITY_STEP = 0.02;

/** 下发到 <html> 的 CSS 变量名（theme.css :root 定义默认值） */
export const GLASS_OPACITY_CSS_VAR = '--glass-alpha';

/** 玻璃高光带默认开关（斜向「光线照在玻璃上」渐变；关闭后只留半透明底 + 描边 + 模糊） */
export const GLASS_HIGHLIGHT_DEFAULT = true;

/** 高光带开关落到 <html> 的 data 属性名（theme.css 据此隐藏 ::after 光带） */
export const GLASS_HIGHLIGHT_DATA_ATTR = 'data-glass-band';

/**
 * 归一化玻璃透明度：非法 / 越界值收敛到 [MIN, MAX]，坏持久化数据与跨窗口同步共用
 * @param value 原始值
 * @returns 合法透明度（两位小数）
 */
export const normalizeGlassOpacity = (value: unknown): number => {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return GLASS_OPACITY_DEFAULT;
  return Math.min(GLASS_OPACITY_MAX, Math.max(GLASS_OPACITY_MIN, Math.round(num * 100) / 100));
};

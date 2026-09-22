/**
 * 宿主「当前真实生效的 CSS」里有哪些类 —— 供插件样式审计用
 *
 * 为什么需要：Tailwind 在**构建期**扫描宿主源码生成产物 CSS。第三方插件是运行时才进来的，
 * 它的类名在构建期根本不存在，写什么都 guaranteed 不了会被生成。
 * 于是「这个插件会不会没有样式」唯一诚实的答法是：**去看宿主现在已经加载的样式里有没有这个类**。
 *
 * 这里用 CSSOM（`document.styleSheets`）做这个答案：它是最接近真相的一层 —— 用户肉眼看到的
 * 样式就来自这些规则，不需要任何额外的清单维护。
 *
 * 刻意只放**不纯**的部分（摸 DOM）：可被冒烟直跑的纯逻辑在 `plugin/user-plugin-lint.ts`。
 */
/** 缓存：一个应用实例里宿主样式不会变，读一次就够（遍历上千条规则不算便宜） */
let cached: ReadonlySet<string> | null = null;

/**
 * 从一批 CSS 选择器文本里还原类名集合
 *
 * 选择器文本是 CSSOM 给的**转义后**形态：`.md\:grid-cols-4`、`.text-\[11px\]`、
 * `.a .b, .c`。这里只关心「有没有这个类」 —— 提取以 `.` 开头的片段再去掉转义即可，
 * 组合关系（后代 / 并集 / 伪类）一概不管。
 * @param selectors 选择器文本列表
 * @returns 类名集合（反转义后，如 `md:grid-cols-4`）
 */
export const classNamesFromSelectors = (selectors: readonly string[]): Set<string> => {
  const names = new Set<string>();
  for (const selector of selectors) {
    for (const match of selector.matchAll(/\.((?:[\w-]|\\[^\s,>+~(){])+)/g)) {
      names.add(match[1].replace(/\\/g, ''));
    }
  }
  return names;
};

/**
 * 递归收集一个样式表里的所有选择器文本
 *
 * `@layer` / `@media` / `@supports` 里的规则藏在各自的 `cssRules` 里
 * （Tailwind 的工具类几乎全在 `@layer utilities` 中），必须递归下去才拿得到。
 * @param rules 规则列表
 * @param out 收集结果（就地追加）
 */
const collectSelectors = (rules: CSSRuleList, out: string[]): void => {
  for (let index = 0; index < rules.length; index += 1) {
    const rule = rules.item(index);
    if (!rule) continue;
    const nested = (rule as Partial<CSSLayerBlockRule>).cssRules;
    if (nested && nested.length > 0) collectSelectors(nested, out);
    const { selectorText } = rule as Partial<CSSStyleRule>;
    if (typeof selectorText === 'string') out.push(selectorText);
  }
};

/**
 * 读宿主当前已加载样式里的全部类名
 *
 * 跨域样式表访问 `cssRules` 会抛 `SecurityError`（本项目没有，但别让它炸掉整条安装链路）。
 * @returns 类名集合
 */
export const readHostCssClasses = (): ReadonlySet<string> => {
  if (cached) return cached;
  const selectors: string[] = [];
  try {
    const { styleSheets } = document;
    for (let index = 0; index < styleSheets.length; index += 1) {
      try {
        collectSelectors(styleSheets.item(index)?.cssRules ?? ([] as unknown as CSSRuleList), selectors);
      } catch {
        // 单张表打不开不影响其它表，跳过即可
      }
    }
  } catch {
    // document 不可用（极端宿主环境）：集合为空 → 插件类名全部报缺失，比静默失真安全
  }
  cached = classNamesFromSelectors(selectors);
  return cached;
};

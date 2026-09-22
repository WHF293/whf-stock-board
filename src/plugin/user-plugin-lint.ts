/**
 * 用户插件代码静态预检（第三方插件的能力边界守卫）
 *
 * 为什么需要它：用户插件不是打包产物，而是运行时被包成 Blob URL 动态 `import()`
 * 的一段字符串（见 `user-plugin-loader.ts`）。解析它的那一刻，**没有任何打包器在场**，
 * 浏览器只认 URL，不认包管理器 resolution。于是三类写法必然失败：
 *
 * - `import … from '<裸包名 / 绝对路径>'` → Failed to resolve module specifier
 * - `import('…')` 动态引入同理
 * - `component: { template: '…' }` → 生产构建用的是 `vue.runtime`（不含编译器），
 *   只出 `[Vue warn]` 且渲染为空
 *
 * 这类失败原本只在动态 import 的失败回调里漏出一句底层报错（"Failed to fetch
 * dynamically imported module: blob:…"），用户看不懂也无法行动。这里在**执行之前**
 * 做一遍纯静态扫描，把「行号 + 原因 + 该怎么做」直接摆出来。
 *
 * 刻意保持纯函数：不 import 任何浏览器 / 插件内核依赖，可被烟雾测试直跑。
 * 将来若宿主上 import map（让第三方可以正规写 import），关掉这里的 import 规则即可。
 */
import { USER_PLUGIN_LINT_DOC_HINT, USER_PLUGIN_LINT_MAX_ISSUES } from '../constants/plugin.constants';

/** 一条预检问题 */
export interface UserPluginLintIssue {
  /** 源码行号（从 1 开始） */
  line: number;
  /** 面向用户的说明（含「该怎么写」的建议） */
  message: string;
  /** 命中的类名 / 模块名（仅样式审计与 import 审计产出时有，供 UI 高亮与测试断言） */
  token?: string;
}

/** 预检结果 */
export interface UserPluginLintResult {
  /** 致命问题：不处理必然加载失败 */
  blockers: readonly UserPluginLintIssue[];
  /** 非致命提醒：能装，但可能显示不正常 */
  warnings: readonly UserPluginLintIssue[];
}

/**
 * 静态 import 声明
 *
 * 同时覆盖三种形态：`import x from 'y'`、`import { x } from 'y'`、`import 'y'`（纯副作用）。
 * 限定行首匹配，避免误伤字符串 / 注释里出现的 "import …" 文本。
 */
const IMPORT_DECLARATION = /^[ \t]*import\s+(?:[^'"\n]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;

/** `export … from '…'` 再导出（与 import 同源，同样拿不到） */
const REEXPORT_DECLARATION = /^[ \t]*export\s+(?:\{[^}]*\}|\*)\s+from\s+['"]([^'"]+)['"]/gm;

/** 动态 `import('…')` */
const DYNAMIC_IMPORT = /(?:^|[^\w$.])import\s*\(/g;

/** `template: '<…'`（模板编译器的运行时缺席会导致它渲染为空） */
const TEMPLATE_FIELD = /\btemplate\s*:\s*['"`]\s*</g;

/** 长得像 Tailwind 工具类的 token：`sm:grid-cols-3` / `text-[11px]` / `bg-primary-weak` */
const CLASS_LIKE = /^(?:[a-z-]+:)*[a-z][a-z0-9/.-]*(?:\[[^\]]+\])?$/;

/** `class:` / `:class` 的起始位置 */
const CLASS_CONTEXT = /\bclass\s*:/g;

/** 一段 class 表达式最多往后看多少字符（防病态代码 / 防误吃整份产物） */
const MAX_CLASS_EXPRESSION = 400;

/** 属性值支持行符：允许跨行数组继续向下读 */
const CONTINUATION_LEAD = '\'"`]},';

/**
 * 字符串字面量是不是**比较运算的右值**
 *
 * `:class` 的表达式里常夹条件：`class: normalizeClass([base, tone === "primary" ? A : B])`。
 * 这里的 `"primary"` 是参与比较的值，不是类名 —— 不排掉就会给作者报一条纯属虚构的「缺样式」。
 * @param before 字面量之前的表达式文本
 * @returns true 表示应当跳过
 */
const isComparisonOperand = (before: string): boolean =>
  /(?:===|!==|==|!=|<=|>=|<|>)$/.test(before);

/**
 * 取某个匹配所在的源码行号（从 1 开始）
 * @param code 源码全文
 * @param index 匹配起始下标
 * @returns 行号
 */
const lineOf = (code: string, index: number): number =>
  code.slice(0, index).split('\n').length;

/**
 * 按正则收集问题
 * @param code 源码全文
 * @param pattern 已带 g 标志的正则
 * @param message 文案构造（拿到第一个捕获组与整段匹配）
 * @returns 问题列表（超过 USER_PLUGIN_LINT_MAX_ISSUES 条时截断，避免长篇刷屏）
 */
const collect = (
  code: string,
  pattern: RegExp,
  message: (specifier: string, matched: string) => string,
): UserPluginLintIssue[] => {
  const issues: UserPluginLintIssue[] = [];
  pattern.lastIndex = 0;
  let match = pattern.exec(code);
  while (match !== null) {
    issues.push({
      line: lineOf(code, match.index),
      message: message(match[1] ?? '', match[0].trim()),
    });
    if (issues.length >= USER_PLUGIN_LINT_MAX_ISSUES) break;
    match = pattern.exec(code);
  }
  return issues;
};

/**
 * 一条类名使用处
 */
export interface PluginClassUsage {
  /** 源码行号（从 1 开始） */
  line: number;
  /** 类名 */
  className: string;
}

/**
 * 把 `class:` / `:class` 后面的表达式整段抠出来（跨行数组也能兜住）
 *
 * 从 `start` 往后走，遇到下面几种情况就停：括号回到 0 层的右括号（表达式结束）、
 * 顶层的 `,` / `;`、以及「换行且下一行不像续行」。`:class: ["a", cond && "b"]`
 * 这种横跨数行的写法在 SFC 编译产物里不少见，只扫单行会漏。
 * @param code 源码全文
 * @param start 起始下标（紧接 `class:` 之后）
 * @returns 表达式片段
 */
const takeClassExpression = (code: string, start: number): string => {
  const limit = Math.min(code.length, start + MAX_CLASS_EXPRESSION);
  let depth = 0;
  let index = start;
  while (index < limit) {
    const char = code[index];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') {
      if (depth === 0) break;
      depth -= 1;
    } else if (char === '\n' && depth === 0) {
      // 下一行第一个非空白字符若是引号 / 闭合记号，说明这个表达式还在继续
      const lead = /^\s*(\S)/.exec(code.slice(index + 1, index + 40));
      if (!lead || !CONTINUATION_LEAD.includes(lead[1])) break;
    } else if ((char === ',' || char === ';') && depth === 0) break;
    index += 1;
  }
  return code.slice(start, index);
};

/**
 * 抽一段插件代码里**静态可见**的类名使用处
 *
 * 只认 `class:` / `:class` 上下文里的字符串字面量 —— 运行时拼出来的类名
 * （`"text-" + size`）静态扫不到，审计里会缺这部分，事先如实写明。
 * @param code 插件代码原文
 * @returns 使用处列表（含行号，按出现顺序）
 */
export const collectPluginClassUsages = (code: string): PluginClassUsage[] => {
  const usages: PluginClassUsage[] = [];
  CLASS_CONTEXT.lastIndex = 0;
  for (const context of code.matchAll(CLASS_CONTEXT)) {
    const start = context.index + context[0].length;
    const expression = takeClassExpression(code, start);
    for (const literal of expression.matchAll(/(['"`])([\s\S]*?)\1/g)) {
      // `tone === "primary"` 这类比较右值不是类名，别拿它去打扰作者
      if (isComparisonOperand(expression.slice(0, literal.index).trimEnd())) continue;
      const inner = literal[2];
      let offset = inner.indexOf(' ');
      let from = 0;
      while (from <= inner.length) {
        const end = offset === -1 ? inner.length : offset;
        const token = inner.slice(from, end);
        if (CLASS_LIKE.test(token)) {
          usages.push({ line: lineOf(code, start + (literal.index ?? 0) + 1 + from), className: token });
        }
        if (offset === -1) break;
        from = offset + 1;
        offset = inner.indexOf(' ', from);
      }
    }
  }
  return usages;
};

/**
 * 从使用处里筛出**宿主样式中确实不存在**的类（噪音越小越有用）
 *
 * 这就是本文件不再猜的依据：判定交给调用方拿到的「宿主已有类名集合」
 * （来自 `utils/host-css-classes.ts` 的 CSSOM 实读），这里只做纯集合差。
 * @param usages 类名使用处
 * @param availableClasses 宿主样式里现有的类名
 * @returns 提醒列表（同一类名只报第一次出现的行号）
 */
export const filterMissingPluginClasses = (
  usages: readonly PluginClassUsage[],
  availableClasses: ReadonlySet<string>,
): UserPluginLintIssue[] => {
  const seen = new Set<string>();
  const issues: UserPluginLintIssue[] = [];
  for (const usage of usages) {
    if (availableClasses.has(usage.className) || seen.has(usage.className)) continue;
    seen.add(usage.className);
    if (issues.length >= USER_PLUGIN_LINT_MAX_ISSUES) break;
    issues.push({
      line: usage.line,
      token: usage.className,
      message: `类名 ${usage.className} 在当前应用样式里不存在：Tailwind 在构建期只生成宿主源码里出现的类，`
        + '插件里的类名不会有对应 CSS，元素会以无样式形态渲染。请改用宿主 app:ui 组件或内联 style。',
    });
  }
  return issues;
};

/**
 * 静态预检一段用户插件代码，找出「在当前加载机制下必然失败」的写法
 *
 * 只做文本扫描，不执行代码、不判定语义：漏掉一处不是灾难（真加载失败还会由
 * `importUserPluginCode` 的失败回调兜底），拦住一处就是省下用户半小时排查。
 *
 * ⚠️ **这里不再产「类名可能没样式」的提醒**：那是个没有凭据的猜测（按类名长得像 Tailwind 就报），
 * 实测主线插件的 3 条全数是误报 —— 它们碰巧被宿主别处用到，因而存在于产物 CSS 中。
 * 类名是否有样式请查 CSSOM 实读（`auditPluginClassNames`），别在这里猜。
 * @param code 插件代码原文
 * @returns 预检结果（致命问题；`warnings` 恒为空，留给样式审计）
 */
export const lintUserPluginCode = (code: string): UserPluginLintResult => {
  const blockers: UserPluginLintIssue[] = [
    ...collect(
      code,
      IMPORT_DECLARATION,
      (specifier) =>
        `不能写 import（'${specifier}' 无法解析）：插件是运行时动态加载的，`
        + `依赖解析由浏览器完成，拿不到 vue 等包。全部能力请从 ctx 上取 —— ${USER_PLUGIN_LINT_DOC_HINT}`,
    ),
    ...collect(
      code,
      REEXPORT_DECLARATION,
      (specifier) =>
        `不能用 export … from（'${specifier}' 无法解析）：`
        + `与 import 同理，插件拿不到任何模块。${USER_PLUGIN_LINT_DOC_HINT}`,
    ),
    ...collect(
      code,
      DYNAMIC_IMPORT,
      () => `不支持动态 import()：同理没有模块解析能力。${USER_PLUGIN_LINT_DOC_HINT}`,
    ),
    ...collect(
      code,
      TEMPLATE_FIELD,
      () =>
        '不能用 template 字符串：生产构建不含 Vue 运行时模板编译器，'
        + '写了只会渲染为空。请换成 render 函数（可用 ctx.vue.h 创建元素）。',
    ),
  ];

  return { blockers, warnings: [] };
};

/**
 * 把致命问题压成一句面向用户的错误文案
 * @param blockers 致命问题列表
 * @returns 错误文案（多条时按行号拼接）
 */
export const formatLintBlockers = (blockers: readonly UserPluginLintIssue[]): string =>
  blockers.map((issue) => `第 ${issue.line} 行：${issue.message}`).join('\n');

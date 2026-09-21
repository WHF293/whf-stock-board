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

/** Tailwind 任意值类（`ps-[13px]`、`max-h-[55vh]`） */
const TAILWIND_ARBITRARY_VALUE = /\b[a-z-]+-\[[^\]]+\]/g;

/** Tailwind 任意属性类（`[padding-left:13px]`） */
const TAILWIND_ARBITRARY_PROPERTY = /\[[a-z-]+\s*:/g;

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
 * 静态预检一段用户插件代码，找出「在当前加载机制下必然失败 / 大概率显示异常」的写法
 *
 * 只做文本扫描，不执行代码、不判定语义：漏掉一处不是灾难（真加载失败还会由
 * `importUserPluginCode` 的失败回调兜底），拦住一处就是省下用户半小时排查。
 * @param code 插件代码原文
 * @returns 预检结果（致命问题 + 提醒）
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

  const warnings: UserPluginLintIssue[] = [
    ...collect(
      code,
      TAILWIND_ARBITRARY_VALUE,
      (specifier) =>
        `类名 ${specifier} 可能没有样式：Tailwind 在构建期只扫描宿主源码，`
        + '插件里的类不一定存在于产物 CSS 中，建议改用宿主 app:ui 组件或内联 style。',
    ),
    ...collect(
      code,
      TAILWIND_ARBITRARY_PROPERTY,
      (specifier) =>
        `类名片段 ${specifier} 可能没有样式：同 Tailwind 构建期扫描的限制，`
        + '建议改用宿主 app:ui 组件或内联 style。',
    ),
  ];

  return { blockers, warnings };
};

/**
 * 把致命问题压成一句面向用户的错误文案
 * @param blockers 致命问题列表
 * @returns 错误文案（多条时按行号拼接）
 */
export const formatLintBlockers = (blockers: readonly UserPluginLintIssue[]): string =>
  blockers.map((issue) => `第 ${issue.line} 行：${issue.message}`).join('\n');

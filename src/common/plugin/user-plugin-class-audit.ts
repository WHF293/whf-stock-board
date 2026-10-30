/**
 * 插件样式审计：把「纯 complained → 纯 set diff」接到宿主真实 CSS 上
 *
 * `plugin/user-plugin-lint.ts` 刻意保持纯函数以便烟雾测试直跑，它给出**类名收集**与
 * **集合差**两步纯逻辑；这里负责把「宿主现在有哪些类」这个只能问 DOM 的答案喂进去。
 *
 * 因此这个是**不纯**的（依赖 `document`），别放进 lint 文件里。
 */
import { readHostCssClasses } from '../utils/host-css-classes';
import { collectPluginClassUsages, filterMissingPluginClasses } from './user-plugin-lint';
import type { UserPluginLintIssue } from './user-plugin-lint';

/**
 * 审计一段插件代码的类名在**当前应用**里有没有样式
 *
 * 只覆盖静态可见的类名（`class:` / `:class` 里的字符串字面量）；运行时拼出来的
 * （`"text-" + size`）扫不到 —— 这是静态扫描的天花板，不是漏实现。
 * @param code 插件代码原文
 * @returns 提醒列表（每条含行号；全部命中时为**空数组** —— 不再有误报噪音）
 */
export const auditPluginClassNames = (code: string): UserPluginLintIssue[] =>
  filterMissingPluginClasses(collectPluginClassUsages(code), readHostCssClasses());

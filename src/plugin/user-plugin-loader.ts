/**
 * 用户插件加载器（应用内安装的动态加载与校验）
 *
 * 链路：代码字符串 → 纯校验（形态 / id 冲突）→ Blob URL 动态 `import()` →
 * 内核 `use()` 挂载。校验只做**结构检查**，不做沙箱：插件代码与应用同权限执行，
 * 安装弹窗里有明确的风险提示（与内置插件同一信任级别，个人学习应用可接受）。
 *
 * 校验函数刻意保持纯（不 import 浏览器 / Pinia 依赖），可被烟雾测试直跑。
 */
import {
  PLUGIN_ID_PATTERN,
  PLUGIN_ORIGIN,
  USER_PLUGIN_BLOB_MIME,
} from '../constants/plugin.constants';
import { pluginKernel } from './index';
import { formatLintBlockers, lintUserPluginCode } from './user-plugin-lint';
import type { UserPluginLintIssue } from './user-plugin-lint';
import type {
  PluginDefinition,
  UserPluginRecord,
} from '../types/plugin.types';

/** 用户插件模块的期望形态（ESM 默认导出或具名 `plugin` 导出） */
interface UserPluginModule {
  default?: unknown;
  plugin?: unknown;
}

/** 校验失败结果 */
interface ValidateFailure {
  ok: false;
  /** 面向用户的失败原因 */
  error: string;
  /** 非致命提醒（能展示时不影响安装；失败时一并列出便于一次性改完） */
  warnings?: readonly UserPluginLintIssue[];
}

/** 校验成功结果 */
interface ValidateSuccess {
  ok: true;
  /** 通过校验的插件定义（未求值执行，仅结构引用） */
  definition: PluginDefinition;
  /** 非致命提醒：能装，但可能显示不正常（如 Tailwind 类没有 CSS） */
  warnings?: readonly UserPluginLintIssue[];
}

/** 校验结果 */
export type ValidateResult = ValidateSuccess | ValidateFailure;

/**
 * 结构校验一个待安装的插件定义（纯函数）
 *
 * 只检查「能不能被内核接受」：对象形态、必填元信息、apply 可调用、id 合法且不冲突。
 * apply 内部逻辑的正确性交给内核的挂载失败回滚机制兜底。
 *
 * ⚠️ `occupiedIds` 只是**照断言做事**，同 id 的政策在上层：安装路径一律传 `[]`，
 * 因为「id 撞车」现在是合法情形 —— 与已装插件同 id = 升级 / 覆盖重装，与内置插件同 id = 接管内置版
 * （见 `useUserPlugins.install`）。别在这里把政策加回来。
 * @param value 待校验值（来自动态 import 的导出）
 * @param occupiedIds 调用方判定「绝对不可撞」的插件 id（传空数组 = 允许同 id）
 * @returns 校验结果（成功带定义引用，失败带原因文案）
 */
export const validateUserPluginDefinition = (
  value: unknown,
  occupiedIds: readonly string[],
): ValidateResult => {
  if (typeof value !== 'object' || value === null) {
    return { ok: false, error: '插件导出必须是对象（export default { … }）' };
  }
  const candidate = value as Partial<PluginDefinition>;
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) {
    return { ok: false, error: '缺少插件 id（字符串）' };
  }
  if (!PLUGIN_ID_PATTERN.test(candidate.id)) {
    return { ok: false, error: `插件 id 不合法：${candidate.id}（需小写字母数字开头，可含 . - _ /）` };
  }
  if (occupiedIds.includes(candidate.id)) {
    return { ok: false, error: `插件 id 已被占用：${candidate.id}` };
  }
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
    return { ok: false, error: '缺少插件名（name）' };
  }
  if (typeof candidate.version !== 'string' || candidate.version.length === 0) {
    return { ok: false, error: '缺少版本号（version）' };
  }
  if (typeof candidate.description !== 'string') {
    return { ok: false, error: '缺少说明文案（description）' };
  }
  if (typeof candidate.apply !== 'function') {
    return { ok: false, error: '缺少挂载入口（apply 函数）' };
  }
  return { ok: true, definition: value as PluginDefinition };
};

/** 模块求值成功结果 */
export interface EvaluateSuccess {
  ok: true;
  /** 模块导出的插件定义候选（尚未做结构校验） */
  exported: unknown;
}

/** 模块求值失败结果 */
export interface EvaluateFailure {
  ok: false;
  /** 面向用户的失败原因 */
  error: string;
}

/** 模块求值结果 */
export type EvaluateResult = EvaluateSuccess | EvaluateFailure;

/**
 * 把一段插件代码当作 ESM 模块求值，取回它的导出（**只求值，不做任何校验**）
 *
 * 用 Blob URL 绕开「应用打包时不知道用户插件存在」的问题：运行时把代码
 * 包装成 ESM 模块再 import，拿到导出后立即 revoke URL（模块已求值完毕）。
 *
 * 刻意**不做静态预检、不做结构校验**：这两步被拆到编排层（见 `use-plugin-package-intake`），
 * 这样 UI 才能把「预检 / 加载 / 校验」显示成流水线上独立的三步 —— 用户一眼看出
 * 是产物写错了（预检拦下）还是产物没导出合法定义（校验拦下）。
 * @param code 插件代码原文（预构建 ESM JS）
 * @returns 求值结果（成功带导出引用，失败带原因文案；import 抛错也归一为失败）
 */
export const evaluateUserPluginModule = async (code: string): Promise<EvaluateResult> => {
  const url = URL.createObjectURL(new Blob([code], { type: USER_PLUGIN_BLOB_MIME }));
  try {
    const mod = (await import(/* @vite-ignore */ url)) as UserPluginModule;
    const exported = mod.default ?? mod.plugin;
    if (exported === undefined) {
      return {
        ok: false,
        error: '模块没有默认导出（需要 export default { … } 或 export const plugin = { … }）',
      };
    }
    return { ok: true, exported };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `插件代码执行失败：${message}` };
  } finally {
    URL.revokeObjectURL(url);
  }
};

/**
 * 从代码字符串加载插件定义（预检 → 求值 → 结构校验，不落内核）
 *
 * 一次性跑完的便捷入口（单包 / 粘贴代码场景仍用它）：静态预检拦下致命写法，
 * 再走 `evaluateUserPluginModule` 求值，最后做结构校验。需要把各步分开显示的场景
 * 请直接编排这三个函数，别在这里加开关。
 * @param code 插件代码原文（预构建 ESM JS）
 * @param occupiedIds 调用方判定「绝对不可撞」的插件 id（安装流程传空数组，见上方口径）
 * @returns 校验结果（成功带定义，失败带原因文案；import 本身抛错也归一为失败）
 */
export const importUserPluginCode = async (
  code: string,
  occupiedIds: readonly string[],
): Promise<ValidateResult> => {
  // 1. 静态预检：致命写法直接拦下，不进 Blob import
  const lint = lintUserPluginCode(code);
  if (lint.blockers.length > 0) {
    return { ok: false, error: formatLintBlockers(lint.blockers), warnings: lint.warnings };
  }

  // 2. 求值：拿到模块导出（这一步才是真正执行插件顶层代码）
  const evaluated = await evaluateUserPluginModule(code);
  if (!evaluated.ok) {
    return { ok: false, error: evaluated.error, warnings: lint.warnings };
  }

  // 3. 结构校验：形态 / 必填元信息 / id 合法性 / 占用政策
  const validated = validateUserPluginDefinition(evaluated.exported, occupiedIds);
  return validated.ok
    ? { ok: true, definition: validated.definition, warnings: lint.warnings }
    : { ok: false, error: validated.error, warnings: lint.warnings };
};

/**
 * 把一份校验通过的插件定义挂进内核（注册 + 按持久化偏好挂载）
 * @param definition 插件定义
 * @param enabled 是否启用（持久化黑名单判定结果）
 */
export const mountUserPluginDefinition = (
  definition: PluginDefinition,
  enabled: boolean,
): void => {
  pluginKernel.use(definition, { enabled, origin: PLUGIN_ORIGIN.USER });
};

/**
 * 从持久化记录反推插件定义并挂载（启动流程用）
 * @param record 用户插件记录
 * @param enabled 是否启用
 * @param occupiedIds 启动时不允许撞车的插件 id（尚未被接管的内置插件；用户接管的情况已由上层过滤）
 * @returns 加载与校验结果（成功时已完成内核注册）
 */
export const mountUserPluginRecord = async (
  record: UserPluginRecord,
  enabled: boolean,
  occupiedIds: readonly string[],
): Promise<ValidateResult> => {
  const result = await importUserPluginCode(record.code, occupiedIds);
  if (!result.ok) return result;
  mountUserPluginDefinition(result.definition, enabled);
  return result;
};

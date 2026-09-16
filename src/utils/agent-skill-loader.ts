/**
 * Skill 装载（内置常量 + 用户自装文件 → 统一的 SkillSource 列表）
 *
 * 两条来源在运行时合并成**同一套虚拟文件系统**（见 utils/agent-skill-files.ts）：
 * - 内置：`constants/builtin-skills.ts` 的常量（正文直接内嵌，无 IO）；
 * - 用户：`appData/agent-workspace/<dirName>/SKILL.md`（zip 导入时落盘，`skill-zip.ts`）。
 *
 * 为什么要读回磁盘而不是把正文存库：SKILL.md 允许带附属文件（脚本、模板、参考文档），
 * 存库只能存一份文本、且会让「编辑 SKILL.md」变成只能通过应用 UI 才能做的事；
 * 读盘则让用户可以直接改文件，与 Claude/Agent Skills 的生态习惯一致。
 *
 * ⚠️ 读盘失败（文件被删 / 权限异常）只跳过该 skill 并 console.warn，不阻断整场运行；
 * 但**内置 skill 永不缺席**——它们是子 agent 的方法论底座，缺了会静默降质。
 */
import { readTextFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { isTauri } from '@tauri-apps/api/core';
import { BUILTIN_SKILLS } from '@/constants/builtin-skills';
import { SKILL_WORKSPACE_DIR } from '@/utils/skill-zip';
import type { SkillSource } from '@/utils/agent-skill-files';
import type { Skill } from '@/types/agent.types';

/** 一条已装载的 skill（授权判定与虚拟文件装配共用的中间形态） */
export interface LoadedSkill {
  /** 名称 / 描述 / 正文（虚拟文件装配的输入） */
  source: SkillSource;
  /**
   * 授权用资源 id
   *
   * 内置为负数常量 id（builtin-skills.ts 里显式写死，勿依赖数组下标）；
   * 用户自装为 `skill.id`（正数自增）。
   */
  resourceId: number;
  /** 是否内置（内置不可删，UI 上不给编辑入口） */
  builtin: boolean;
  /** appData 内的目录名（内置为空串） */
  dirName: string;
}

/**
 * 剥掉 SKILL.md 的 YAML frontmatter，只留正文
 *
 * frontmatter 会被 `buildSkillMarkdown` 重新拼回去（由 DB 的 name/description 驱动），
 * 所以这里必须剥掉，否则同一段 frontmatter 会出现两次。
 *
 * @param text SKILL.md 全文
 * @returns 正文（无 frontmatter 时原样返回）
 */
const stripFrontmatter = (text: string): string => {
  const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(text);
  return (match ? text.slice(match[0].length) : text).trim();
};

/**
 * 内置 skill → 装载结果（纯常量，无 IO，必然成功）
 * @returns 内置 skill 列表
 */
export const loadBuiltinSkillSources = (): LoadedSkill[] =>
  BUILTIN_SKILLS.map((skill) => ({
    source: { name: skill.name, description: skill.description, body: skill.body },
    resourceId: skill.id,
    builtin: true,
    dirName: '',
  }));

/**
 * 读取单个用户 skill 的 SKILL.md 正文
 * @param dirName appData/agent-workspace 下的目录名
 * @returns 正文；文件不存在或不可读时返回 null
 */
const readUserSkillBody = async (dirName: string): Promise<string | null> => {
  try {
    const text = await readTextFile(SKILL_WORKSPACE_DIR + '/' + dirName + '/SKILL.md', {
      baseDir: BaseDirectory.AppData,
    });
    const body = stripFrontmatter(text);
    return body.length > 0 ? body : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn('[skill] 读取 ' + dirName + '/SKILL.md 失败，已跳过：' + message);
    return null;
  }
};

/**
 * 装载全部 skill（内置在前、用户在后 → 同名时用户覆盖内置）
 *
 * 用户 skill 只装 `enabled` 的（关闭的 skill 连虚拟文件都不该出现，
 * 否则子 agent 的 `skills` 路径解析得到它、等于绕过启用开关）。
 * 非 Tauri（浏览器开发态）无 appData，只给内置项。
 *
 * @param userSkills DB 里的用户 skill 列表（`listSkills()` 的结果）
 * @returns 合并后的装载列表
 */
export const loadSkillSources = async (
  userSkills: readonly Skill[],
): Promise<LoadedSkill[]> => {
  const builtin = loadBuiltinSkillSources();
  if (!isTauri()) return builtin;

  const user: LoadedSkill[] = [];
  for (const skill of userSkills) {
    if (!skill.enabled || !skill.dirName) continue;
    const body = await readUserSkillBody(skill.dirName);
    if (body === null) continue;
    user.push({
      source: {
        name: skill.name,
        description: skill.description ?? skill.name,
        body,
      },
      resourceId: skill.id,
      builtin: false,
      dirName: skill.dirName,
    });
  }
  return [...builtin, ...user];
};

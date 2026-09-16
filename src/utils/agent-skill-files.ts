/**
 * Skill → StateBackend 虚拟文件
 *
 * 背景（deepagents 的 SkillsMiddleware 实现）：
 * - 默认 backend 是 StateBackend，它从 **LangGraph state 的 `files` 字段**读文件；
 * - `skills: ['/skills/<name>/']` 这样的 sources 会被逐个 ls + 读 `SKILL.md`；
 * - 因此只要把 SKILL.md 作为**虚拟文件**塞进 `agent.stream({ messages, files })` 的入参，
 *   就能在不接触真实文件系统的前提下让 skill 生效（避开 FilesystemBackend 的 Node 依赖）。
 *
 * 实测确认（.ai/tmp/verify-skills.mjs）：
 * - `ls('/skills/')` 能从扁平的文件键合成出目录条目（`is_dir: true`）；
 * - frontmatter 的 name / description 会被解析进提示词的 skill 列表；
 * - content 用「单字符串」或「行数组」两种格式都能被正确读取。
 */
import type { VirtualFileData } from '@/agent/create-agent';

/** 虚拟技能根目录（与 deepagents 的 sources 路径约定一致，POSIX 风格） */
export const SKILL_VIRTUAL_ROOT = '/skills/';

/** skill 源（内置与用户安装合并后的统一形态） */
export interface SkillSource {
  /** skill 名（kebab-case，须与 SKILL.md frontmatter 的 name 一致） */
  name: string;
  /** 一句话描述（进提示词的 skill 列表） */
  description: string;
  /** SKILL.md 正文（不含 frontmatter） */
  body: string;
}

/**
 * 组装 SKILL.md 全文（YAML frontmatter + 正文）
 *
 * ⚠️ description 用 JSON 字符串形式输出（JSON 双引号标量是合法 YAML），
 * 避免描述里出现冒号、引号等字符时破坏 frontmatter 解析。
 *
 * @param skill skill 源
 * @returns SKILL.md 全文
 */
export const buildSkillMarkdown = (skill: SkillSource): string =>
  [
    '---',
    'name: ' + skill.name,
    'description: ' + JSON.stringify(skill.description.replace(/\s+/g, ' ').trim()),
    '---',
    '',
    skill.body.trim(),
    '',
  ].join('\n');

/** 虚拟文件集与路径映射 */
export interface SkillFileBundle {
  /** skill 名 → 虚拟目录路径（如 `/skills/technical-analysis/`） */
  pathByName: Map<string, string>;
  /** 虚拟文件（key 为完整路径，如 `/skills/technical-analysis/SKILL.md`） */
  files: Record<string, VirtualFileData>;
}

/**
 * 由 skill 列表构造虚拟文件集
 *
 * 同名 skill 后者覆盖前者（与 deepagents「later sources win」语义一致）：
 * 调用方按「内置在前、用户安装在后」的顺序传入即可让用户覆盖内置。
 *
 * @param skills skill 源列表（顺序即优先级，靠后者覆盖）
 * @returns 路径映射与虚拟文件
 */
export const buildSkillFileBundle = (skills: readonly SkillSource[]): SkillFileBundle => {
  const now = new Date().toISOString();
  const pathByName = new Map<string, string>();
  const files: Record<string, VirtualFileData> = {};
  for (const skill of skills) {
    if (!skill.name) continue;
    const dir = SKILL_VIRTUAL_ROOT + skill.name + '/';
    pathByName.set(skill.name, dir);
    files[dir + 'SKILL.md'] = {
      content: buildSkillMarkdown(skill),
      mimeType: 'text/plain',
      created_at: now,
      modified_at: now,
    };
  }
  return { pathByName, files };
};

/**
 * skill 名列表 → 虚拟目录路径列表（过滤掉没有正文的项）
 *
 * 供主 agent 的 `skills` 入参使用：只把真实存在的 skill 路径给出去，
 * 避免 sources 指向不存在的目录（会静默失败但白跑一次 ls）。
 *
 * @param names skill 名列表
 * @param pathByName 路径映射（来自 buildSkillFileBundle）
 * @returns 存在的虚拟目录路径列表
 */
export const resolveSkillPaths = (
  names: readonly string[],
  pathByName: ReadonlyMap<string, string>,
): string[] =>
  names
    .map((name) => pathByName.get(name))
    .filter((path): path is string => typeof path === 'string');

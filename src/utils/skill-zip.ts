/**
 * Skill zip 包导入（MCP Apps 同期的 Skill 分发形态：zip 内含 SKILL.md + 附属文件）
 *
 * 流程：input[type=file] 选 zip → fflate 前端解压 → 归一化路径（剥掉打包工具
 * 常见的顶层目录）→ 解析 SKILL.md frontmatter（name/description）→ 经
 * tauri-plugin-fs 写入 appData/agent-workspace/<dirName>/。
 *
 * 安全约束：
 * - 路径里不允许 `..` 与绝对路径（防 zip slip）；
 * - 目录名清洗为 [a-z0-9-_]，且必须以 SKILL.md 在根部为准（找不到则报错）。
 */
import { unzipSync, strFromU8 } from 'fflate';
import { mkdir, writeFile, BaseDirectory } from '@tauri-apps/plugin-fs';
import { isTauri } from '@tauri-apps/api/core';

/** agent-workspace 相对 appData 的路径 */
const WORKSPACE_DIR = 'agent-workspace';

/** 导入结果 */
export interface SkillZipParseResult {
  /** SKILL.md frontmatter 里的 name（缺省用目录名） */
  name: string;
  /** 建议目录名（来自 zip 文件名 / frontmatter name，已清洗、未查重） */
  dirName: string;
  /** frontmatter description（可选） */
  description: string | null;
  /** 归一化后的相对路径 → 文件内容 */
  files: Map<string, Uint8Array>;
}

/**
 * 目录名清洗：小写、空格转连字符、丢弃其余字符
 * @param raw 原始名称（zip 文件名或 frontmatter name）
 * @returns 清洗后的目录名；可能为空串
 */
const sanitizeDirName = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/\.zip$/i, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-_]/g, '')
    .slice(0, 64);

/**
 * 解析 SKILL.md frontmatter 的 name / description（宽松 YAML：只取单行键值）
 * @param text SKILL.md 全文
 * @returns 解析出的字段（无 frontmatter 时为空对象）
 */
const parseFrontmatter = (text: string): { name?: string; description?: string } => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const result: { name?: string; description?: string } = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_-]+):\s*(.*)$/.exec(line.trim());
    if (!kv) continue;
    const value = kv[2].trim().replace(/^['"]|['"]$/g, '');
    if (kv[1] === 'name') result.name = value;
    if (kv[1] === 'description') result.description = value;
  }
  return result;
};

/**
 * 解析 Skill zip（不落盘）
 * @param buffer zip 文件二进制
 * @param zipFileName zip 文件名（用于建议目录名）
 * @returns 解析结果；结构不合法抛 Error（message 可直接展示）
 */
export const parseSkillZip = (buffer: ArrayBuffer, zipFileName: string): SkillZipParseResult => {
  const entries = unzipSync(new Uint8Array(buffer));
  // 归一化路径：丢目录条目、反斜杠转正斜杠、拒绝穿越
  const cleaned = new Map<string, Uint8Array>();
  for (const [rawPath, data] of Object.entries(entries)) {
    if (rawPath.endsWith('/')) continue;
    const path = rawPath.replace(/\\/g, '/');
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error('zip 内含非法路径：' + rawPath);
    }
    cleaned.set(path, data);
  }
  if (cleaned.size === 0) throw new Error('zip 包为空');

  // 顶层目录归一化：根部没有 SKILL.md 时，若所有条目共享同一顶层目录则剥掉它
  let files = cleaned;
  if (!files.has('SKILL.md')) {
    const firstSegs = new Set([...files.keys()].map((p) => p.split('/')[0]));
    if (firstSegs.size === 1) {
      const prefix = [...firstSegs][0] + '/';
      files = new Map([...files].map(([p, d]) => [p.slice(prefix.length), d]));
    }
  }
  const skillMd = files.get('SKILL.md');
  if (!skillMd) throw new Error('zip 根目录（或唯一顶层目录下）未找到 SKILL.md');

  const frontmatter = parseFrontmatter(strFromU8(skillMd));
  const dirName =
    sanitizeDirName(frontmatter.name || '') || sanitizeDirName(zipFileName) || 'imported-skill';
  if (!dirName) throw new Error('无法确定目录名，请检查 zip 文件名或 frontmatter name');
  return {
    name: frontmatter.name || dirName,
    dirName,
    description: frontmatter.description || null,
    files,
  };
};

/**
 * 将解析结果写入 appData/agent-workspace/<dirName>/（已存在则覆盖同名文件）
 * @param parsed 解析结果
 * @returns 无
 */
export const writeSkillFiles = async (parsed: SkillZipParseResult): Promise<void> => {
  if (!isTauri()) throw new Error('Skill 导入仅支持桌面端');
  const base = WORKSPACE_DIR + '/' + parsed.dirName;
  await mkdir(base, { baseDir: BaseDirectory.AppData, recursive: true });
  for (const [path, data] of parsed.files) {
    const slash = path.lastIndexOf('/');
    if (slash > 0) {
      await mkdir(base + '/' + path.slice(0, slash), {
        baseDir: BaseDirectory.AppData,
        recursive: true,
      });
    }
    await writeFile(base + '/' + path, data, { baseDir: BaseDirectory.AppData });
  }
};

/**
 * Node `path` 模块的浏览器端 POSIX 垫片（仅 WebView/浏览器构建替换）
 *
 * 背景：`deepagents` 的浏览器入口会静态引入 `micromatch` → `picomatch`，
 * 而 picomatch 在**模块顶层**读 `path.sep`（`lib/constants.js` 的 `SEP`）与
 * `path.basename`（`matchBase` 选项）。Vite 会把裸模块 `path` 视为 node 内置
 * 并对浏览器外部化，导致控制台报
 * 「Module "path" has been externalized for browser compatibility」，
 * 且 `path.sep` 取到 undefined。
 *
 * 这里按 **POSIX 语义**实现（Agent 虚拟文件系统与 glob 匹配都是 posix 路径，
 * 与 `node-globals-shim` 里 `process.platform = 'browser'` 的判定一致）。
 * 真机文件读写走 tauri-plugin-fs，不依赖本模块。
 *
 * Vite 侧替换规则见 `vite.config.ts` 的 `resolve.alias`（正则精确匹配 `path`）。
 */

/** 路径分隔符（POSIX） */
const SEP = '/';

/**
 * 去掉末尾多余分隔符（保留根路径）
 * @param p 输入路径
 * @returns 归一化后的路径
 */
function stripTrailing(p: string): string {
  if (p.length <= 1) return p;
  let end = p.length;
  while (end > 1 && p[end - 1] === SEP) end -= 1;
  return p.slice(0, end);
}

/**
 * 逐段归一化路径（处理 `.` / `..` / 重复分隔符）
 * @param parts 路径片段
 * @param allowAboveRoot 是否允许 `..` 越过根（相对路径）
 * @returns 归一化结果
 */
function normalizeParts(parts: string[], allowAboveRoot: boolean): string {
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      const last = out[out.length - 1];
      if (last && last !== '..') {
        out.pop();
      } else if (allowAboveRoot) {
        out.push('..');
      }
      continue;
    }
    out.push(part);
  }
  return out.join(SEP);
}

/**
 * 标准化路径（不解析是否绝对，不做文件系统访问）
 * @param p 输入路径
 * @returns 标准化后的路径
 */
function normalize(p: string): string {
  if (!p) return '.';
  const isAbsolute = p.startsWith(SEP);
  const normalized = normalizeParts(p.split(SEP), !isAbsolute);
  if (isAbsolute) return SEP + normalized;
  return normalized || '.';
}

/**
 * 解析为绝对路径
 * @param parts 路径片段（从右往左拼接，遇到绝对路径即停止）
 * @returns 绝对路径
 */
function resolve(...parts: string[]): string {
  let resolved = '';
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (!part) continue;
    resolved = resolved ? `${part}${SEP}${resolved}` : part;
    if (part.startsWith(SEP)) break;
  }
  const isAbsolute = resolved.startsWith(SEP);
  const normalized = normalizeParts(resolved.split(SEP), !isAbsolute);
  return isAbsolute ? SEP + normalized : SEP + normalized;
}

/**
 * 拼接路径片段（自动补分隔符 + 标准化）
 * @param parts 路径片段
 * @returns 拼接结果
 */
function join(...parts: string[]): string {
  if (parts.length === 0) return '.';
  return normalize(parts.filter(Boolean).join(SEP));
}

/**
 * 是否为绝对路径
 * @param p 输入路径
 * @returns 是否绝对路径
 */
function isAbsolute(p: string): boolean {
  return p.startsWith(SEP);
}

/**
 * 取路径最后一段
 * @param p 输入路径
 * @param suffix 需要去掉的后缀（可空）
 * @returns 基名
 */
function basename(p: string, suffix?: string): string {
  const stripped = stripTrailing(p);
  const index = stripped.lastIndexOf(SEP);
  let base = index >= 0 ? stripped.slice(index + 1) : stripped;
  if (suffix && base !== suffix && base.endsWith(suffix)) {
    base = base.slice(0, base.length - suffix.length);
  }
  return base;
}

/**
 * 取父目录
 * @param p 输入路径
 * @returns 目录名（无父目录时返回 '.'）
 */
function dirname(p: string): string {
  if (!p) return '.';
  const stripped = stripTrailing(p);
  const index = stripped.lastIndexOf(SEP);
  if (index < 0) return '.';
  if (index === 0) return SEP;
  return stripped.slice(0, index);
}

/**
 * 取扩展名（含点）
 * @param p 输入路径
 * @returns 扩展名（无则空串）
 */
function extname(p: string): string {
  const base = basename(p);
  const index = base.lastIndexOf('.');
  if (index <= 0) return '';
  return base.slice(index);
}

/** 路径拆解结果（对应 Node `path.parse` 的返回结构） */
interface PathObject {
  /** 根（posix 下是 `/`，相对路径为空串） */
  root: string;
  /** 目录部分（无则为空串） */
  dir: string;
  /** 文件名（含扩展名） */
  base: string;
  /** 扩展名（含点，无则为空串） */
  ext: string;
  /** 文件名（不含扩展名） */
  name: string;
}

/**
 * 拆分为对象结构
 * @param p 输入路径
 * @returns 路径各组成部分
 */
function parse(p: string): PathObject {
  const root = p.startsWith(SEP) ? SEP : '';
  const dir = dirname(p) === '.' ? '' : dirname(p);
  const base = basename(p);
  const ext = extname(p);
  return { root, dir, base, ext, name: base.slice(0, base.length - ext.length) };
}

/**
 * 由 parse 的对象拼回路径
 * @param parsed 路径组成部分（可只给部分字段）
 * @returns 拼回的路径
 */
function format(parsed: Partial<PathObject>): string {
  const dir = parsed.dir ?? parsed.root ?? '';
  const base = parsed.base ?? `${parsed.name ?? ''}${parsed.ext ?? ''}`;
  if (!dir) return base;
  return dir === SEP ? `${SEP}${base}` : `${dir}${SEP}${base}`;
}

/**
 * 取相对路径（不支持跨盘符等 Windows 语义，仅 posix）
 * @param from 起始路径
 * @param to 目标路径
 * @returns 相对路径
 */
function relative(from: string, to: string): string {
  const fromParts = normalize(resolve(from)).split(SEP).filter(Boolean);
  const toParts = normalize(resolve(to)).split(SEP).filter(Boolean);
  let same = 0;
  while (same < fromParts.length && fromParts[same] === toParts[same]) same += 1;
  const up = new Array<string>(fromParts.length - same).fill('..');
  const down = toParts.slice(same);
  const result = [...up, ...down].join(SEP);
  return result;
}

/**
 * Windows 不适用：保持与 Node 行为一致的空实现
 * @param p 输入路径
 * @returns 原路径
 */
function toNamespacedPath(p: string): string {
  return p;
}

/** posix 命名空间（本垫片本身就是 posix 语义） */
const pathPosix = {
  sep: SEP,
  delimiter: ':',
  normalize,
  resolve,
  join,
  isAbsolute,
  basename,
  dirname,
  extname,
  parse,
  format,
  relative,
  toNamespacedPath,
};

export default { ...pathPosix, posix: pathPosix, win32: pathPosix };

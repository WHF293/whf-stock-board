/**
 * 插件 zip 产物包解析（第三方插件的分发形态）
 *
 * 为什么是 zip：第三方插件交给宿主的是**构建产物**，不是源码（宿主运行时没有
 * 打包器也没有编译器，见 `user-plugin-lint.ts`）。一个插件除了入口产物，还该带上
 * 「这是什么、谁做的、怎么用」，所以分发形态定为 zip 包：
 *
 * ```
 * my-plugin.zip
 * ├── manifest.json   清单：id / name / version / description / author / entry / readme
 * ├── main.js         入口产物（预构建单文件 ESM，export default { … }）
 * └── README.md       可选说明（安装弹窗里展示）
 * ```
 *
 * 解析只做「把包读成一份产物代码 + 元信息」，不落盘、不执行：入口代码随后仍走
 * `importUserPluginCode`（静态预检 → Blob import → 结构校验）这条既有链路。
 *
 * **真相只有一份**：清单是包的自我介绍，产物导出的定义才是真正跑起来的东西。
 * 因此安装前要过 `checkManifestConsistency`（id / version 必须一致），不一致就报错，
 * 避免「包说 1.2.0、产物是 1.0.0」这种静默错配。
 *
 * 刻意保持纯函数（除 fflate 外不依赖任何浏览器 / Tauri API），可被烟雾测试直跑。
 */
import { strFromU8, unzipSync } from 'fflate';
import {
  USER_PLUGIN_ENTRY_DEFAULT,
  USER_PLUGIN_MANIFEST_FILE,
  USER_PLUGIN_PACKAGE_MAX_BYTES,
  USER_PLUGIN_README_DEFAULT,
} from '../constants/plugin.constants';
import type { PluginDefinition } from '../types/plugin.types';

/** 插件包清单（manifest.json；除 id 外均可选，缺失时回退到产物导出的值） */
export interface PluginPackageManifest {
  /** 插件 id（必填，必须与产物导出的 id 一致） */
  id?: string;
  /** 展示名 */
  name?: string;
  /** 语义化版本（必填时与产物一致） */
  version?: string;
  /** 一句话说明 */
  description?: string;
  /** 作者 */
  author?: string;
  /** 入口产物路径（默认 main.js） */
  entry?: string;
  /** 说明文件路径（默认 README.md） */
  readme?: string;
}

/** 解析出的插件包 */
export interface PluginPackage {
  /** 清单内容（无 manifest.json 时为空对象） */
  manifest: PluginPackageManifest;
  /** 包内是否含 manifest.json */
  hasManifest: boolean;
  /** 入口产物的包内相对路径 */
  entryPath: string;
  /** 入口产物代码（随后交给 `importUserPluginCode`） */
  code: string;
  /** 说明文档全文（无则空串） */
  readme: string;
  /** 包内文件相对路径（归一化后，按字典序；仅供安装弹窗展示体量） */
  files: readonly string[];
}

/** 包解压后的原始条目（相对路径 → 字节） */
type RawEntries = Record<string, Uint8Array>;

/**
 * 归一化包内路径（防 zip slip + 剥打包工具留下的顶层目录 + 丢系统噪音文件）
 * @param entries fflate 解出的原始条目
 * @returns 归一化后的「相对路径 → 字节」
 */
const normalizeEntries = (entries: RawEntries): Map<string, Uint8Array> => {
  const cleaned = new Map<string, Uint8Array>();
  for (const [rawPath, data] of Object.entries(entries)) {
    if (rawPath.endsWith('/')) continue;
    const path = rawPath.replace(/\\/g, '/');
    // 绝对路径、`..`、`__MACOSX` 与点文件一律丢弃：前者是 zip slip 的入口，后者只是噪音
    if (path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error('zip 内含非法路径：' + rawPath);
    }
    if (/^__MACOSX\//i.test(path)) continue;
    if (path.split('/').some((segment) => segment.startsWith('.'))) continue;
    cleaned.set(path, data);
  }
  if (cleaned.size === 0) throw new Error('zip 包内没有可用文件');
  return cleaned;
};

/**
 * 剥掉唯一的顶层目录（`my-plugin/main.js` → `main.js`）
 *
 * 各平台打包工具都会把内容包进一层同名目录，不剥掉就找不到根目录的 manifest / 入口。
 * @param files 归一化后的条目
 * @returns 剥掉顶层目录后的条目（根目录已有 manifest 或入口时原样返回）
 */
const stripTopDir = (files: Map<string, Uint8Array>): Map<string, Uint8Array> => {
  const firstSegments = new Set([...files.keys()].map((path) => path.split('/')[0]));
  if (firstSegments.size !== 1) return files;
  const only = [...firstSegments][0];
  // 顶层就是文件（没有目录层）时不能剥
  if (!files.has(only) && [...files.keys()].every((path) => path.includes('/'))) {
    const prefix = `${only}/`;
    return new Map([...files].map(([path, data]) => [path.slice(prefix.length), data]));
  }
  return files;
};

/**
 * 定位入口产物路径
 * @param files 归一化后的条目
 * @param manifestEntry 清单里声明的 entry（可能为 undefined）
 * @returns 入口相对路径
 */
const resolveEntryPath = (files: Map<string, Uint8Array>, manifestEntry?: string): string => {
  if (typeof manifestEntry === 'string' && manifestEntry.trim().length > 0) {
    const entry = manifestEntry.trim().replace(/\\/g, '/').replace(/^\.\//, '');
    if (!files.has(entry)) {
      throw new Error(
        `manifest.json 指定的入口「${entry}」不在包内（包内文件：${[...files.keys()].join('、')}）`,
      );
    }
    return entry;
  }
  if (files.has(USER_PLUGIN_ENTRY_DEFAULT)) return USER_PLUGIN_ENTRY_DEFAULT;
  const jsFiles = [...files.keys()].filter((path) => /\.(js|mjs)$/i.test(path));
  if (jsFiles.length === 1) return jsFiles[0];
  if (jsFiles.length === 0) {
    throw new Error(
      `包内没有 .js 产物（包内文件：${[...files.keys()].join('、')}），`
      + `请在 manifest.json 里用 entry 指定入口`,
    );
  }
  throw new Error(
    `包内有多个 js 文件（${jsFiles.join('、')}），请在 manifest.json 里用 entry 指定入口`,
  );
};

/**
 * 取说明文档全文（大小写不敏感匹配，缺失不算错）
 * @param files 归一化后的条目
 * @param manifestReadme 清单里声明的 readme 路径
 * @returns 文档全文（无则空串）
 */
const resolveReadme = (files: Map<string, Uint8Array>, manifestReadme?: string): string => {
  const candidates = [manifestReadme, USER_PLUGIN_README_DEFAULT].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  for (const candidate of candidates) {
    const hit = [...files.keys()].find(
      (path) => path.toLowerCase() === candidate.replace(/\\/g, '/').toLowerCase(),
    );
    if (hit) return strFromU8(files.get(hit) as Uint8Array);
  }
  return '';
};

/**
 * 解析一个插件 zip 产物包（不落盘、不执行）
 * @param buffer zip 文件二进制
 * @returns 解析结果；包结构不合法时抛 Error（message 可直接展示给用户）
 */
export const parsePluginPackage = (buffer: ArrayBuffer): PluginPackage => {
  if (buffer.byteLength > USER_PLUGIN_PACKAGE_MAX_BYTES) {
    throw new Error('zip 包体积超出上限（8MB）');
  }
  let entries: RawEntries;
  try {
    entries = unzipSync(new Uint8Array(buffer));
  } catch (error) {
    throw new Error('无法解压：不是合法的 zip 包或文件已损坏', { cause: error });
  }

  const files = stripTopDir(normalizeEntries(entries));

  const manifestRaw = files.get(USER_PLUGIN_MANIFEST_FILE);
  let manifest: PluginPackageManifest = {};
  if (manifestRaw) {
    try {
      const parsed: unknown = JSON.parse(strFromU8(manifestRaw));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        throw new Error('不是一个对象');
      }
      manifest = parsed as PluginPackageManifest;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${USER_PLUGIN_MANIFEST_FILE} 解析失败：${reason}`, { cause: error });
    }
    if (typeof manifest.id !== 'string' || manifest.id.length === 0) {
      throw new Error(`${USER_PLUGIN_MANIFEST_FILE} 缺少插件 id（字符串）`);
    }
  }

  const entryPath = resolveEntryPath(files, manifest.entry);
  const code = strFromU8(files.get(entryPath) as Uint8Array);
  if (code.trim().length === 0) throw new Error(`入口产物「${entryPath}」是空文件`);

  return {
    manifest,
    hasManifest: manifestRaw !== undefined,
    entryPath,
    code,
    readme: resolveReadme(files, manifest.readme),
    files: [...files.keys()].sort(),
  };
};

/**
 * 校验「包清单」与「产物导出的定义」是否对得上
 *
 * 只强制 id 与 version 一致：这两个是安装的键与升级的依据，对不上说明作者改了代码
 * 却忘了同步清单（或反之），静默取一边都会埋雷。其余文案类字段以产物为准，
 * 不做阻断——它们不影响运行。
 * @param manifest 包清单
 * @param definition 产物导出的插件定义
 * @returns 不一致时返回面向用户的错误文案；一致返回 null
 */
export const checkManifestConsistency = (
  manifest: PluginPackageManifest,
  definition: PluginDefinition,
): string | null => {
  if (manifest.id !== undefined && manifest.id !== definition.id) {
    return `清单 id 与产物不一致：manifest.json 写的是 ${manifest.id}，产物导出的是 ${definition.id}`;
  }
  if (typeof manifest.version === 'string' && manifest.version.length > 0
    && manifest.version !== definition.version) {
    return `清单版本与产物不一致：manifest.json 写的是 ${manifest.version}，产物导出的是 ${definition.version}`;
  }
  return null;
};

/**
 * 官方插件打包流水线：源码 → 单文件 ESM 产物 → zip 产物包
 *
 * 用法：
 * ```bash
 * node scripts/build-plugins.mjs              # 打全部
 * node scripts/build-plugins.mjs dsh-mainline # 只打一个
 * ```
 *
 * 三条硬约束（来自安装链路，见 `src/plugin/user-plugin-lint.ts`）：
 * 1. 产物里**不能有任何 import** —— 第三方插件是运行时 Blob 动态 import 的，
 *    没有模块解析能力，写 import 必然装不上；
 * 2. 不能有 `template:` 模板字符串 —— 生产构建不含运行时模板编译器；
 * 3. 单文件（manifest + 入口须同归一层次暂不需要 flatten）。
 *
 * 于是 `.vue` 文件由 vite 的官方插件**编译成 render 函数**（约束 2 天然满足），
 * 而它产出的 `import { … } from 'vue'`（含 `_hoisted_*` 顶层节点需要的内部 API）
 * 由本脚本改写成「从宿主运行时桥取值」（约束 1），桥由宿主在 `installPlugins`
 * 里挂到 `globalThis.__WHF_PLUGIN_RUNTIME__` —— 插件产物与宿主因此共用
 * **同一个 Vue 实例**。
 */
import * as vueRuntime from 'vue';
import { build } from 'vite';
import vue from '@vitejs/plugin-vue';
import { strToU8, zipSync } from 'fflate';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CLASS_ALLOWLIST_RELATIVE,
  collectArtifactClasses,
  readExistingAllowlist,
  readHostCssClassProbe,
  writeClassAllowlist,
} from './lib/plugin-classes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_PLUGINS = path.join(ROOT, 'src', 'plugins');
const PACKAGE_SRC = path.join(ROOT, 'plugins-src');
const DIST = path.join(ROOT, 'plugins-dist');
const TMP = path.join(DIST, '.tmp');

/**
 * 构建目标表
 *
 * `dir` 必须是**当前仍在源码里**的插件目录（`src/plugins/<dir>/`）—— 那里的源文件才是打包输入。
 *
 * ⚠️ 已经「源码级卸载」的插件（源码不在 `src/plugins/` 下）**不要出现在表里**，
 * 也不要把「备份目录」或任何临时路径当长期构建源 —— 那等于源码没真卸载，只是挪了个地方继续编译。
 * 它们的产物就是 `plugins-dist/<id>-<version>.zip`（已在 `.gitignore` 里，不入库）。
 *
 * 要给这类插件重新出包，走**临时**流程：① 按 AGENTS.md 的备份 / git 把源码恢复到 `src/plugins/<dir>/`
 * 并登记回 `BUILTIN_PLUGINS`；② 临时在这里加一条 `{ id, dir, entry }`；③ 跑本脚本；
 * ④ **把这条目标删掉**（恢复成「源码已不在」的状态）。
 */
const TARGETS = [];

/** 运行时桥的全局键（与 src/constants/plugin.constants.ts 保持一致） */
const RUNTIME_BRIDGE_KEY = '__WHF_PLUGIN_RUNTIME__';

/** vite/rollup 产出的 vue 具名导入（`import { a, b as c } from 'vue';`） */
const VUE_IMPORT = /^import\s*\{([^}]*)\}\s*from\s*["']vue["'];?[ \t]*$/gm;

/** 任何残留 import（产物的红线：一个都不能有） */
const ANY_IMPORT = /^\s*import\s+(?:[^'"\n]*?\bfrom\s+)?['"]([^'"]+)['"]/gm;

/**
 * 具名导入列表转成解构列表（`ref, computed as c` → `ref, computed: c`）
 * @param names import 花括号内的原文
 * @returns 解构模式文本
 */
const toDestructuring = (names) =>
  names
    .split(',')
    .map((raw) => raw.trim())
    .filter((raw) => raw.length > 0)
    .map((raw) => {
      const matched = /^(\S+)\s+as\s+(\S+)$/.exec(raw);
      return matched ? `${matched[1]}: ${matched[2]}` : raw;
    })
    .join(', ');

/**
 * 把产物里的 vue import 换成「运行时桥取值」，并加上缺失桥时的明确报错
 * @param code 原始产物
 * @returns 改写后的产物
 */
const bridgeVueImports = (code) => {
  let bridged = 0;
  const out = code.replace(VUE_IMPORT, (_full, names) => {
    bridged += 1;
    return `const { ${toDestructuring(names)} } = ${RUNTIME_BRIDGE_KEY}.vue;`;
  });
  if (bridged === 0) {
    throw new Error('产物里没有 vue 导入：入口是否真的用到了 Vue？（SFC 编译后必然有一条）');
  }
  const guard = [
    `const ${RUNTIME_BRIDGE_KEY} = globalThis.${RUNTIME_BRIDGE_KEY};`,
    `if (!${RUNTIME_BRIDGE_KEY}?.vue) {`,
    `  throw new Error('宿主运行时桥不可用：${RUNTIME_BRIDGE_KEY}（插件必须在该版本宿主里安装）');`,
    `}`,
    '',
  ].join('\n');
  return `${guard}${out}`;
};

/**
 * 断言产物干净（没有任何残留 import）
 * @param code 产物源码
 * @param id 插件 id（报错用）
 */
const assertNoImports = (code, id) => {
  ANY_IMPORT.lastIndex = 0;
  const leftovers = [...code.matchAll(ANY_IMPORT)].map((match) => match[1]);
  if (leftovers.length > 0) {
    throw new Error(
      `插件 ${id} 的产物里仍有 ${leftovers.length} 条 import（${leftovers.join(', ')}）：`
      + '宿主加载器无法解析任何裸模块，请把依赖打进产物或改从 ctx 上取',
    );
  }
};

/**
 * 把一个插件源码目录打成单文件产物
 * @param target 构建目标
 * @returns 产物文件内容
 */
const buildArtifact = async (target) => {
  const outDir = path.join(TMP, target.id);
  await build({
    root: path.join(SRC_PLUGINS, target.dir),
    configFile: false,
    logLevel: 'warn',
    plugins: [vue()],
    build: {
      outDir,
      emptyOutDir: true,
      minify: false,
      target: 'es2020',
      cssCodeSplit: false,
      lib: {
        entry: path.join(SRC_PLUGINS, target.dir, target.entry),
        formats: ['es'],
        fileName: () => 'main.js',
      },
      rollupOptions: {
        // vue **必须外部化**：一旦被打进产物就是「第二份 Vue 实例」，
        // 插件里的 ref 与宿主的组件树互不相认（响应式与渲染全崩）。
        // 这里保留 `import … from 'vue'`，随后由 bridgeVueImports 改写成
        // 从宿主运行时桥取值 —— 二者共用同一实例。
        external: ['vue'],
      },
    },
  });
  return fs.readFileSync(path.join(outDir, 'main.js'), 'utf8');
};

/**
 * 「跑一遍产物」做发布前校验：真实 import 它（注入运行时桥），比对清单与导出定义
 * @param id 插件 id
 * @param code 产物源码
 * @param manifest 清单内容
 */
const validateArtifact = async (id, code, manifest) => {
  const file = path.join(TMP, id, 'bridged.mjs');
  fs.writeFileSync(file, code, 'utf8');
  (globalThis)[RUNTIME_BRIDGE_KEY] = { vue: vueRuntime };

  const mod = await import(pathToFileURL(file).href);
  const definition = mod.default ?? mod.plugin;
  if (!definition || typeof definition !== 'object') {
    throw new Error(`插件 ${id} 的产物没有导出插件定义（需要 export default { … }）`);
  }
  if (typeof definition.apply !== 'function') {
    throw new Error(`插件 ${id} 的导出缺少 apply 函数`);
  }
  for (const field of ['id', 'name', 'version']) {
    if (definition[field] !== manifest[field]) {
      throw new Error(
        `插件 ${id} 的 ${field} 不一致：清单写着「${manifest[field]}」，产物导出「${definition[field]}」`,
      );
    }
  }
  return definition;
};

/**
 * 打包一个插件
 * @param target 构建目标
 */
const packTarget = async (target) => {
  const { id } = target;
  const packageDir = path.join(PACKAGE_SRC, id);
  const manifestFile = path.join(packageDir, 'manifest.json');
  if (!fs.existsSync(manifestFile)) {
    throw new Error(`缺少清单文件：${path.relative(ROOT, manifestFile)}`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (manifest.id !== id) throw new Error(`清单 id（${manifest.id}）与目录名（${id}）不一致`);

  process.stdout.write(`▸ ${id}：正在编译 …\n`);
  const raw = await buildArtifact(target);
  const bridged = bridgeVueImports(raw);
  assertNoImports(bridged, id);

  const definition = await validateArtifact(id, bridged, manifest);

  const files = { 'manifest.json': strToU8(JSON.stringify(manifest, null, 2)) };
  files[manifest.entry ?? 'main.js'] = strToU8(bridged);
  const readmeFile = path.join(packageDir, manifest.readme ?? 'README.md');
  if (fs.existsSync(readmeFile)) {
    files[manifest.readme ?? 'README.md'] = strToU8(fs.readFileSync(readmeFile, 'utf8'));
  }

  const zipped = zipSync(files, { level: 9 });
  const outFile = path.join(DIST, `${id}-${manifest.version}.zip`);
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(outFile, zipped);

  const kb = (zipped.byteLength / 1024).toFixed(1);
  process.stdout.write(
    `✓ ${id} v${manifest.version}：${Object.keys(files).join(' + ')} → `
    + `${path.relative(ROOT, outFile)}（${kb} KB，未压缩 ${(bridged.length / 1024).toFixed(1)} KB）\n`
    + `  导出校验：id=${definition.id} name=${definition.name} apply=${typeof definition.apply}\n`,
  );

  // 把产物用到的 Tailwind 类写进白名单 —— 插件源码不在 src/ 下，Tailwind 扫不到它们，
  // 少了这一步就只能祈祷宿主别处也碰巧用了同一个类（见 scripts/lib/plugin-classes.mjs）。
  const isKnownClass = readHostCssClassProbe(ROOT);
  const allowlist = new Set([...readExistingAllowlist(ROOT), ...collectArtifactClasses(bridged, isKnownClass)]);
  writeClassAllowlist(ROOT, allowlist);
  process.stdout.write(`  样式白名单：${allowlist.size} 个类 → ${CLASS_ALLOWLIST_RELATIVE}\n`);

  return { id, outFile, bytes: zipped.byteLength, rawBytes: bridged.length };
};

/**
 * 主流程
 */
const main = async () => {
  const only = process.argv.slice(2);
  if (TARGETS.length === 0) {
    // 当前没有「源码仍在库里」的打包目标：所有官方插件都已走源码级卸载、改由 zip 产物包分发。
    // 这是常态而不是错误 —— 出包走「临时恢复源码 → 临时加目标 → 打包 → 删掉目标」（见 TARGETS 注释）。
    process.stdout.write('当前没有可打包的目标：TARGETS 为空（源码里已无待出包的官方插件）。\n');
    return;
  }
  const targets = only.length > 0
    ? TARGETS.filter((target) => only.includes(target.id))
    : TARGETS;
  if (targets.length === 0) {
    throw new Error(`没有匹配的构建目标：${only.join(', ')}（可选：${TARGETS.map((t) => t.id).join(', ')}）`);
  }

  try {
    fs.rmSync(TMP, { recursive: true, force: true });
    fs.mkdirSync(TMP, { recursive: true });
  } catch {
    // 临时目录清理失败无害：产物按固定清单覆盖写
  }

  const results = [];
  for (const target of targets) {
    results.push(await packTarget(target));
  }
  process.stdout.write(`\n共 ${results.length} 个插件包已就绪，输出目录：${path.relative(ROOT, DIST)}\n`);
};

await main();

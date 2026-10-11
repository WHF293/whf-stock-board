/**
 * 对 release 构建产物（未签名 APK）做 zipalign + apksigner 签名。
 *
 * 用法：pnpm build:apk && pnpm sign:apk
 * 产物：dist-apk/whf-stock-board-v<version>-signed.apk
 *
 * 密钥库与密码（本机自用，不入库）：
 *   keystore: ~/.android/whf-stock-board.keystore
 *   password: ~/.android/whf-stock-board.keystore.pass
 * 工具链路径（按本机环境探测，可在环境变量覆盖）：
 *   JAVA_HOME 默认探测 D:/Application/Android Studio/Android Studio/jbr
 *   ANDROID_HOME 默认 %LOCALAPPDATA%/Android/Sdk
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

const ROOT = process.cwd();

/** 按本机环境探测工具路径，找不到直接报错退出。 */
function resolveTools() {
  const javaHome = process.env.JAVA_HOME ?? 'D:/Application/Android Studio/Android Studio/jbr';
  const androidHome =
    process.env.ANDROID_HOME ?? join(process.env.LOCALAPPDATA ?? '', 'Android', 'Sdk');
  const keytool = join(javaHome, 'bin', 'keytool.exe');
  const btDir = join(androidHome, 'build-tools');
  if (!existsSync(keytool)) throw new Error(`找不到 keytool: ${keytool}`);
  if (!existsSync(btDir)) throw new Error(`找不到 build-tools: ${btDir}`);
  // 取 build-tools 下版本号最大的目录
  const latest = readdirSync(btDir)
    .filter((n) => /^\d[\d.]*$/.test(n))
    .sort((a, b) => Number(b.split('.').join('')) - Number(a.split('.').join('')))[0];
  const bt = join(btDir, latest);
  const zipalign = join(bt, 'zipalign.exe');
  const java = join(javaHome, 'bin', 'java.exe');
  const apksignerJar = join(bt, 'lib', 'apksigner.jar');
  for (const t of [zipalign, java, apksignerJar]) {
    if (!existsSync(t)) throw new Error(`找不到工具: ${t}`);
  }
  return { keytool, zipalign, java, apksignerJar };
}

/** 校验密钥库与密码文件存在，返回 { keystore, pass }。 */
function resolveKeystore() {
  const keystore = join(homedir(), '.android', 'whf-stock-board.keystore');
  const passFile = join(homedir(), '.android', 'whf-stock-board.keystore.pass');
  if (!existsSync(keystore)) throw new Error(`找不到密钥库: ${keystore}`);
  if (!existsSync(passFile)) throw new Error(`找不到密码文件: ${passFile}`);
  return { keystore, pass: readFileSync(passFile, 'utf8').trim() };
}

/** 在 release 输出目录里找最新的 unsigned APK。 */
function findUnsignedApk() {
  const dir = join(ROOT, 'src-tauri', 'gen', 'android', 'app', 'build', 'outputs', 'apk');
  if (!existsSync(dir)) throw new Error(`找不到 APK 输出目录: ${dir}`);
  const candidates = [];
  for (const flavor of readdirSync(dir)) {
    const flavorDir = join(dir, flavor, 'release');
    if (!existsSync(flavorDir)) continue;
    for (const f of readdirSync(flavorDir)) {
      if (f.endsWith('.apk') && !f.endsWith('-aligned.apk')) {
        candidates.push(join(flavorDir, f));
      }
    }
  }
  if (candidates.length === 0) throw new Error('release 目录下没有 APK，请先跑 pnpm build:apk');
  // 按 mtime 取最新
  candidates.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return candidates[0];
}

/** 主流程：校验签名 → zipalign → apksigner → 输出到 dist-apk/。 */
function main() {
  const tools = resolveTools();
  const { keystore, pass } = resolveKeystore();
  const unsigned = findUnsignedApk();
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  const outDir = join(ROOT, 'dist-apk');
  mkdirSync(outDir, { recursive: true });
  const aligned = unsigned.replace(/\.apk$/, '-aligned.apk');
  const out = join(outDir, `whf-stock-board-v${pkg.version}-signed.apk`);

  console.log(`[1/3] zipalign: ${basename(unsigned)}`);
  execFileSync(tools.zipalign, ['-f', '-p', '4', unsigned, aligned], { stdio: 'inherit' });

  console.log('[2/3] apksigner sign');
  execFileSync(
    tools.java,
    [
      '-jar',
      tools.apksignerJar,
      'sign',
      '--ks',
      keystore,
      '--ks-key-alias',
      'whf',
      '--ks-pass',
      `pass:${pass}`,
      '--out',
      out,
      aligned,
    ],
    { stdio: 'inherit' },
  );

  console.log('[3/3] verify');
  execFileSync(tools.java, ['-jar', tools.apksignerJar, 'verify', '--print-certs', out], {
    stdio: 'inherit',
  });
  console.log(`\n签名完成: ${out}`);
}

main();

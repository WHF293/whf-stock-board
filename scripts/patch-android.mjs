#!/usr/bin/env node
/**
 * Android 原生壳幂等补丁：小米 HyperOS 自由窗口适配（2026-10-28，方案见
 * .ai/开发方案/2026-10-28-移动端-小米自由窗口与平行视界适配开发方案.md）
 *
 * 背景：src-tauri/gen/android 已 gitignore，CI（release.yml 安卓 job）与本地
 * `tauri android init` 都会重新生成原生工程，手改会丢。本脚本把两项改动固化为
 * 幂等重放，接线点：
 *   - 本地：package.json 的 build:apk / build:apk:debug 前置执行
 *   - CI：release.yml 安卓 job 在 tauri android init 之后、build 之前执行
 *
 * 改动内容：
 *   1. AndroidManifest.xml —— application 补 multi-resume meta-data
 *      （android.allow_multiple_resumed_activities，小米窗口文档 §7：多窗口内
 *      可见 Activity 保持 Resumed，失焦不触发 onPause）；activity 补
 *      resizeableActivity 显式声明（§2 兜底；尺寸变化回调由模板自带的
 *      全量 configChanges 承担，resize 时 Activity 不重建）。
 *   2. MainActivity.kt —— 生命周期重排（整文件覆盖；该文件本就是用户所有）：
 *      多窗口内失焦（paused 但仍可见）跳过 WebView.onPause 保住 JS 定时器
 *      （轮询不停摆，Stop Playback 适配 §6/§7），真不可见 onStop 才暂停、
 *      onStart 成对恢复（后台省电红线不破坏）。
 *   3. MainActivity.kt —— 系统栏 inset 注入（平板 edge-to-edge 遮挡修复，2026-10-28）：
 *      enableEdgeToEdge 后 WebView 全屏绘制到状态栏底下，而 Android WebView 的
 *      env(safe-area-inset-*) 恒为 0，CSS 让位全部失效（平板横屏下状态栏压住
 *      navbar）。OnApplyWindowInsetsListener 量出 systemBars 后经 evaluateJavascript
 *      写入页面 CSS 变量 --m-inset-top / --m-inset-bottom（mobile.css 消费）。
 *      WebView 创建早于 DOM 就绪，evaluateJavascript 在无页面时静默丢弃，
 *      故 600ms / 2s 两次延迟幂等重放；旋转等 insets 变化会重新触发监听器。
 *
 * 幂等性：MainActivity 整文件覆盖（内容恒定）；manifest 按字符串检测缺失才插入，
 * 重复执行无副作用。重 init / 换机后直接重跑即可。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const genAndroid = join(repoRoot, 'src-tauri', 'gen', 'android');

if (!existsSync(genAndroid)) {
  console.error(
    '[patch-android] src-tauri/gen/android 不存在。请先执行 `pnpm tauri android init` 生成原生工程后再跑本补丁。',
  );
  process.exit(1);
}

/** identifier 从 tauri.conf.json 读取（cn.whf.stockboard → java/cn/whf/stockboard） */
const { identifier } = JSON.parse(
  readFileSync(join(repoRoot, 'src-tauri', 'tauri.conf.json'), 'utf8'),
);
const activityDir = join(genAndroid, 'app', 'src', 'main', 'java', ...identifier.split('.'));
const mainActivityPath = join(activityDir, 'MainActivity.kt');
const manifestPath = join(genAndroid, 'app', 'src', 'main', 'AndroidManifest.xml');

// ---------- 1. AndroidManifest.xml：multi-resume + resizeableActivity（缺失才插入） ----------
const MULTI_RESUME_META =
  '        <meta-data android:name="android.allow_multiple_resumed_activities" android:value="true" />';
const RESIZE_ATTRS = '            android:resizeableActivity="true"';

let manifest = readFileSync(manifestPath, 'utf8');
let manifestPatched = false;

if (!manifest.includes('android.allow_multiple_resumed_activities')) {
  const appTagStart = manifest.indexOf('<application');
  if (appTagStart < 0) throw new Error('[patch-android] manifest 中找不到 <application> 标签');
  const appTagEnd = manifest.indexOf('>', appTagStart);
  manifest =
    manifest.slice(0, appTagEnd + 1) + '\n' + MULTI_RESUME_META + manifest.slice(appTagEnd + 1);
  manifestPatched = true;
}
if (!manifest.includes('android:resizeableActivity')) {
  // activity 标签内 configChanges 行前插入两个属性（Tauri 模板该行唯一）
  const anchor = manifest.indexOf('android:configChanges=');
  if (anchor < 0) throw new Error('[patch-android] manifest 中找不到 activity 的 configChanges 行');
  const lineStart = manifest.lastIndexOf('\n', anchor) + 1;
  manifest = manifest.slice(0, lineStart) + RESIZE_ATTRS + '\n' + manifest.slice(lineStart);
  manifestPatched = true;
}
if (manifestPatched) {
  writeFileSync(manifestPath, manifest, 'utf8');
  console.log('[patch-android] AndroidManifest.xml 已补 multi-resume / resizeable 属性');
} else {
  console.log('[patch-android] AndroidManifest.xml 已是目标状态，跳过');
}

// ---------- 2. MainActivity.kt：生命周期重排（整文件覆盖，幂等） ----------
// wry 0.55.1 实测链路（WryActivity.kt / TauriActivity.kt，gen/android 生成物）：
//   - WebView.onPause 只在 WryActivity.onPause() 一处（super 链）→ 多窗口失焦跳过它即保住 JS 定时器；
//   - Rust.* / PluginManager.onPause() 均由 ProcessLifecycleOwner（进程级观察器）驱动，
//     不随 Activity 失焦触发，无需（也不能）在 onPause 里手动分发
const MAIN_ACTIVITY_KT = `package ${identifier}

import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.WindowInsets
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

class MainActivity : TauriActivity() {
  private var wv: WebView? = null
  private var insetTop = 0
  private var insetBottom = 0
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    // 系统栏 inset 注入（平板 edge-to-edge 遮挡修复）：Android WebView 的
    // env(safe-area-inset-*) 恒为 0，把 systemBars 高度写进页面 CSS 变量
    // --m-inset-top / --m-inset-bottom（mobile.css 消费，:root 内联值覆盖 env 回退）
    window.decorView.setOnApplyWindowInsetsListener { v, insets ->
      val sys = insets.getInsets(WindowInsets.Type.systemBars())
      insetTop = sys.top
      insetBottom = sys.bottom
      scheduleInsetApply()
      v.onApplyWindowInsets(insets)
    }
  }

  // WebView 创建早于 DOM 就绪，evaluateJavascript 在无页面时静默丢弃，
  // 两次延迟幂等重放兜底；重复 setProperty 无副作用，旋转后随 insets 变化重触发
  private fun scheduleInsetApply() {
    mainHandler.postDelayed({ applyInsets() }, 600L)
    mainHandler.postDelayed({ applyInsets() }, 2000L)
  }

  private fun applyInsets() {
    val webView = wv ?: return
    // 注意：本文件是 Node 脚本的 JS 模板字符串，Kotlin 里禁用反引号与 \\${'$'}{...} 插值
    val js = "document.documentElement.style.setProperty('--m-inset-top','" + insetTop +
      "px');document.documentElement.style.setProperty('--m-inset-bottom','" + insetBottom + "px');"
    webView.evaluateJavascript(js, null)
  }

  // WryActivity 的 open 钩子：持有 WebView 引用（wry 的 mWebView 为 private lateinit）
  override fun onWebViewCreate(webView: WebView) {
    wv = webView
    scheduleInsetApply()
  }

  // 小米自由窗口适配（Stop Playback，窗口文档 §6/§7）：
  // 多窗口内失焦（paused 但仍可见）不暂停 WebView → 小窗挂机行情轮询不断；
  // 非多窗口（真后台）走原 super 链照常暂停
  override fun onPause() {
    if (isInMultiWindowMode) {
      return
    }
    super.onPause()
  }

  // 多窗口内被整体划走 / 关闭 / Home 键 → 真不可见才暂停（后台省电红线不破坏）
  override fun onStop() {
    super.onStop()
    wv?.onPause()
  }

  override fun onStart() {
    super.onStart()
    wv?.onResume()
  }
}
`;

writeFileSync(mainActivityPath, MAIN_ACTIVITY_KT, 'utf8');
console.log(`[patch-android] MainActivity.kt 已写入（${identifier}）`);
console.log('[patch-android] 补丁完成');

/**
 * WebView 缺失的 Node 全局垫片（必须在应用入口首行导入）
 *
 * 背景：`deepagents` 的依赖链里 `micromatch` → `picomatch` 会在**模块顶层**
 * 读取 `process.platform`（`picomatch/lib/utils.js` 第 4 行）：
 *
 * ```js
 * const win32 = process.platform === 'win32';
 * ```
 *
 * 而 Tauri WebView / 浏览器没有 Node 的 `process` 全局，模块求值阶段即抛
 * `ReferenceError: process is not defined`；由于 Agent 相关模块被路由静态导入，
 * 整条导入链失败会让**整个应用白屏**（不是只有 Agent 分析页）。
 *
 * 这里只补最小可用的 `process` / `global`，语义按「非 Windows 浏览器」处理：
 * picomatch 的 win32 判定因此为 false，正好符合 Agent 虚拟文件系统的 posix 语义。
 *
 * ⚠️ 本模块不可导入任何业务模块（否则垫片会晚于依赖求值，失去意义）。
 */

/** 全局对象（允许挂载 Node 兼容字段） */
const scope = globalThis as unknown as Record<string, unknown>;

/**
 * 空实现（用于兼容 process 上的监听/告警类方法）
 * @returns 无返回值
 */
const noop = (): void => undefined;

if (typeof scope.process === 'undefined') {
  scope.process = {
    /** 只读环境变量占位，避免库读取 process.env.X 时抛错 */
    env: { NODE_ENV: import.meta.env.MODE },
    /** picomatch 等库的 Windows 判定：浏览器一律按 posix 处理 */
    platform: 'browser',
    browser: true,
    version: '',
    versions: {},
    /**
     * 极少数库用 cwd() 拼相对路径；WebView 无工作目录，给根路径占位
     * @returns 固定根路径
     */
    cwd: (): string => '/',
    /**
     * 兼容 process.nextTick(fn)
     * @param fn 回调
     * @returns 无返回值
     */
    nextTick: (fn: () => void): void => {
      void Promise.resolve().then(fn);
    },
    /** 兼容 process.emitWarning / on / once / off / removeListener 等空调用 */
    emitWarning: noop,
    on: noop,
    once: noop,
    off: noop,
    removeListener: noop,
  };
}

if (typeof scope.global === 'undefined') {
  scope.global = globalThis;
}

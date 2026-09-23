/**
 * 应用自动更新（GitHub Releases）常量
 *
 * 链路：启动延迟检测 latest release → 发现有新版（titlebar 徽标）→ 点击流式下载
 * NSIS 安装包到 $APPDATA/updates/ → 下载完变「立即更新」→ 点击后 Rust 侧以
 * /S（静默）+ /R（装完自动重启）启动安装包并退出当前应用。
 *
 * 网络口径（用户指定）：检测请求失败 / 无网 / 限流 一律静默按「无新版本」处理，
 * 不弹任何报错；仅设置页手动检查时在按钮文案上给轻提示。
 */

/** GitHub Releases 最新版 API（复用 app-info.constants 的仓库地址口径） */
export const UPDATE_LATEST_API =
  'https://api.github.com/repos/WHF293/whf-stock-board/releases/latest';

/** GitHub Accept 头（REST 惯例，稳定返回 JSON） */
export const UPDATE_API_ACCEPT = 'application/vnd.github+json';

/** 可执行安装包资产名后缀（NSIS 安装包，与 CI release.yml 提示口径一致） */
export const UPDATE_ASSET_SUFFIX = '_x64-setup.exe';

/** 检测请求超时（毫秒） */
export const UPDATE_CHECK_TIMEOUT_MS = 10_000;

/** 下载请求整体超时（毫秒）：安装包约 20MB，给足 15 分钟（弱网兜底） */
export const UPDATE_DOWNLOAD_TIMEOUT_MS = 15 * 60 * 1000;

/** 下载写盘分块阈值（字节）：累计到此值才落一次盘，减少 IPC 次数 */
export const UPDATE_WRITE_CHUNK_BYTES = 1024 * 1024;

/** 进度回调节流间隔（毫秒）：避免 ref 高频更新触发过度渲染 */
export const UPDATE_PROGRESS_THROTTLE_MS = 200;

/** 安装包存放目录名（appDataDir 之下，capabilities fs:scope 已放行） */
export const UPDATE_DIR_NAME = 'updates';

/** 启动自动检测延迟（毫秒）：避开启动高峰（行情轮询 / DB 水合 / 插件挂载） */
export const UPDATE_AUTO_CHECK_DELAY_MS = 6_000;

/** 下载进度精确到整数百分比即可 */
export const UPDATE_PROGRESS_PRECISION = 100;

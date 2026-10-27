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

/** GitHub Releases 最新版 API（兜底通道：匿名请求按出口 IP 限流 60 次/时，易 403） */
export const UPDATE_LATEST_API =
  'https://api.github.com/repos/WHF293/whf-stock-board/releases/latest';

/**
 * GitHub Releases 最新版网页地址（检测主通道，2026-10-27 实测切换）：
 * `/releases/latest` 302 → `/tag/vX.Y.Z`，跟随重定向后从 response.url 解析版本号。
 * 不走 api.github.com 的按 IP 匿名配额（王总网络出口 IP 配额常态耗尽，直连与
 * 走代理都 403，是「更新一直失败」的根因），且直连可用、无需代理。
 */
export const UPDATE_RELEASE_PAGE_URL =
  'https://github.com/WHF293/whf-stock-board/releases/latest';

/**
 * NSIS 安装包下载地址模板（`{version}` 替换为版本号，如 4.21.0）
 *
 * 与 CI release 产物命名规则一致：productName_version_x64-setup.exe
 * （tauri.conf.json productName=stock-board）。改 productName / 发版产物命名时同步此模板
 */
export const UPDATE_ASSET_URL_TEMPLATE =
  'https://github.com/WHF293/whf-stock-board/releases/download/v{version}/stock-board_{version}_x64-setup.exe';

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

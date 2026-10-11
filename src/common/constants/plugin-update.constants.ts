/**
 * 插件在线更新常量（URL / 超时 / 冷却 / 全部用户可见文案）
 *
 * 集中的理由与 `plugin.constants.ts` 一样：更新链路跨「提示条 + 列表项 + 确认弹窗 +
 * 浮窗」四处渲染，文案散在各处必然写得不一样（「检查更新」vs「检查新版本」）。
 *
 * 与插件**安装**相关的常量仍放 `plugin.constants.ts`（那是既有链路），
 * 本文件只管「在线更新」这一层。
 */

/** 官方插件仓库（`owner/repo`；拼直链、拼发布页都用它） */
export const PLUGIN_UPDATE_REPO = 'jx62257070/tauri-plugin';

/**
 * 更新清单地址（固定 URL，一次请求拿到全部插件的最新版本与直链）
 *
 * 走 GitHub Release 资产 CDN：免鉴权、无限流（对比 Releases API 的 60 次/小时）。
 * ⚠️ `/releases/latest/` 只指向**已发布、非 draft、非 prerelease** 的最新 Release，
 * 官方插件 Release 一律正式发布（release.yml 不加 `--prerelease`、不留草稿）。
 */
export const PLUGIN_UPDATE_INDEX_URL =
  `https://github.com/${PLUGIN_UPDATE_REPO}/releases/latest/download/index.json`;

/**
 * 降级路径：主 URL 失败时用它取 `tag_name`，再拼固定 tag 直链拉同一份清单
 *
 * `api.github.com` 未鉴权 60 次/小时，所以**只在主 URL 失败时**触发
 * （应对风险 R1：`tauri-plugin-http` 不跟随 `latest/download` 的两次 302）。
 */
export const PLUGIN_UPDATE_RELEASES_API =
  `https://api.github.com/repos/${PLUGIN_UPDATE_REPO}/releases/latest`;

/** 清单契约版本（读到 ≠ 此值直接视为不可用） */
export const PLUGIN_UPDATE_SCHEMA_VERSION = 1;

/** 拉清单超时（毫秒）：静默检查不能拖慢开工坊 */
export const PLUGIN_UPDATE_INDEX_TIMEOUT_MS = 10_000;

/** 下载 zip 超时（毫秒）：包可能几十 KB，但网络差时也要给足 */
export const PLUGIN_UPDATE_DOWNLOAD_TIMEOUT_MS = 30_000;

/**
 * 降级路径的超时（毫秒）
 *
 * 降级仅在主流失败时触发，超时刻意短于主路径：断网时若两段都是 10s，
 * 用户开工坊会看到提示条卡在「检查更新中…」整整 20 秒。6s 把总耗时压到 16s 内，
 * 而降级只是「再试一次拿 tag」，够用了。
 */
export const PLUGIN_UPDATE_FALLBACK_TIMEOUT_MS = 6_000;

/**
 * 静默检查冷却期（毫秒）
 *
 * 开工坊触发的自动检查受它约束；手动点「检查更新」绕过；**失败不设冷却**
 * （下次进工坊可以立刻重试）。
 */
export const PLUGIN_UPDATE_SILENT_COOLDOWN_MS = 30 * 60 * 1000;

/** zip 体积上限（与 `USER_PLUGIN_PACKAGE_MAX_BYTES` 对齐，超了不下载） */
export const PLUGIN_UPDATE_ZIP_MAX_BYTES = 8 * 1024 * 1024;

/** 官方插件仓库展示名（确认弹窗「来源」行） */
export const PLUGIN_UPDATE_REPO_LABEL = '官方插件仓库';

/** 浮窗来源标签（与 `PLUGIN_VANISHED_NOTICE_SOURCE` 同口径） */
export const PLUGIN_UPDATE_NOTICE_SOURCE = '插件更新';

/** 提示条内最多点名的插件数（超出用「等 N 个」收尾，避免长串挤爆一行） */
export const PLUGIN_UPDATE_BAR_NAME_LIMIT = 3;

// ——— 提示条 / 按钮文案 ———

/** 「检查更新」按钮：空闲态 */
export const PLUGIN_UPDATE_CHECK_LABEL = '检查更新';
/** 「检查更新」按钮：检查中 */
export const PLUGIN_UPDATE_CHECKING_LABEL = '检查中…';
/** 「检查更新」按钮：刚查完且无更新 */
export const PLUGIN_UPDATE_LATEST_LABEL = '已是最新';
/** 「检查更新」按钮：失败态（可重试） */
export const PLUGIN_UPDATE_RETRY_LABEL = '重试';

/** 提示条：检查中 */
export const PLUGIN_UPDATE_BAR_CHECKING = '检查更新中…';
/** 提示条：全部最新 */
export const PLUGIN_UPDATE_BAR_LATEST = '全部插件已是最新';
/** 提示条：拿不到清单（静默失败只在这里说，不弹浮窗打扰用户） */
export const PLUGIN_UPDATE_BAR_FAIL = '未能获取更新信息（网络不可用）';
/** 提示条：批量更新按钮 */
export const PLUGIN_UPDATE_BAR_UPDATE_ALL = '全部更新';

/**
 * 提示条：N 个插件可更新（点名前 PLUGIN_UPDATE_BAR_NAME_LIMIT 个）
 * @param count 可更新个数
 * @param names 形如「速记 v1.1.0」的点名列表（已按上限截断）
 * @returns 提示条正文
 */
export const PLUGIN_UPDATE_BAR_UPDATABLE = (count: number, names: readonly string[]): string => {
  const listed = names.join('、');
  const tail = count > names.length ? ' 等' : '';
  return `${count} 个插件可更新（${listed}${tail}）`;
};

/**
 * 列表项里的「可更新」标签文案
 * @param version 最新版本号
 * @returns 标签文案
 */
export const PLUGIN_UPDATE_TAG_LABEL = (version: string): string => `可更新 v${version}`;

/** 列表项「更新」按钮：空闲态 */
export const PLUGIN_UPDATE_ACTION_LABEL = '更新';
/** 列表项「更新」按钮：该插件正在更新 */
export const PLUGIN_UPDATE_ACTION_BUSY_LABEL = '更新中…';

/**
 * 确认弹窗里的体积文案（与主 app 侧 `formatKb` 同口径：KB 一位小数）
 * @param bytes 字节数
 * @returns 形如 `25.5 KB` 的文本
 */
export const PLUGIN_UPDATE_SIZE_LABEL = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

// ——— 确认弹窗文案 ———

/**
 * 确认弹窗标题
 * @param name 插件展示名
 * @returns 标题
 */
export const PLUGIN_UPDATE_CONFIRM_TITLE = (name: string): string => `更新「${name}」`;

/** 确认弹窗「下载并安装」 */
export const PLUGIN_UPDATE_CONFIRM_OK = '下载并安装';
/** 确认弹窗「取消」 */
export const PLUGIN_UPDATE_CONFIRM_CANCEL = '取消';

/**
 * 批量更新确认弹窗标题
 * @param count 待更新个数
 * @returns 标题
 */
export const PLUGIN_UPDATE_CONFIRM_ALL_TITLE = (count: number): string =>
  `更新 ${count} 个插件`;

/**
 * 批量更新确认弹窗「下载并安装 N 个」（把数量写进按钮，用户知道要下几个包）
 * @param count 待更新个数
 * @returns 按钮文案
 */
export const PLUGIN_UPDATE_CONFIRM_ALL_OK = (count: number): string =>
  `下载并安装 ${count} 个`;

/** 批量更新确认弹窗的覆盖提示（与单包口径一致：数据表保留） */
export const PLUGIN_UPDATE_CONFIRM_ALL_HINT = '插件数据表保留，当前版本将被替换';

/** 确认弹窗里「查看更新说明」外链文案（跳本 Release 的发布页，见清单 `releaseUrl`） */
export const PLUGIN_UPDATE_RELEASE_LINK_LABEL = '查看更新说明';

// ——— 失败文案 ———

/** 拉清单失败（面向用户的兜底文案） */
export const PLUGIN_UPDATE_ERR_INDEX = '未能获取更新信息，请检查网络后重试';
/** 清单契约版本对不上 */
export const PLUGIN_UPDATE_ERR_SCHEMA = '更新清单版本不兼容，请升级应用';

/**
 * 下载失败
 * @param reason 具体原因
 * @returns 面向用户的文案
 */
export const PLUGIN_UPDATE_ERR_DOWNLOAD = (reason: string): string => `下载失败：${reason}`;

/** sha256 不匹配（硬失败：装上去的后果比装不上严重） */
export const PLUGIN_UPDATE_ERR_CHECKSUM = '下载内容校验未通过，请重试';

/**
 * 包内 id 与清单 id 不符
 * @param expected 清单 id
 * @param actual 包内 id
 * @returns 面向用户的文案
 */
export const PLUGIN_UPDATE_ERR_ID_MISMATCH = (expected: string, actual: string): string =>
  `更新包 id（${actual}）与清单（${expected}）不一致，已中止`;

/** 更新成功浮窗标题 */
export const PLUGIN_UPDATE_OK_TITLE = '插件已更新';
/** 更新失败浮窗标题 */
export const PLUGIN_UPDATE_FAIL_TITLE = '插件更新失败';

/**
 * 更新成功浮窗正文
 * @param name 插件展示名
 * @param version 更新后的版本
 * @returns 正文
 */
export const PLUGIN_UPDATE_OK_BODY = (name: string, version: string): string =>
  `「${name}」→ v${version}`;

/**
 * 批量更新结果浮窗正文
 * @param updated 成功个数
 * @param failed 失败个数
 * @returns 正文
 */
export const PLUGIN_UPDATE_ALL_BODY = (updated: number, failed: number): string =>
  failed === 0 ? `已更新 ${updated} 个插件` : `已更新 ${updated} 个，${failed} 个失败`;

/**
 * 插件在线更新的宿主编排（检查 → 候选 → 下载 → 复用既有安装链路）
 *
 * 这一层**自己不持有持久化、不碰内核**：
 * - 检查 = 拉官方清单 + 与已装记录比版本（匹配只靠 id）；
 * - 更新 = 下载字节 → `parsePluginPackage` → `useUserPlugins().install()`，
 *   与「本地重新导入 zip 升级」走的是同一条链路，不另起炉灶。
 *
 * 状态是**模块级单例**（照 `use-user-plugins.ts` 的 `pendingDbCleanup` 先例）：
 * 开关工坊、切页面不该让「正在更新」「刚查到 2 个可更新」凭空消失。
 */
import { computed, ref } from 'vue';
import { downloadPluginZip, fetchPluginIndex, sha256Hex } from '../api/plugin-update.api';
import { parsePluginPackage } from '../utils/plugin-package';
import { isNewerVersion } from '../utils/plugin-version';
import { USER_PLUGIN_SOURCE } from '../constants/plugin.constants';
import { NOTIFY_TONE } from '../constants/notify.constants';
import {
  PLUGIN_UPDATE_ALL_BODY,
  PLUGIN_UPDATE_BAR_NAME_LIMIT,
  PLUGIN_UPDATE_ERR_CHECKSUM,
  PLUGIN_UPDATE_ERR_ID_MISMATCH,
  PLUGIN_UPDATE_FAIL_TITLE,
  PLUGIN_UPDATE_NOTICE_SOURCE,
  PLUGIN_UPDATE_OK_BODY,
  PLUGIN_UPDATE_OK_TITLE,
  PLUGIN_UPDATE_SILENT_COOLDOWN_MS,
  PLUGIN_UPDATE_TAG_LABEL,
} from '../constants/plugin-update.constants';
import { useNotificationsStore } from '../stores/notifications';
import { useUserPluginsStore } from '../stores/user-plugins';
import { trackAction } from '../weblog/weblogActions';
import { useUserPlugins } from './use-user-plugins';
import type {
  PluginUpdateCandidate,
  PluginUpdateCheckStatus,
  PluginUpdateIndex,
  PluginUpdateSummary,
} from '../types/plugin-update.types';
import type { ComputedRef, Ref } from 'vue';

/** 「检查更新」的状态（提示条据此渲染四种形态） */
export type { PluginUpdateCheckStatus };

/** 检查更新的入参 */
export interface PluginUpdateCheckOptions {
  /** true = 用户手动点「检查更新」，绕过冷却期；false / 缺省 = 静默自动检查 */
  force?: boolean;
}

/** `usePluginUpdate()` 返回句柄 */
export interface UsePluginUpdateReturn {
  /** 上次检查的结论（原始值；UI 一律消费 `barStatus`） */
  status: Ref<PluginUpdateCheckStatus>;
  /**
   * 提示条的展示态：候选集合被外部清空（卸载 / 覆盖安装）时把 `updatable` 收敛成 `latest`
   */
  barStatus: ComputedRef<PluginUpdateCheckStatus>;
  /** 上次成功检查的时间戳（0 = 从未成功；失败不写它，所以失败不产生冷却） */
  lastCheckedAt: Ref<number>;
  /** 最近一次失败原因（成功时为空串） */
  error: Ref<string>;
  /** 可更新项（清单与已装记录合并，只含「已装且远端更新」的） */
  candidates: ComputedRef<readonly PluginUpdateCandidate[]>;
  /** 正在更新的插件 id */
  updatingIds: Ref<readonly string[]>;
  /** 是否正在检查 */
  checking: ComputedRef<boolean>;
  /** 是否有任何更新动作在跑（检查中或正在装；按钮据此禁用） */
  busy: ComputedRef<boolean>;
  /**
   * 某个插件的更新候选
   * @param id 插件 id
   * @returns 候选；没有可更新时为 undefined
   */
  candidateOf: (id: string) => PluginUpdateCandidate | undefined;
  /**
   * 检查更新（幂等：在途请求共享同一 Promise；静默调用受冷却期约束）
   * @param options 选项（`force: true` 为用户手动触发，绕过冷却）
   */
  check: (options?: PluginUpdateCheckOptions) => Promise<void>;
  /**
   * 下载并安装一个更新
   * @param id 插件 id
   * @returns 是否成功
   */
  applyUpdate: (id: string) => Promise<boolean>;
  /**
   * 串行更新全部候选
   * @returns 成功 / 失败计数
   */
  applyAll: () => Promise<PluginUpdateSummary>;
}

// —— 模块级单例状态 ——

/** 当前状态 */
const status = ref<PluginUpdateCheckStatus>('idle');

/** 上次**成功**检查的时间戳（0 = 从未成功；失败不写它，所以失败不产生冷却） */
const lastCheckedAt = ref<number>(0);

/** 最近一次失败原因（成功时清空） */
const errorMessage = ref<string>('');

/** 最近一次拉到的清单（null = 还没拉到） */
const index = ref<PluginUpdateIndex | null>(null);

/** 正在更新的插件 id（互斥集合，串行更新的依据） */
const updatingIds = ref<readonly string[]>([]);

/** 在途的检查 Promise（重复调用共享同一份，避免同一秒打两次网络） */
let inFlight: Promise<void> | null = null;

/**
 * 把未知异常压成能给用户看的中文原因
 * @param caught 抛出的异常
 * @returns 原因文案
 */
const toReason = (caught: unknown): string =>
  caught instanceof Error ? caught.message : '未知错误';

/**
 * 弹一条浮窗（用户主动发起的动作才有资格用浮窗；静默检查失败只进提示条）
 * @param title 标题
 * @param body 正文
 * @param tone 语气（成功用主色，失败用上涨语义色）
 */
const notify = (title: string, body: string, tone: 'primary' | 'up'): void => {
  useNotificationsStore().push({ title, body, tone, source: PLUGIN_UPDATE_NOTICE_SOURCE });
};

/** 可更新项：清单 + 已装记录合并，只保留「已装且远端更新」的 */
const candidates = computed<readonly PluginUpdateCandidate[]>(() => {
  const current = index.value;
  if (current === null) return [];
  // 只认已安装的用户插件：内置插件（用户没装过 zip 版）不提示 ——
  // 否则会把用户没选择过的内置实现悄悄换成 zip 版接管
  const records = useUserPluginsStore().records;
  const byId = new Map(records.map((record) => [record.id, record]));
  const result: PluginUpdateCandidate[] = [];
  for (const entry of current.plugins) {
    const record = byId.get(entry.id);
    if (!record) continue;
    if (!isNewerVersion(entry.version, record.version)) continue;
    result.push({
      id: entry.id,
      name: entry.name,
      currentVersion: record.version,
      latestVersion: entry.version,
      description: entry.description,
      author: entry.author ?? '',
      zipName: entry.zipName,
      zipSize: entry.zipSize,
      sha256: entry.sha256 ?? '',
      downloadUrl: entry.downloadUrl,
      changelog: entry.changelog ?? '',
      releaseUrl: current.releaseUrl,
    });
  }
  return result;
});

/**
 * 提示条的展示态（**派生**，不直接消费 `status`）
 *
 * `status` 是「上次检查的结论」，是个普通 ref：候选集合被**外部**改动时它不会重算 ——
 * 典型是用户卸载了那个可更新的插件，`candidates` 变空而 `status` 还停在 `updatable`，
 * 提示条就会渲染出「0 个插件可更新（）」的空壳，还挂着一个点了没反应的「全部更新」。
 * 所以展示一律消费这里。
 */
const barStatus = computed<PluginUpdateCheckStatus>(() =>
  status.value === 'updatable' && candidates.value.length === 0 ? 'latest' : status.value,
);

/** 是否正在检查 */
const checking = computed<boolean>(() => status.value === 'checking');

/** 是否有任何更新动作在跑（检查中或正在装；按钮据此禁用防重复提交） */
const busy = computed<boolean>(() => checking.value || updatingIds.value.length > 0);

/**
 * 某个插件的更新候选（没有可更新时为 undefined）
 * @param id 插件 id
 * @returns 候选
 */
const candidateOf = (id: string): PluginUpdateCandidate | undefined =>
  candidates.value.find((candidate) => candidate.id === id);

/**
 * 执行一次检查（含状态推进与埋点；不外抛，失败写进 errorMessage）
 * @param force 是否为用户手动触发（决定失败要不要埋点）
 * @returns 无
 */
const runCheck = async (force: boolean): Promise<void> => {
  try {
    const next = await fetchPluginIndex();
    index.value = next;
    lastCheckedAt.value = Date.now();
    status.value = candidates.value.length > 0 ? 'updatable' : 'latest';
    errorMessage.value = '';
    trackAction('PLUGIN_UPDATE_CHECK', { detail: `tag=${next.tag}`, status: 'ok' });
  } catch (caught) {
    console.error('[plugin-update] check', caught);
    errorMessage.value = toReason(caught);
    // 失败不写 lastCheckedAt —— 下次进工坊可以立刻重试
    status.value = 'fail';
    if (force) {
      trackAction('PLUGIN_UPDATE_CHECK', { detail: errorMessage.value, status: 'fail' });
    }
  }
};

/**
 * 检查更新（幂等：在途请求共享同一 Promise；静默调用受冷却期约束）
 * @param options 选项（`force: true` 为用户手动触发，绕过冷却）
 */
const check = async (options?: PluginUpdateCheckOptions): Promise<void> => {
  if (inFlight !== null) {
    await inFlight;
    return;
  }
  const force = options?.force === true;
  const cooledDown = Date.now() - lastCheckedAt.value < PLUGIN_UPDATE_SILENT_COOLDOWN_MS;
  if (!force && lastCheckedAt.value > 0 && cooledDown) return;
  status.value = 'checking';
  inFlight = runCheck(force);
  try {
    await inFlight;
  } finally {
    inFlight = null;
  }
};

/**
 * 下载 → 校验 → 解析 → 复用 install 装上一个候选（失败不外抛，返回 false）
 * @param candidate 更新候选
 * @returns 是否安装成功
 */
const runInstall = async (candidate: PluginUpdateCandidate): Promise<boolean> => {
  const detail = `v${candidate.currentVersion} → v${candidate.latestVersion}`;
  try {
    const buffer = await downloadPluginZip(candidate.downloadUrl);
    // sha256 是可选校验：清单没给就跳过；给了但不匹配 = 包坏了或被换了，硬失败
    if (candidate.sha256.length > 0) {
      const actual = await sha256Hex(buffer);
      if (actual.length > 0 && actual !== candidate.sha256) {
        throw new Error(PLUGIN_UPDATE_ERR_CHECKSUM);
      }
    }
    const pkg = parsePluginPackage(buffer);
    if (pkg.manifest.id && pkg.manifest.id !== candidate.id) {
      throw new Error(PLUGIN_UPDATE_ERR_ID_MISMATCH(candidate.id, pkg.manifest.id));
    }
    // 关键复用：与「本地导入 zip 升级」完全同一条安装链路，
    // 校验（预检 / import / 结构 / 清单一致性）都在 install 内部、unuse 之前完成
    const result = await useUserPlugins().install(pkg.code, {
      manifest: pkg.manifest,
      source: USER_PLUGIN_SOURCE.UPDATE,
      updateUrl: candidate.downloadUrl,
    });
    if (!result.ok) throw new Error(result.error);
    // 记录版本已变 → candidates 自动移除这一项；全装完了提示条要回到「已是最新」，
    // 否则会渲染出「0 个插件可更新（）」这种空壳
    status.value = candidates.value.length > 0 ? 'updatable' : 'latest';
    notify(
      PLUGIN_UPDATE_OK_TITLE,
      PLUGIN_UPDATE_OK_BODY(candidate.name, candidate.latestVersion),
      NOTIFY_TONE.PRIMARY,
    );
    trackAction('PLUGIN_UPDATE_INSTALL', { target: candidate.id, detail, status: 'ok' });
    return true;
  } catch (caught) {
    console.error('[plugin-update] install', caught);
    notify(
      PLUGIN_UPDATE_FAIL_TITLE,
      `${candidate.name}：${toReason(caught)}`,
      NOTIFY_TONE.UP,
    );
    trackAction('PLUGIN_UPDATE_INSTALL', { target: candidate.id, detail, status: 'fail' });
    return false;
  }
};

/**
 * 装一个候选（同一 id 正在更新则直接返回；外部可并发调用，实际会自行排队）
 * @param candidate 更新候选
 * @returns 是否安装成功
 */
const installCandidate = async (candidate: PluginUpdateCandidate): Promise<boolean> => {
  if (updatingIds.value.includes(candidate.id)) return false;
  updatingIds.value = [...updatingIds.value, candidate.id];
  try {
    return await runInstall(candidate);
  } finally {
    updatingIds.value = updatingIds.value.filter((item) => item !== candidate.id);
  }
};

/**
 * 下载并安装一个更新
 * @param id 插件 id
 * @returns 是否成功
 */
const applyUpdate = async (id: string): Promise<boolean> => {
  const candidate = candidateOf(id);
  if (!candidate) return false;
  return installCandidate(candidate);
};

/**
 * 串行更新全部候选
 *
 * 必须串行：安装会 `unuse` 旧版再 `use` 新版，并行会互相踩踏
 * （且持久化是「单 key 全量回写」，并发写会互相覆盖）。
 * @returns 成功 / 失败计数
 */
const applyAll = async (): Promise<PluginUpdateSummary> => {
  // 先快照：装完一个它就会从 candidates 里消失（记录版本已更新）
  const targets = [...candidates.value];
  let updated = 0;
  let failed = 0;
  for (const candidate of targets) {
    const ok = await installCandidate(candidate);
    if (ok) updated += 1;
    else failed += 1;
  }
  if (targets.length > 0) {
    notify(
      failed === 0 ? PLUGIN_UPDATE_OK_TITLE : PLUGIN_UPDATE_FAIL_TITLE,
      PLUGIN_UPDATE_ALL_BODY(updated, failed),
      failed === 0 ? NOTIFY_TONE.PRIMARY : NOTIFY_TONE.UP,
    );
  }
  return { updated, failed };
};

/**
 * 插件在线更新的宿主编排入口
 *
 * 每次调用返回**同一份**模块级状态（开关工坊、切页面不丢）。
 * @returns 状态与检查 / 更新句柄
 */
export const usePluginUpdate = (): UsePluginUpdateReturn => ({
  status,
  barStatus,
  lastCheckedAt,
  error: errorMessage,
  candidates,
  updatingIds,
  checking,
  busy,
  candidateOf,
  check,
  applyUpdate,
  applyAll,
});

/**
 * 提示条里点名的插件串（超出上限由 `PLUGIN_UPDATE_BAR_UPDATABLE` 收尾为「等 N 个」）
 * @param candidates 可更新项
 * @returns 形如「速记 可更新 v1.1.0」的列表
 */
export const pluginUpdateNameList = (
  candidates: readonly PluginUpdateCandidate[],
): readonly string[] =>
  candidates
    .slice(0, PLUGIN_UPDATE_BAR_NAME_LIMIT)
    .map((candidate) => `${candidate.name} ${PLUGIN_UPDATE_TAG_LABEL(candidate.latestVersion)}`);

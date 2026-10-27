/**
 * 插件市场的宿主编排（多源拉取 → 合并去重 → 确认安装）
 *
 * 这一层**不持有持久化结构、不直接写存储**：
 * - 源列表在 `stores/plugin-market.ts`；目录缓存 per-repo 落在 api 层；
 * - 安装 = `downloadPluginZip` → sha256 校验 → `parsePluginPackage` →
 *   `useUserPlugins().install()`，与「在线更新 / 本地 zip」完全同一条链路，
 *   同 id 覆盖安装（升级 / 降级同语义，插件数据表保留）。
 *
 * 状态是**模块级单例**（照 `use-plugin-update.ts` 先例）：开关弹窗、切页面
 * 不该让「正在安装」「已加载的目录」凭空消失。
 *
 * 多源口径：
 * - 内置官方源恒在源列表首位（store 保证），合并条目按源顺序**官方优先**去重
 *   （同 id 插件出现在多个源时只保留先到源的一条，避免同 id 双卡）；
 * - 默认只拉「内置源 + 有缓存的自定义源」，未缓存的自定义源**懒加载**
 *   （选中它的筛选 chip 时才拉），控 api.github.com 匿名 60 次/h/IP 的消耗。
 */
import { computed, ref } from 'vue';
import {
  downloadPluginZip,
  sha256Hex,
} from '../api/plugin-update.api.ts';
import {
  fetchSourceCatalog,
  peekCatalogCache,
  removeCatalogCache,
} from '../api/plugin-market.api.ts';
import { mapWithConcurrency } from '../utils/map-with-concurrency';
import { delay } from '../utils/delay';
import { parsePluginPackage } from '../utils/plugin-package';
import {
  PLUGIN_MARKET_ERR_CHECKSUM,
  PLUGIN_MARKET_ERR_ID_MISMATCH,
  PLUGIN_MARKET_FAIL_TITLE,
  PLUGIN_MARKET_LOAD_CONCURRENCY,
  PLUGIN_MARKET_LOAD_STAGGER_MS,
  PLUGIN_MARKET_NOTICE_SOURCE,
  PLUGIN_MARKET_OK_BODY,
  PLUGIN_MARKET_OK_TITLE,
} from '../constants/plugin-market.constants.ts';
import { NOTIFY_TONE } from '../constants/notify.constants.ts';
import { USER_PLUGIN_SOURCE } from '../constants/plugin.constants.ts';
import { useNotificationsStore } from '../stores/notifications';
import { usePluginMarketStore } from '../stores/plugin-market';
import { useUserPluginsStore } from '../stores/user-plugins';
import { trackAction } from '../../pc/weblog/weblogActions';
import { useUserPlugins } from './use-user-plugins';
import type {
  PluginMarketCatalog,
  PluginMarketEntry,
  PluginMarketInstallingKey,
  PluginMarketRepoState,
  PluginMarketSource,
  PluginMarketVersion,
} from '../types/plugin-market.types.ts';
import type { ComputedRef, Ref } from 'vue';

// —— 模块级单例状态 ——

/** per-repo 已加载目录（repo → catalog） */
const catalogs = ref(new Map<string, PluginMarketCatalog>());

/** per-repo 加载状态（repo → idle / loading / ready / fail） */
const repoStates = ref(new Map<string, PluginMarketRepoState>());

/** per-repo 最近一次失败原因（成功时清空） */
const repoErrors = ref(new Map<string, string>());

/** 正在进行的安装（全局串行：同一时刻至多一个；null = 空闲） */
const installing = ref<PluginMarketInstallingKey | null>(null);

/** 在途加载集合（重复触发共享；只做防抖判断，不做 Promise 合并） */
const loadingNow = new Set<string>();

/** 安装串行链（上一个装完才轮到下一个） */
let installChain: Promise<void> = Promise.resolve();

/** 首次进入时补回内置源（持久化数据可能缺它） */
let builtinEnsured = false;

/**
 * 把未知异常压成能给用户看的中文原因
 * @param caught 抛出的异常
 * @returns 原因文案
 */
const toReason = (caught: unknown): string =>
  caught instanceof Error ? caught.message : '未知错误';

/** `usePluginMarket()` 返回句柄 */
export interface UsePluginMarketReturn {
  /** 插件源列表（内置源恒在首位） */
  sources: ComputedRef<readonly PluginMarketSource[]>;
  /** 已合并的插件条目（官方优先去重；只含已加载成功的源） */
  entries: ComputedRef<readonly PluginMarketEntry[]>;
  /** 正在进行的安装（null = 空闲；按钮据此禁用） */
  installing: Ref<PluginMarketInstallingKey | null>;
  /**
   * 某个源的加载状态
   * @param repo 仓库全名
   * @returns 状态（未拉取过为 'idle'）
   */
  stateOf: (repo: string) => PluginMarketRepoState;
  /**
   * 某个源的失败原因
   * @param repo 仓库全名
   * @returns 原因（无失败为空串）
   */
  errorOf: (repo: string) => string;
  /**
   * 本地已装版本（市场卡据此渲染「安装 / 更新 / 已安装」三态）
   * @param id 插件 id
   * @returns 已装版本；未装为空串
   */
  installedVersionOf: (id: string) => string;
  /**
   * 拉默认源集合：内置源 + 有缓存的自定义源（并发 ≤3 错峰）
   * @param options 选项
   * @param options.force true = 全部强刷（点「刷新」）
   */
  loadDefaultSources: (options?: { force?: boolean }) => Promise<void>;
  /**
   * 确保某个源已加载（懒加载入口；force 时强刷）
   * @param repo 仓库全名
   * @param options 选项
   * @param options.force true = 跳过缓存强制请求
   */
  ensureSourceLoaded: (repo: string, options?: { force?: boolean }) => Promise<void>;
  /**
   * 添加第三方源（确认弹窗在 UI 层；这里做持久化 + 首次拉取）
   * @param repo 已归一化的仓库全名
   * @param label 展示名（缺省取 repo）
   * @returns 是否成功（失败已弹浮窗，返回值供 UI 收起输入态）
   */
  addSource: (repo: string, label?: string) => Promise<boolean>;
  /**
   * 删除第三方源（两段确认在 UI 层；顺带清它的目录缓存）
   * @param repo 仓库全名
   */
  removeSource: (repo: string) => void;
  /**
   * 安装一个版本（**必须先在 UI 层弹确认**；全局串行执行）
   * @param entry 插件条目
   * @param version 目标版本（缺省 = 最新版）
   */
  install: (entry: PluginMarketEntry, version?: PluginMarketVersion) => Promise<boolean>;
}

/**
 * 弹一条浮窗（市场动作都由用户主动发起，结果一律浮窗反馈）
 * @param title 标题
 * @param body 正文
 * @param tone 语气（成功主色 / 失败上涨语义色，随 data-trend）
 */
const notify = (title: string, body: string, tone: 'primary' | 'up'): void => {
  useNotificationsStore().push({ title, body, tone, source: PLUGIN_MARKET_NOTICE_SOURCE });
};

/**
 * 拉一个源并写状态（不外抛；失败写进 repoErrors）
 * @param repo 仓库全名
 * @param force 是否强刷
 */
const loadOne = async (repo: string, force: boolean): Promise<void> => {
  if (loadingNow.has(repo)) return;
  loadingNow.add(repo);
  repoStates.value = new Map(repoStates.value).set(repo, 'loading');
  try {
    const catalog = await fetchSourceCatalog(repo, { force });
    catalogs.value = new Map(catalogs.value).set(repo, catalog);
    repoStates.value = new Map(repoStates.value).set(repo, 'ready');
    repoErrors.value = new Map(repoErrors.value).set(repo, '');
  } catch (caught) {
    console.error('[plugin-market] load', repo, caught);
    repoStates.value = new Map(repoStates.value).set(repo, 'fail');
    repoErrors.value = new Map(repoErrors.value).set(repo, toReason(caught));
  } finally {
    loadingNow.delete(repo);
  }
};

/**
 * 插件市场的宿主编排入口（每次调用返回同一份模块级状态）
 * @returns 状态与加载 / 源管理 / 安装句柄
 */
export const usePluginMarket = (): UsePluginMarketReturn => {
  const marketStore = usePluginMarketStore();
  const userPluginsStore = useUserPluginsStore();
  if (!builtinEnsured) {
    marketStore.ensureBuiltinSource();
    builtinEnsured = true;
  }

  /** 源列表（store 的响应式引用） */
  const sources = computed<readonly PluginMarketSource[]>(() => marketStore.sources);

  /** 已合并的插件条目：按源顺序官方优先去重（同 id 只留先到源的一条） */
  const entries = computed<readonly PluginMarketEntry[]>(() => {
    const claimed = new Set<string>();
    const result: PluginMarketEntry[] = [];
    for (const source of sources.value) {
      const catalog = catalogs.value.get(source.repo);
      if (!catalog) continue;
      for (const entry of catalog.entries) {
        if (claimed.has(entry.id)) continue;
        claimed.add(entry.id);
        result.push(entry);
      }
    }
    return result;
  });

  /**
   * 某个源的加载状态
   * @param repo 仓库全名
   * @returns 状态
   */
  const stateOf = (repo: string): PluginMarketRepoState =>
    repoStates.value.get(repo) ?? 'idle';

  /**
   * 某个源的失败原因
   * @param repo 仓库全名
   * @returns 原因
   */
  const errorOf = (repo: string): string => repoErrors.value.get(repo) ?? '';

  /**
   * 本地已装版本
   * @param id 插件 id
   * @returns 已装版本；未装为空串
   */
  const installedVersionOf = (id: string): string =>
    userPluginsStore.records.find((record) => record.id === id)?.version ?? '';

  /**
   * 拉默认源集合：内置源 + 有缓存的自定义源（并发 ≤3、按序错峰）
   * @param options 选项
   * @param options.force true = 全部强刷（点「刷新」）
   */
  const loadDefaultSources = async (options?: { force?: boolean }): Promise<void> => {
    const repos = sources.value
      .filter((source) => source.builtin || peekCatalogCache(source.repo) !== null)
      .map((source) => source.repo);
    await mapWithConcurrency(repos, async (repo, index) => {
      // 错峰：并发窗口内的第 N 个请求延迟 N 个间隔再发，降低对 api.github.com 的瞬时压力
      if (index > 0) await delay(PLUGIN_MARKET_LOAD_STAGGER_MS * index);
      await loadOne(repo, options?.force === true);
    }, { concurrency: PLUGIN_MARKET_LOAD_CONCURRENCY });
  };

  /**
   * 确保某个源已加载（懒加载入口；force 时强刷）
   * @param repo 仓库全名
   * @param options 选项
   * @param options.force true = 跳过缓存强制请求
   */
  const ensureSourceLoaded = async (
    repo: string,
    options?: { force?: boolean },
  ): Promise<void> => {
    const state = stateOf(repo);
    if (!options?.force && (state === 'loading' || state === 'ready')) return;
    await loadOne(repo, options?.force === true);
  };

  /**
   * 添加第三方源并立即拉取它的目录
   * @param repo 已归一化的仓库全名
   * @param label 展示名
   * @returns 是否成功
   */
  const addSource = async (repo: string, label?: string): Promise<boolean> => {
    const result = marketStore.addSource(repo, label);
    if (!result.ok) {
      notify('添加插件源失败', result.error, NOTIFY_TONE.UP);
      return false;
    }
    trackAction('PLUGIN_MARKET_SOURCE_ADD', { target: repo, status: 'ok' });
    await loadOne(repo, false);
    return true;
  };

  /**
   * 删除第三方源并清它的目录缓存（内置源由 store 拒绝，这里再挡一层）
   * @param repo 仓库全名
   */
  const removeSource = (repo: string): void => {
    const source = sources.value.find((item) => item.repo === repo);
    if (!source || source.builtin) return;
    marketStore.removeSource(repo);
    removeCatalogCache(repo);
    catalogs.value = new Map([...catalogs.value].filter(([key]) => key !== repo));
    repoStates.value = new Map([...repoStates.value].filter(([key]) => key !== repo));
    repoErrors.value = new Map([...repoErrors.value].filter(([key]) => key !== repo));
    trackAction('PLUGIN_MARKET_SOURCE_REMOVE', { target: repo, status: 'ok' });
  };

  /**
   * 下载 → 校验 → 解析 → 复用 install 装上（串行链的一次执行；失败不外抛）
   * @param entry 插件条目
   * @param version 目标版本
   * @returns 是否安装成功
   */
  const runInstall = async (
    entry: PluginMarketEntry,
    version: PluginMarketVersion,
  ): Promise<boolean> => {
    const detail = `v${version.version}@${entry.sourceRepo}`;
    try {
      const buffer = await downloadPluginZip(version.downloadUrl);
      // sha256 是可选校验：增强清单没给就跳过（第三方源常态）；给了但不匹配 = 包坏了或被换了，硬失败
      if (version.sha256.length > 0) {
        const actual = await sha256Hex(buffer);
        if (actual.length > 0 && actual !== version.sha256) {
          throw new Error(PLUGIN_MARKET_ERR_CHECKSUM);
        }
      }
      const pkg = parsePluginPackage(buffer);
      if (pkg.manifest.id && pkg.manifest.id !== entry.id) {
        throw new Error(PLUGIN_MARKET_ERR_ID_MISMATCH(entry.id, pkg.manifest.id));
      }
      // 关键复用：与「本地 zip / 在线更新」完全同一条安装链路，
      // 校验（预检 / import / 结构 / 清单一致性）都在 install 内部、unuse 之前完成
      const result = await useUserPlugins().install(pkg.code, {
        manifest: pkg.manifest,
        source: USER_PLUGIN_SOURCE.MARKET,
        updateUrl: version.downloadUrl,
      });
      if (!result.ok) throw new Error(result.error);
      notify(
        PLUGIN_MARKET_OK_TITLE,
        PLUGIN_MARKET_OK_BODY(entry.name, version.version),
        NOTIFY_TONE.PRIMARY,
      );
      trackAction('PLUGIN_MARKET_INSTALL', { target: entry.id, detail, status: 'ok' });
      return true;
    } catch (caught) {
      console.error('[plugin-market] install', caught);
      notify(PLUGIN_MARKET_FAIL_TITLE, `${entry.name}：${toReason(caught)}`, NOTIFY_TONE.UP);
      trackAction('PLUGIN_MARKET_INSTALL', { target: entry.id, detail, status: 'fail' });
      return false;
    }
  };

  /**
   * 安装一个版本（全局串行：排队到上一份装完才开跑）
   * @param entry 插件条目
   * @param version 目标版本（缺省 = 最新版）
   * @returns 是否安装成功
   */
  const install = async (
    entry: PluginMarketEntry,
    version?: PluginMarketVersion,
  ): Promise<boolean> => {
    const target = version ?? entry.latest;
    const resultPromise = installChain.then(() => {
      installing.value = { id: entry.id, version: target.version };
      return runInstall(entry, target);
    });
    // 链上挂收尾：无论成败都清进行中标记，并把链推进到下一个等待者
    installChain = resultPromise.then(
      () => undefined,
      () => undefined,
    );
    const ok = await resultPromise;
    installing.value = null;
    return ok;
  };

  return {
    sources,
    entries,
    installing,
    stateOf,
    errorOf,
    installedVersionOf,
    loadDefaultSources,
    ensureSourceLoaded,
    addSource,
    removeSource,
    install,
  };
};

import { computed, ref } from 'vue';
import { pluginKernel } from '../plugin';
import {
  importUserPluginCode,
  mountUserPluginDefinition,
} from '../plugin/user-plugin-loader';
import { listPluginTables, dropPluginTables } from '../api/plugin-db.api';
import { BUILTIN_PLUGINS } from '../plugins';
import { usePluginStore } from '../stores/plugin';
import { useUserPluginsStore } from '../stores/user-plugins';
import { checkManifestConsistency } from '../utils/plugin-package';
import {
  USER_PLUGIN_CODE_MAX_LENGTH,
  USER_PLUGIN_SOURCE,
} from '../constants/plugin.constants';
import { trackAction } from '../weblog/weblogActions';
import type { ComputedRef } from 'vue';
import type { PluginPackageManifest } from '../utils/plugin-package';
import type { UserPluginLintIssue } from '../plugin/user-plugin-lint';
import type { UserPluginRecord } from '../types/plugin.types';

/** 安装结果 */
export interface UserPluginInstallResult {
  /** 是否安装成功（成功 = 已通过校验并挂进内核） */
  ok: boolean;
  /** 失败原因（成功时为空串） */
  error: string;
  /** 非致命提醒（静态预检产出：能装但可能显示异常，如 Tailwind 类没有 CSS） */
  warnings?: readonly UserPluginLintIssue[];
}

/** 安装附加信息（zip 产物包安装时传入；粘贴代码安装时不传） */
export interface UserPluginInstallOptions {
  /**
   * 包清单（manifest.json 解析结果）
   *
   * 传入后会与产物导出的定义做一致性校验（id / version 必须对得上），
   * 并把清单里的 author 作为产物未声明时的兜底。
   */
  manifest?: PluginPackageManifest;
  /** 安装来源（默认按粘贴代码计） */
  source?: string;
}

/** 卸载后的数据表处置待办（弹窗据此展示「保留 / 删表」询问） */
export interface PluginDbCleanupPending {
  /** 已卸载的插件 id */
  pluginId: string;
  /** 展示名 */
  pluginName: string;
  /** 该插件名下的数据表（插件内表名） */
  tables: string[];
}

/** `useUserPlugins` 返回句柄 */
export interface UseUserPluginsReturn {
  /** 已安装的用户插件记录（状态变化后自动刷新） */
  records: ComputedRef<readonly UserPluginRecord[]>;
  /** 卸载后的数据表处置待办（null = 无待办；管理弹窗据此渲染询问条） */
  pendingDbCleanup: ComputedRef<PluginDbCleanupPending | null>;
  /**
   * 插件 id 是否为用户安装
   * @param id 插件 id
   * @returns 是否用户插件
   */
  isUserPlugin: (id: string) => boolean;
  /**
   * 从代码字符串安装插件（校验 → 持久化 → 内核挂载）
   * @param code 插件代码原文（预构建 ESM JS；zip 包安装时传入包内入口产物）
   * @param options 附加信息（zip 包安装时传清单与来源）
   * @returns 安装结果（失败带面向用户的原因）
   */
  install: (
    code: string,
    options?: UserPluginInstallOptions,
  ) => Promise<UserPluginInstallResult>;
  /**
   * 卸载用户插件（内核撤销全部贡献 + 从持久化移除代码）
   *
   * 插件若声明过数据表，卸载后挂起一条「保留 / 删表」待办，
   * 由界面经 `resolveDbCleanup` 让用户选择（数据默认保留）。
   * @param id 插件 id
   */
  uninstall: (id: string) => void;
  /**
   * 处置已卸载插件的遗留数据表
   * @param drop true = 一并 DROP 数据表（数据不可恢复）；false = 保留数据
   */
  resolveDbCleanup: (drop: boolean) => Promise<void>;
}

/**
 * 用户插件（应用内安装）的宿主编排入口
 *
 * 安装：结构校验（zip 包还要过清单一致性）→ 写持久化（代码原文）→ 内核 `use(origin: 'user')`；
 * 卸载：内核 `unuse`（可逆副作用统一撤销）→ 删持久化记录 → 数据表询问待办。
 * 启停复用 `usePlugins` 的通用链路（用户插件与内置插件同一套黑名单语义）。
 * @returns 用户插件列表与安装 / 卸载句柄
 */
export const useUserPlugins = (): UseUserPluginsReturn => {
  const userPluginsStore = useUserPluginsStore();
  const pluginStore = usePluginStore();

  const records = computed<readonly UserPluginRecord[]>(() => userPluginsStore.records);

  const pendingDbCleanup = ref<PluginDbCleanupPending | null>(null);

  const isUserPlugin = (id: string): boolean => userPluginsStore.has(id);

  const install = async (
    code: string,
    options?: UserPluginInstallOptions,
  ): Promise<UserPluginInstallResult> => {
    if (code.trim().length === 0) {
      return { ok: false, error: '插件代码为空' };
    }
    if (code.length > USER_PLUGIN_CODE_MAX_LENGTH) {
      return { ok: false, error: '插件代码超出体积上限（512KB）' };
    }
    const occupiedIds = [
      ...BUILTIN_PLUGINS.map((plugin) => plugin.id),
      ...userPluginsStore.records.map((record) => record.id),
    ];
    const result = await importUserPluginCode(code, occupiedIds);
    if (!result.ok) {
      return { ok: false, error: result.error, warnings: result.warnings };
    }
    const { definition } = result;
    // zip 包安装：清单与产物必须对得上，否则「包里写一套、跑起来是另一套」最难排查
    if (options?.manifest) {
      const inconsistency = checkManifestConsistency(options.manifest, definition);
      if (inconsistency) {
        return { ok: false, error: inconsistency, warnings: result.warnings };
      }
    }
    const record: UserPluginRecord = {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      description: definition.description,
      author: definition.author ?? options?.manifest?.author ?? '',
      code,
      installedAt: new Date().toISOString(),
      source: options?.source ?? USER_PLUGIN_SOURCE.CODE,
    };
    if (!userPluginsStore.upsert(record)) {
      return { ok: false, error: '已安装插件数量超出上限，请先卸载不再使用的插件' };
    }
    mountUserPluginDefinition(definition, pluginStore.isPluginEnabled(definition.id));
    trackAction('PLUGIN_INSTALL', { target: definition.id, detail: definition.version });
    return { ok: true, error: '', warnings: result.warnings };
  };

  const uninstall = (id: string): void => {
    const pluginName = userPluginsStore.records.find((record) => record.id === id)?.name ?? id;
    pluginKernel.unuse(id);
    userPluginsStore.remove(id);
    trackAction('PLUGIN_UNINSTALL', { target: id });
    // 插件若建过数据表，卸载后挂起「保留 / 删表」询问（数据默认保留，删表需用户确认）
    const tables = listPluginTables(id);
    if (tables.length > 0) {
      pendingDbCleanup.value = {
        pluginId: id,
        pluginName,
        tables,
      };
    }
  };

  const resolveDbCleanup = async (drop: boolean): Promise<void> => {
    const pending = pendingDbCleanup.value;
    if (!pending) return;
    pendingDbCleanup.value = null;
    if (drop) {
      await dropPluginTables(pending.pluginId);
      trackAction('PLUGIN_DB_DROP', {
        target: pending.pluginId,
        detail: pending.tables.join(','),
      });
    }
  };

  return { records, pendingDbCleanup: computed(() => pendingDbCleanup.value), isUserPlugin, install, uninstall, resolveDbCleanup };
};

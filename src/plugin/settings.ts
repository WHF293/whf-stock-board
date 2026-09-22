/**
 * 插件设置存储（`ctx.settings` 的实现）
 *
 * 清单式设置的运行时半边：插件在清单里声明 `settings` 字段（schema 或自定义组件），
 * 这里负责值的存取——持久化在插件 storage 的 `settings` 键下（即插件 JSON 里
 * `{"settings": {...}}` 那个字段），启动时与声明默认值合并成响应式对象，
 * 插件的 `computed` 可直接依赖，改设置即时生效、无需重启。
 */
import { reactive } from 'vue';
import type {
  PluginSettingField,
  PluginSettingsStore,
} from '../types/plugin.types';

/** 设置值在插件 storage 里的键名 */
export const PLUGIN_SETTINGS_STORAGE_KEY = 'settings';

/** 设置存储依赖的最小持久化能力（就是 PluginStorage 的 get / set） */
interface SettingsPersistence {
  get: <T>(key: string, fallback: T) => T;
  set: (key: string, value: unknown) => void;
}

/**
 * 创建一个插件的设置存储
 * @param storage 插件自有持久化句柄（复用 storage 的双通道，不另起炉灶）
 * @param fields 清单里声明的字段（默认值来源；自定义组件声明时为空数组）
 * @returns 设置存取句柄
 */
export const createPluginSettingsStore = (
  storage: SettingsPersistence,
  fields: readonly PluginSettingField[],
): PluginSettingsStore => {
  // 声明默认值：未配置字段的生效值（也保证 values 里键恒存在，computed 依赖可被追踪）
  const defaults: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.default !== undefined) defaults[field.key] = field.default;
  }

  // 用户已保存的配置覆盖默认值（损坏或缺失时安静回落）
  const saved = storage.get<Record<string, unknown>>(PLUGIN_SETTINGS_STORAGE_KEY, {});
  const values = reactive<Record<string, unknown>>({ ...defaults, ...saved });

  /** 把当前值整包写回持久化（一个插件一份 settings JSON） */
  const persist = (): void => {
    storage.set(PLUGIN_SETTINGS_STORAGE_KEY, { ...values });
  };

  return {
    values,
    get: <T>(key: string, fallback: T): T =>
      Object.prototype.hasOwnProperty.call(values, key) ? (values[key] as T) : fallback,
    set: (key: string, value: unknown): void => {
      values[key] = value;
      persist();
    },
    reset: (): void => {
      for (const key of [...Object.keys(values)]) delete values[key];
      Object.assign(values, defaults);
      persist();
    },
  };
};

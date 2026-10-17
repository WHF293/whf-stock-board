import type { Proxy } from '@tauri-apps/plugin-http';
import { useSettingsStore } from '../stores/settings';

/**
 * 更新通道代理 init（王总 2026-10-17：打包版检测更新不走系统代理，见设置页「更新代理」）
 *
 * 背景：tauri-plugin-http（Rust reqwest）在打包版对 Windows 系统代理的跟随不稳定
 * （开发环境正常、安装版检测GitHub 失败且被「静默按无新版本」吞掉），参照 cc-switch
 * 的做法在应用内显式配代理：设置页填入地址后，更新相关请求经 `init.proxy` 显式走代理。
 *
 * 应用更新（app-update.api）与插件更新（plugin-update.api）共用本工具。
 */

/**
 * 构造更新请求的代理参数（直接展开进 tauriFetch 的 init）
 * @returns 配置了代理时返回 `{ proxy: { all: <地址> } }`；未配置返回 `{}`（直连）
 */
export const buildUpdateProxyInit = (): { proxy?: Proxy } => {
  const url = useSettingsStore().updateProxyUrl.trim();
  if (!url) return {};
  return { proxy: { all: url } };
};
